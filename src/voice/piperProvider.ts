import * as ort from "onnxruntime-web/wasm";
// El fonemizador de Piper (espeak-ng completo compilado a WASM). Su `main` en package.json está roto,
// por eso se importa el archivo directamente; el .wasm y los datos de espeak se sirven con `?url`.
import createPiperPhonemize from "@diffusionstudio/piper-wasm/build/piper_phonemize.js";
import phonemizeWasm from "@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url";
import phonemizeData from "@diffusionstudio/piper-wasm/build/piper_phonemize.data?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { normalizeForSpeech } from "./pronunciation";
import type { Mood, SpeakOptions, TTSProvider } from "./tts";

/**
 * Voz de Piper (neuronal, local) dentro de la app. Se descarga una vez (~109 MB) y queda en la caché de
 * la ventana; mientras no está lista (o si falla) habla el motor de respaldo.
 *
 * Voz elegida: es_AR-daniela-high (femenina, calidad "high", español latinoamericano). Genera ~4 veces más
 * rápido que tiempo real, así que se trocea por frases: la primera suena en cuanto está lista.
 *
 * El ánimo (`SpeakOptions.mood`) se traduce a los tres parámetros de Piper: variación (entonación), ritmo y
 * estabilidad. Las palabras en inglés y las siglas se reescriben antes (ver `pronunciation.ts`).
 */
const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high";
const MODEL_URL = `${VOICE_BASE}.onnx`;
const CONFIG_URL = `${VOICE_BASE}.onnx.json`;
const CACHE_NAME = "mizu-piper-v1";

/**
 * Parámetros de cada ánimo como [variación, ritmo, estabilidad] (ritmo < 1 = más rápido). `neutral` es el valor de
 * fábrica de la voz; los demás se aplican en proporción a él, así que valen para cualquier voz de Piper.
 */
const MOOD_SCALES: Record<Mood, [number, number, number]> = {
  neutral: [0.667, 1.0, 0.8],
  alegre: [0.95, 0.93, 1.05], // más viva: entonación marcada y algo más rápida
  calma: [0.5, 1.12, 0.6], // serena: regular, más lenta y sin sobresaltos
  atenta: [0.75, 1.03, 0.9], // al pedir algo: un punto más expresiva, sin prisa
};

interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map: Record<string, number>;
}

interface Phonemized {
  phoneme_ids: number[];
}

/** Descarga con caché persistente (Cache Storage). */
async function cachedFetch(url: string): Promise<ArrayBuffer> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    /* sin caché: se descarga siempre */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  try {
    await cache?.put(url, new Response(buf.slice(0)));
  } catch {
    /* no cabe en la caché: no pasa nada */
  }
  return buf;
}

/** Texto -> IDs de fonemas de Piper (uno por frase), con el espeak-ng de Piper. */
async function phonemize(sentences: string[], voice: string): Promise<number[][]> {
  const lines: string[] = [];
  const mod = await createPiperPhonemize({
    print: (line: string) => lines.push(line),
    printErr: () => {},
    locateFile: (name: string) => (name.endsWith(".wasm") ? phonemizeWasm : name.endsWith(".data") ? phonemizeData : name),
  });
  mod.callMain([
    "-l",
    voice, // el de la propia voz ("es-419" en Daniela: español latinoamericano)
    "--input",
    JSON.stringify(sentences.map((text) => ({ text }))),
    "--espeak_data",
    "/espeak-ng-data",
  ]);
  return lines.map((l) => (JSON.parse(l) as Phonemized).phoneme_ids);
}

/** Parte un texto en frases (conservando la puntuación) para sintetizarlas una a una. */
export function splitSentences(text: string): string[] {
  const clean = text
    .replace(/```[\s\S]*?```/g, " ") // el código no se lee
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.match(/[^.!?…¡¿]+[.!?…]*/g) ?? [];
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s))) {
    // Las frases muy cortas se pegan a la anterior para que no suene entrecortado.
    if (out.length && p.length < 14) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

export interface PiperTTS extends TTSProvider {
  /** El modelo ya está cargado: se habla con Piper en vez de con el respaldo. */
  readonly ready: boolean;
  /** Descarga y prepara el modelo (se llama al arrancar, en segundo plano). */
  preload(): Promise<void>;
  /** Tiempos (ms) de la última frase, para depurar: fonemizar y sintetizar cada trozo. */
  readonly lastTimings: { phonemizeMs: number; synthMs: number[]; resumeMs: number; ctxState: string; scheduleDelayMs: number };
}

export function createPiperTTS(fallback: TTSProvider): PiperTTS {
  const speakingCbs = new Set<(s: boolean) => void>();
  const boundaryCbs = new Set<(i: number, t: string) => void>();
  let speaking = false;
  const setSpeaking = (v: boolean) => {
    if (speaking === v) return;
    speaking = v;
    speakingCbs.forEach((cb) => cb(v));
  };
  // El respaldo también mueve la boca y avisa de que habla.
  fallback.onSpeakingChange((s) => setSpeaking(s));
  fallback.onBoundary((i, t) => boundaryCbs.forEach((cb) => cb(i, t)));

  let ready = false;
  let loading: Promise<void> | null = null;
  let failed = false;
  let session: ort.InferenceSession;
  let cfg: PiperConfig;

  const preload = (): Promise<void> => {
    loading ??= (async () => {
      ort.env.wasm.wasmPaths = { wasm: ortWasm, mjs: ortMjs };
      // La inferencia corre en un worker: en el hilo principal congelaba la ventana y el personaje (~1,5 s por frase).
      ort.env.wasm.proxy = true;
      if (self.crossOriginIsolated) ort.env.wasm.numThreads = Math.max(2, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2)));
      const [model, json] = await Promise.all([cachedFetch(MODEL_URL), cachedFetch(CONFIG_URL)]);
      cfg = JSON.parse(new TextDecoder().decode(json)) as PiperConfig;
      session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] });
      ready = true;
    })().catch((e) => {
      failed = true;
      loading = null;
      console.error("[piper] no se pudo preparar la voz:", e);
      throw e;
    });
    return loading;
  };

  // --- Reproducción ---
  let ctx: AudioContext | null = null;
  // Desbloqueo: el primer clic o tecla en la ventana permite reproducir audio aunque el navegador lo hubiera impedido.
  const unlock = () => void ctx?.resume().catch(() => {});
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  let generation = 0;
  let sources: AudioBufferSourceNode[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];

  const stopAll = () => {
    generation++;
    timers.forEach(clearTimeout);
    timers = [];
    for (const s of sources) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* ya había terminado */
      }
    }
    sources = [];
  };

  const synth = async (ids: number[], scales: [number, number, number]): Promise<Float32Array> => {
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from(scales), [3]),
    };
    // Las voces de varios hablantes piden cuál; Daniela es de uno solo y no lleva esa entrada.
    if (session.inputNames.includes("sid")) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
    const out = await session.run(feeds);
    return out.output.data as Float32Array;
  };

  /** Parámetros de Piper para un ánimo, en proporción a los valores de fábrica de la voz. */
  const scalesFor = (mood: Mood, rate = 1): [number, number, number] => {
    const base = MOOD_SCALES.neutral;
    const m = MOOD_SCALES[mood] ?? base;
    const { noise_scale, length_scale, noise_w } = cfg.inference;
    return [noise_scale * (m[0] / base[0]), (length_scale * (m[1] / base[1])) / (rate > 0 ? rate : 1), noise_w * (m[2] / base[2])];
  };

  const lastTimings = { phonemizeMs: 0, synthMs: [] as number[], resumeMs: 0, ctxState: "", scheduleDelayMs: 0 };

  const speakWithPiper = async (text: string, opts: SpeakOptions) => {
    const sentences = splitSentences(normalizeForSpeech(text));
    if (!sentences.length) return;
    stopAll();
    const my = generation;
    ctx ??= new AudioContext({ sampleRate: cfg.audio.sample_rate });
    const tRs = performance.now();
    // Si el navegador bloquea el audio hasta que haya una interacción, no se espera en vano: habla el respaldo.
    if (ctx.state === "suspended") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1200))]);
    lastTimings.resumeMs = Math.round(performance.now() - tRs);
    lastTimings.ctxState = ctx.state;
    if (ctx.state !== "running") throw new Error("el audio está bloqueado hasta que hagas clic en la ventana");
    const tPh = performance.now();
    const ids = await phonemize(sentences, cfg.espeak.voice);
    lastTimings.phonemizeMs = Math.round(performance.now() - tPh);
    lastTimings.synthMs = [];
    if (my !== generation) return; // otra frase o un cancel() llegó mientras se preparaba
    const scales = scalesFor(opts.mood ?? "neutral", opts.rate);

    let nextStart = ctx.currentTime + 0.05;
    let charBase = 0;
    let lastSource: AudioBufferSourceNode | null = null;
    const finished = new Promise<void>((resolve) => {
      const done = () => {
        if (my === generation) setSpeaking(false);
        resolve();
      };
      (async () => {
        for (let i = 0; i < sentences.length; i++) {
          const tSy = performance.now();
          const samples = await synth(ids[i], scales);
          lastTimings.synthMs.push(Math.round(performance.now() - tSy));
          if (my !== generation) return resolve();
          const buffer = ctx!.createBuffer(1, samples.length, cfg.audio.sample_rate);
          buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
          const src = ctx!.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx!.destination);
          const startAt = Math.max(nextStart, ctx!.currentTime + 0.02);
          if (i === 0) lastTimings.scheduleDelayMs = Math.round((startAt - ctx!.currentTime) * 1000);
          src.start(startAt);
          nextStart = startAt + buffer.duration;
          sources.push(src);
          lastSource = src;
          if (i === 0) timers.push(setTimeout(() => my === generation && setSpeaking(true), Math.max(0, (startAt - ctx!.currentTime) * 1000)));

          // Una "palabra" por empujón de boca, repartidas a lo largo de la frase.
          const sentence = sentences[i];
          const words = [...sentence.matchAll(/\S+/g)];
          const base = charBase;
          words.forEach((w, k) => {
            const at = startAt + (buffer.duration * k) / Math.max(words.length, 1);
            timers.push(
              setTimeout(() => my === generation && boundaryCbs.forEach((cb) => cb(base + (w.index ?? 0), text)), Math.max(0, (at - ctx!.currentTime) * 1000)),
            );
          });
          charBase += sentence.length + 1;
        }
        (lastSource as AudioBufferSourceNode | null)?.addEventListener("ended", done);
        if (!lastSource) done();
      })().catch((e) => {
        console.error("[piper] fallo al sintetizar:", e);
        done();
      });
    });
    await finished;
  };

  return {
    id: "piper",
    available: true,
    get speaking() {
      return speaking;
    },
    get ready() {
      return ready;
    },
    lastTimings,
    preload,
    async speak(text, opts = {}) {
      if (!text.trim()) return;
      if (!ready) {
        if (!failed) preload().catch(() => {}); // empieza a descargar para la próxima
        return fallback.speak(text, opts);
      }
      fallback.cancel();
      try {
        await speakWithPiper(text, opts);
      } catch (e) {
        console.error("[piper] fallo, se usa el respaldo:", e);
        setSpeaking(false);
        await fallback.speak(text, opts);
      }
    },
    cancel() {
      stopAll();
      fallback.cancel();
      setSpeaking(false);
    },
    onSpeakingChange(cb) {
      speakingCbs.add(cb);
      return () => speakingCbs.delete(cb);
    },
    onBoundary(cb) {
      boundaryCbs.add(cb);
      return () => boundaryCbs.delete(cb);
    },
  };
}
