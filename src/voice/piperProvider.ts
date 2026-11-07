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
  // Se corta en el espacio tras `. ! ? …` (el punto de "main.ts" o de "3.5" no corta la frase).
  const parts = clean.split(/(?<=[.!?…]["»)]?)\s+/u);
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s))) {
    // Las frases muy cortas se pegan a la anterior para que no suene entrecortado.
    if (out.length && p.length < 14) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  // Las frases largas se parten por una coma: la síntesis tarda en proporción a lo que dura el trozo, y así el primer
  // sonido llega antes y ningún trozo se hace esperar. La primera frase se parte antes que las demás.
  const split: string[] = [];
  out.forEach((s, i) => {
    const limit = i === 0 ? 60 : 130;
    if (s.length <= limit) return split.push(s);
    let commas = [...s.matchAll(/,\s+/g)].map((m) => (m.index ?? 0) + 1).filter((at) => at >= 18 && s.length - at >= 18);
    // La primera frase sin una coma a tiempo se parte en una conjunción ("... el error | y añadí la prueba").
    if (i === 0 && !commas.some((at) => at <= 55)) {
      const conj = [...s.matchAll(/\s(?=(?:y|pero|que|porque|para|aunque|cuando|mientras)\s)/g)]
        .map((m) => m.index ?? 0)
        .filter((at) => at >= 20 && at <= 55 && s.length - at >= 15);
      if (conj.length) commas = [conj[0]];
    }
    if (!commas.length) return split.push(s);
    // Para la primera, la primera coma razonable; para el resto, la más cercana al centro.
    const at = i === 0 ? commas[0] : commas.reduce((a, b) => (Math.abs(b - s.length / 2) < Math.abs(a - s.length / 2) ? b : a));
    split.push(s.slice(0, at).trim(), s.slice(at).trim());
  });
  return split;
}

export interface PiperTTS extends TTSProvider {
  /** El modelo ya está cargado: se habla con Piper en vez de con el respaldo. */
  readonly ready: boolean;
  /** Descarga y prepara el modelo (se llama al arrancar, en segundo plano). */
  preload(): Promise<void>;
  /** Tiempos (ms) de la última frase, para depurar: fonemizar y sintetizar cada trozo. */
  readonly lastTimings: { phonemizeMs: number; synthMs: number[] };
}

/** Un `speak`/`enqueue`: su texto se trocea en frases que se sintetizan una a una. */
interface Job {
  text: string;
  opts: SpeakOptions;
  /** Resuelve cuando termina de sonar (o se cancela). */
  resolve: () => void;
  /** Último trozo de audio programado de este trabajo. */
  last?: AudioBufferSourceNode;
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

  // --- Reproducción: una cola de trabajos; el audio de cada frase se programa justo a continuación del anterior ---
  let ctx: AudioContext | null = null;
  // Desbloqueo: el primer clic o tecla en la ventana permite reproducir audio aunque el navegador lo hubiera impedido.
  const unlock = () => void ctx?.resume().catch(() => {});
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });

  let generation = 0; // cada cancel() la sube: lo que estaba en marcha se descarta
  let sources: AudioBufferSourceNode[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  let jobs: Job[] = []; // pendientes de sintetizar
  const open = new Set<Job>(); // sin terminar de sonar
  let pumping = false;
  let nextStart = 0; // instante (reloj del AudioContext) en que puede empezar el siguiente trozo
  let scheduled = 0; // trozos programados que aún no han terminado de sonar
  const lastTimings = { phonemizeMs: 0, synthMs: [] as number[] };

  const settleIfIdle = () => {
    if (!pumping && jobs.length === 0 && scheduled === 0) setSpeaking(false);
  };

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
    scheduled = 0;
    nextStart = 0;
    jobs = [];
    [...open].forEach((j) => j.resolve());
  };

  let volume = 1;
  let master: GainNode | null = null;
  const ensureCtx = async () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: cfg.audio.sample_rate });
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    // Si el navegador bloquea el audio hasta que haya una interacción, no se espera en vano: habla el respaldo.
    if (ctx.state === "suspended") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1200))]);
    if (ctx.state !== "running") throw new Error("el audio está bloqueado hasta que hagas clic en la ventana");
    return ctx;
  };

  const playJob = async (job: Job, my: number) => {
    const sentences = splitSentences(normalizeForSpeech(job.text));
    if (!sentences.length) return job.resolve();
    const audio = await ensureCtx();
    const tPh = performance.now();
    const ids = await phonemize(sentences, cfg.espeak.voice);
    lastTimings.phonemizeMs = Math.round(performance.now() - tPh);
    lastTimings.synthMs = [];
    if (my !== generation) return;
    const scales = scalesFor(job.opts.mood ?? "neutral", job.opts.rate);
    let charBase = 0;
    for (let i = 0; i < sentences.length; i++) {
      const tSy = performance.now();
      const samples = await synth(ids[i], scales);
      lastTimings.synthMs.push(Math.round(performance.now() - tSy));
      if (my !== generation) return; // un cancel() llegó mientras se sintetizaba
      const buffer = audio.createBuffer(1, samples.length, cfg.audio.sample_rate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const src = audio.createBufferSource();
      src.buffer = buffer;
      src.connect(master ?? audio.destination);
      const startAt = Math.max(nextStart, audio.currentTime + 0.02);
      src.start(startAt);
      nextStart = startAt + buffer.duration;
      sources.push(src);
      scheduled++;
      job.last = src;
      src.onended = () => {
        if (my !== generation) return;
        scheduled--;
        sources = sources.filter((s) => s !== src);
        if (job.last === src) job.resolve();
        settleIfIdle();
      };
      timers.push(setTimeout(() => my === generation && setSpeaking(true), Math.max(0, (startAt - audio.currentTime) * 1000)));

      // Una "palabra" por empujón de boca, repartidas a lo largo de la frase.
      const sentence = sentences[i];
      const base = charBase;
      [...sentence.matchAll(/\S+/g)].forEach((w, k, all) => {
        const at = startAt + (buffer.duration * k) / Math.max(all.length, 1);
        timers.push(setTimeout(() => my === generation && boundaryCbs.forEach((cb) => cb(base + (w.index ?? 0), job.text)), Math.max(0, (at - audio.currentTime) * 1000)));
      });
      charBase += sentence.length + 1;
    }
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    const my = generation;
    try {
      while (jobs.length && my === generation) {
        const job = jobs.shift()!;
        try {
          await playJob(job, my);
        } catch (e) {
          console.error("[piper] fallo, se usa el respaldo:", e);
          job.resolve();
          await fallback.speak(job.text, job.opts);
        }
      }
    } finally {
      pumping = false;
      if (jobs.length) void pump(); // llegaron trabajos nuevos tras un cancel()
      else if (my === generation) settleIfIdle();
    }
  };

  const addJob = (text: string, opts: SpeakOptions) =>
    new Promise<void>((resolve) => {
      const job: Job = {
        text,
        opts,
        resolve: () => {
          open.delete(job);
          resolve();
        },
      };
      open.add(job);
      jobs.push(job);
      void pump();
    });

  /** ¿Hay que hablar con el respaldo (Piper aún no está listo, o el respaldo sigue hablando)? */
  const useFallback = () => {
    if (!ready && !failed) preload().catch(() => {}); // empieza a descargar para la próxima
    return !ready || fallback.speaking;
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
    setVolume(v: number) {
      volume = Math.min(1, Math.max(0, v));
      if (master) master.gain.value = volume;
      fallback.setVolume?.(volume);
    },
    async speak(text, opts = {}) {
      if (!text.trim()) return;
      if (!ready) return useFallback() ? fallback.speak(text, opts) : undefined;
      fallback.cancel();
      stopAll();
      await addJob(text, opts);
    },
    async enqueue(text, opts = {}) {
      if (!text.trim()) return;
      if (useFallback()) return fallback.enqueue ? fallback.enqueue(text, opts) : fallback.speak(text, opts);
      await addJob(text, opts);
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
