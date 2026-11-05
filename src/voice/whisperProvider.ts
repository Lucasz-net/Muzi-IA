// El runtime de onnxruntime que usa transformers.js, empaquetado con la app: por defecto lo pediría a una CDN y sin
// internet Whisper no arrancaría ni teniendo el modelo en caché.
import ortAsyncifyWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortAsyncifyMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import type { ListenState, STTProvider } from "./stt";
import { isLoneWakeLike, stripWakeWord } from "./wakeWord";

/**
 * Whisper (multilingüe) ejecutándose dentro de la propia app con transformers.js: sin servidor,
 * sin internet (salvo la descarga única del modelo, ~73 MB, que queda en la caché de la ventana) y
 * sin mandar tu audio a nadie.
 */
/**
 * Modelos a probar, por orden: Whisper-small en la tarjeta gráfica (fp16, ~463 MB: entiende mucho mejor los nombres y el
 * español), Whisper-base en la tarjeta (~139 MB) y, si no hay WebGPU, base en la CPU (q8, ~73 MB). El primero que cargue
 * y supere una transcripción de prueba es el que se usa; si uno falla (poca memoria de vídeo, descarga cortada...) se
 * pasa al siguiente.
 */
const FP16 = { encoder_model: "fp16", decoder_model_merged: "fp16" };
const CANDIDATES = [
  { model: "onnx-community/whisper-small", device: "webgpu", dtype: FP16 },
  { model: "onnx-community/whisper-base", device: "webgpu", dtype: FP16 },
  { model: "onnx-community/whisper-base", device: "wasm", dtype: { encoder_model: "q8", decoder_model_merged: "q8" } },
];
const RATE = 16000;
/** Ventana (muestras) con la que se mide el volumen: 100 ms. */
const WINDOW = 1600;
/** Silencio (s) tras hablar que da por terminada la frase. */
const SILENCE_END_S = 1.1;
/** Si en este tiempo (s) no se oye a nadie, se cierra el micrófono sin transcribir. */
const NO_SPEECH_S = 8;
/** Duración máxima (s) de una frase. */
const MAX_S = 30;
/** Voz mínima (ventanas seguidas por encima del umbral) para considerar que alguien habla. */
const MIN_VOICED_WINDOWS = 2;
/** Cola (s) que se deja tras la última voz al recortar. */
const TAIL_S = 0.4;

// --- Escucha continua ---
/** En escucha continua una frase termina antes (el silencio entre palabras de una orden es corto). */
const WAKE_SILENCE_END_S = 0.9;
/** Audio (s) que se guarda de antes de detectar la voz, para no comerse la primera sílaba ("Mi-zu"). */
const PRE_ROLL_S = 0.5;
/** Una frase con menos voz que esto (ventanas de 100 ms) es un ruido, no se transcribe. */
const MIN_SEGMENT_WINDOWS = 4;
const WAKE_MAX_S = 20;
/** Frases pendientes de transcribir como máximo (si se acumulan, se descartan las más viejas). */
const MAX_QUEUE = 2;

/** Whisper inventa estas frases cuando oye ruido o silencio. */
const HALLUCINATIONS = [
  /subt[ií]tulos/i,
  /amara\.org/i,
  /gracias por (?:ver|vuestra atenci[oó]n)/i,
  /suscr[ií]be/i,
  /^[\s.…,¡!¿?\-–—[\]()♪]*$/,
  /^\[?(?:m[uú]sica|aplausos|silencio)\]?$/i,
];

const WORKLET = `class R extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("mizu-rec",R)`;

type AsrFn = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
/** Lo que se usa por dentro de la tubería de transformers.js para transcribir con un texto de contexto. */
interface AsrInternals {
  tokenizer: {
    convert_tokens_to_ids(tokens: string[]): number[];
    encode(text: string): number[];
    decode(ids: number[], opts?: Record<string, unknown>): string;
  };
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: { generate(opts: Record<string, unknown>): Promise<{ tolist(): unknown[][] }> };
}
type Asr = AsrFn & AsrInternals;

/**
 * Texto de contexto para Whisper: con el nombre bien escrito delante tiende a escribirlo igual ("Mizu" en vez de "mis su",
 * "me sub", "Mezbo"...). Sin órdenes dentro a propósito: si con ruido Whisper repitiera el contexto, no debe parecer un encargo.
 */
const WAKE_PROMPT = " Hola, Mizu. ¿Qué tal, Mizu? Mizu, ¿me oyes?";

/** ¿Es solo un eco del texto de contexto? (con ruido o silencio Whisper a veces lo repite) */
function isPromptEcho(text: string): boolean {
  const flat = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  const t = flat(text);
  // Solo ecos largos: un "Mizu." suelto es justo lo que hay que reconocer y también está dentro del contexto.
  return t.length >= 9 && flat(WAKE_PROMPT).includes(t);
}

/**
 * Transcribe con el texto de contexto: el decodificador arranca con `<|startofprev|> contexto <|startoftranscript|>
 * <|es|> <|transcribe|> <|notimestamps|>`, que es como Whisper recibe un "prompt". transformers.js no lo expone en la
 * tubería, así que se llama al modelo directamente (una sola ventana de audio: las frases son cortas).
 */
async function transcribePrompted(asr: Asr, audio: Float32Array): Promise<string> {
  const tok = asr.tokenizer;
  const id = (t: string) => tok.convert_tokens_to_ids([t])[0];
  const [prev, sot, es, task, noTimestamps, eot] = [
    "<|startofprev|>",
    "<|startoftranscript|>",
    "<|es|>",
    "<|transcribe|>",
    "<|notimestamps|>",
    "<|endoftext|>",
  ].map(id);
  const context = Array.from(tok.encode(WAKE_PROMPT)).filter((t) => t < eot); // solo texto, sin especiales
  const { input_features } = await asr.processor(audio);
  const out = await asr.model.generate({
    inputs: input_features,
    decoder_input_ids: [prev, ...context, sot, es, task, noTimestamps],
    max_new_tokens: 160,
  });
  const seq = (out.tolist()[0] as (number | bigint)[]).map(Number);
  // Lo transcrito va tras el último <|startoftranscript|> (y sus tres marcas de idioma, tarea y tiempos).
  const generated = seq.slice(seq.lastIndexOf(sot) + 1).filter((t) => t < eot);
  return tok.decode(generated, { skip_special_tokens: true }).trim();
}

interface Recorder {
  /** Audio recortado de la frase, o `null` si nadie habló o se canceló. */
  done: Promise<Float32Array | null>;
  finish(): void;
  cancel(): void;
}

/** Abre el micrófono con un worklet que entrega el audio en trozos de 128 muestras a 16 kHz. */
async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext({ sampleRate: RATE });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "mizu-rec");
  source.connect(node);
  // Si el navegador dejó el audio en pausa hasta que haya una interacción, el primer clic o tecla lo reanuda.
  const resume = () => void ctx.resume().catch(() => {});
  if (ctx.state === "suspended") resume();
  window.addEventListener("pointerdown", resume, { passive: true });
  window.addEventListener("keydown", resume, { passive: true });
  const close = () => {
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return { node, close };
}

/** Abre el micrófono y graba una frase: hasta que callas (o hasta que se corta a mano). */
async function openRecorder(): Promise<Recorder> {
  const { node, close } = await openMic();
  const chunks: Float32Array[] = [];
  let total = 0;
  let acc = 0;
  let accN = 0;
  let windows = 0;
  let floor = Infinity;
  let voiced = 0;
  let speaking = false;
  let lastVoice = 0;
  let ended = false;
  let resolveDone!: (a: Float32Array | null) => void;
  const done = new Promise<Float32Array | null>((r) => (resolveDone = r));

  const end = (keep: boolean) => {
    if (ended) return;
    ended = true;
    close();
    if (!keep || !speaking) return resolveDone(null);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    resolveDone(all.subarray(0, Math.min(total, Math.round((lastVoice + TAIL_S) * RATE))));
  };

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const buf = e.data;
    chunks.push(buf);
    total += buf.length;
    for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
    accN += buf.length;
    while (accN >= WINDOW) {
      const rms = Math.sqrt(acc / accN);
      acc = 0;
      accN = 0;
      windows++;
      const elapsed = total / RATE;
      if (windows <= 4) floor = Math.min(floor, rms); // el ruido de fondo, medido al abrir
      const threshold = Math.max(0.012, floor * 3);
      if (rms > threshold) {
        voiced++;
        lastVoice = elapsed;
        if (voiced >= MIN_VOICED_WINDOWS) speaking = true;
      } else voiced = 0;
      if (speaking && elapsed - lastVoice > SILENCE_END_S) return end(true);
      if (!speaking && elapsed > NO_SPEECH_S) return end(false);
      if (elapsed > MAX_S) return end(true);
    }
  };

  return { done, finish: () => end(true), cancel: () => end(false) };
}

/**
 * Micrófono siempre abierto: corta el audio en frases (por silencios) y entrega cada una. El umbral de
 * voz se adapta al ruido de la habitación. Mientras `isMuted()` sea true se ignora todo.
 */
async function openContinuous(onSegment: (audio: Float32Array) => void, isMuted: () => boolean) {
  const { node, close } = await openMic();
  const preRoll: Float32Array[] = [];
  let preRollSamples = 0;
  let seg: Float32Array[] = [];
  let segSamples = 0;
  let acc = 0;
  let accN = 0;
  let floor = 0.01;
  let speaking = false;
  let voicedRun = 0;
  let voicedWindows = 0;
  let silent = 0; // ventanas seguidas sin voz
  let closed = false;

  const reset = () => {
    seg = [];
    segSamples = 0;
    speaking = false;
    voicedRun = 0;
    voicedWindows = 0;
    silent = 0;
  };

  const flush = () => {
    if (voicedWindows >= MIN_SEGMENT_WINDOWS) {
      const all = new Float32Array(segSamples);
      let o = 0;
      for (const c of seg) {
        all.set(c, o);
        o += c.length;
      }
      // Se recorta el silencio del final (se deja una cola corta).
      const trimmed = Math.max(0, all.length - Math.max(0, silent * WINDOW - Math.round(TAIL_S * RATE)));
      onSegment(all.subarray(0, trimmed));
    }
    reset();
  };

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (closed) return;
    const buf = e.data;
    if (isMuted()) {
      reset();
      preRoll.length = 0;
      preRollSamples = 0;
      acc = 0;
      accN = 0;
      return;
    }
    if (speaking) {
      seg.push(buf);
      segSamples += buf.length;
    } else {
      preRoll.push(buf);
      preRollSamples += buf.length;
      while (preRollSamples - preRoll[0].length >= PRE_ROLL_S * RATE) preRollSamples -= preRoll.shift()!.length;
    }
    for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
    accN += buf.length;
    while (accN >= WINDOW) {
      const rms = Math.sqrt(acc / accN);
      acc = 0;
      accN = 0;
      const threshold = Math.max(0.015, floor * 3.2);
      if (rms > threshold) {
        voicedRun++;
        silent = 0;
        if (speaking) voicedWindows++;
        else if (voicedRun >= MIN_VOICED_WINDOWS) {
          speaking = true;
          voicedWindows = voicedRun;
          seg = [...preRoll];
          segSamples = preRollSamples;
          preRoll.length = 0;
          preRollSamples = 0;
        }
      } else {
        voicedRun = 0;
        if (!speaking && rms < floor * 2 + 0.01) floor = floor * 0.97 + rms * 0.03; // se adapta al ruido de fondo
        if (speaking && ++silent * WINDOW / RATE > WAKE_SILENCE_END_S) flush();
      }
      if (speaking && segSamples / RATE > WAKE_MAX_S) flush();
    }
  };

  return {
    close: () => {
      closed = true;
      close();
    },
  };
}

const micMessage = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "No tengo permiso para usar el micrófono.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No encuentro ningún micrófono.";
  return `No pude abrir el micrófono: ${(e as Error)?.message ?? e}`;
};

/** Hay una tarjeta gráfica utilizable con WebGPU. */
async function hasWebGpu(): Promise<boolean> {
  try {
    return !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter());
  } catch {
    return false;
  }
}

export function createWhisperSTT(): STTProvider {
  let state: ListenState = "idle";
  const stateCbs = new Set<(s: ListenState, detail?: string) => void>();
  const transcriptCbs = new Set<(text: string) => void>();
  const attentionCbs = new Set<() => void>();
  const errorCbs = new Set<(message: string) => void>();
  const setState = (s: ListenState, detail?: string) => {
    state = s;
    stateCbs.forEach((cb) => cb(s, detail));
  };
  const fail = (message: string) => {
    setState(wake ? "standby" : "idle");
    errorCbs.forEach((cb) => cb(message));
  };

  let modelLoaded = false;
  let backend: "none" | "webgpu" | "wasm" = "none";
  let modelName = "";
  let loading: Promise<Asr> | null = null;
  const loadModel = (): Promise<Asr> => {
    loading ??= (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      env.backends.onnx.wasm!.wasmPaths = { mjs: ortAsyncifyMjs, wasm: ortAsyncifyWasm };
      // Sin WebGPU, con aislamiento de origen cruzado (ver vite.config.ts) onnxruntime-web usa varios hilos de CPU.
      if (self.crossOriginIsolated) env.backends.onnx.wasm!.numThreads = Math.max(2, Math.min(6, Math.floor(navigator.hardwareConcurrency / 2)));
      let lastPct = -1;
      let files = new Map<string, { loaded: number; total: number }>();
      const progress = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loadedBytes = 0;
        let totalBytes = 0;
        files.forEach((f) => {
          loadedBytes += f.loaded;
          totalBytes += f.total;
        });
        const pct = Math.round((100 * loadedBytes) / Math.max(totalBytes, 1));
        if (state === "loading" && pct !== lastPct) {
          lastPct = pct;
          setState("loading", `${pct} %`);
        }
      };
      const make = (model: string, device: string, dtype: Record<string, string>) =>
        pipeline("automatic-speech-recognition", model, { dtype, device, progress_callback: progress } as never) as unknown as Promise<Asr>;

      let asr: Asr | null = null;
      const gpu = await hasWebGpu();
      for (const c of CANDIDATES) {
        if (c.device === "webgpu" && !gpu) continue;
        try {
          files = new Map(); // el progreso de cada intento empieza de cero
          lastPct = -1;
          const candidate = await make(c.model, c.device, c.dtype);
          // Se calientan los shaders con un segundo de silencio: la primera orden real no paga la compilación y, de paso,
          // se comprueba que el modelo funciona de verdad en este equipo.
          await candidate(new Float32Array(RATE), { language: "spanish", task: "transcribe" });
          asr = candidate;
          backend = c.device === "webgpu" ? "webgpu" : "wasm";
          modelName = c.model.replace("onnx-community/", "");
          break;
        } catch (e) {
          console.warn(`[stt] ${c.model} (${c.device}) no funcionó, se prueba el siguiente:`, e);
        }
      }
      if (!asr) throw new Error("ningún modelo de reconocimiento de voz funcionó en este equipo");
      modelLoaded = true;
      return asr;
    })().catch((e) => {
      loading = null; // permite reintentar
      throw e;
    });
    return loading;
  };

  /** Audio -> texto, ya sin las frases que Whisper inventa con el ruido ("" si no hay nada real). */
  /** Ayuda de vocabulario para Whisper (ver `WAKE_PROMPT`): se usa mientras funcione; si falla una vez se desactiva y se usa el método normal. */
  const bias = { prompt: true, broken: false };

  /** Transcripción cruda (sin filtros), con o sin la ayuda de vocabulario. */
  const rawTranscribe = async (audio: Float32Array, withPrompt: boolean): Promise<string> => {
    const asr = await loadModel();
    if (withPrompt) return transcribePrompted(asr, audio);
    const out = await asr(audio, { language: "spanish", task: "transcribe" });
    return (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? "";
  };

  /** Audio -> texto, ya sin las frases que Whisper inventa con el ruido ("" si no hay nada real). */
  const transcribe = async (audio: Float32Array): Promise<string> => {
    let text = "";
    if (bias.prompt && !bias.broken) {
      try {
        text = await rawTranscribe(audio, true);
      } catch (e) {
        bias.broken = true; // no se reintenta: se sigue con el método normal
        console.warn("[stt] la ayuda de vocabulario falló, se transcribe sin ella:", e);
        text = await rawTranscribe(audio, false);
      }
    } else text = await rawTranscribe(audio, false);
    return text && !HALLUCINATIONS.some((h) => h.test(text)) && !isPromptEcho(text) ? text : "";
  };

  // ------------------------------------------------------------------ pulsar y hablar
  let session: Recorder | null = null;

  // ------------------------------------------------------------------ escucha continua
  let wake = false;
  let muted = false;
  let mic: { close(): void } | null = null;
  let awakeUntil = 0;
  let convTimer: ReturnType<typeof setTimeout> | undefined;
  const queue: Float32Array[] = [];
  let pumping = false;
  const heard: { text: string; secs: number; accepted: boolean }[] = [];
  /** Solo desarrollo: las últimas frases (audio) para poder compararlas con otros ajustes. */
  const recent: Float32Array[] = [];

  const closeConversation = () => {
    clearTimeout(convTimer);
    awakeUntil = 0;
    if (wake && state === "listening") setState("standby");
  };

  const handleText = (text: string, secs: number) => {
    let rest = stripWakeWord(text);
    if (rest === null && secs <= 2.2 && isLoneWakeLike(text)) rest = ""; // "Nizu", "Isu"...: solo su nombre, mal oído
    const accepted = rest !== null || Date.now() < awakeUntil;
    heard.push({ text, secs: +secs.toFixed(1), accepted });
    if (heard.length > 30) heard.shift();
    if (rest !== null) {
      if (rest.length >= 2) {
        closeConversation();
        transcriptCbs.forEach((cb) => cb(rest)); // "Mizu, abre Steam" -> "abre Steam"
      } else {
        // Solo dijo "Mizu": se queda atenta a la siguiente frase.
        attentionCbs.forEach((cb) => cb());
        api.openConversation(8);
      }
      return;
    }
    if (Date.now() < awakeUntil) {
      closeConversation();
      transcriptCbs.forEach((cb) => cb(text)); // conversación abierta: no hace falta la palabra
    }
    // Si no: era otra conversación (o la tele). Se descarta sin más.
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && wake) {
        const audio = queue.shift()!;
        if (import.meta.env.DEV) {
          recent.push(audio.slice());
          if (recent.length > 12) recent.shift();
        }
        const text = await transcribe(audio);
        if (text && wake) handleText(text, audio.length / RATE);
        else if (!text) {
          heard.push({ text: "(nada o ruido)", secs: +(audio.length / RATE).toFixed(1), accepted: false });
          if (heard.length > 30) heard.shift();
        }
      }
    } catch (e) {
      errorCbs.forEach((cb) => cb(`No pude transcribir lo que oí: ${(e as Error)?.message ?? e}`));
    } finally {
      pumping = false;
    }
  };

  const api: STTProvider = {
    id: "whisper",
    get state() {
      return state;
    },
    get waking() {
      return wake;
    },
    get backend() {
      return backend;
    },
    get model() {
      return modelName;
    },
    heard,
    debug: import.meta.env.DEV ? { recent, bias, run: rawTranscribe } : undefined,
    async start() {
      if (state !== "idle") return;
      const ready = loadModel(); // si es la primera vez, empieza a descargar mientras hablas
      ready.catch(() => {});
      let rec: Recorder;
      try {
        rec = await openRecorder();
      } catch (e) {
        return fail(micMessage(e));
      }
      session = rec;
      setState("listening");
      const audio = await rec.done;
      session = null;
      if (!audio) return setState("idle");
      try {
        setState(modelLoaded ? "transcribing" : "loading", modelLoaded ? undefined : "0 %");
        await ready;
        setState("transcribing");
        const text = await transcribe(audio);
        setState("idle");
        if (text) transcriptCbs.forEach((cb) => cb(text));
      } catch (e) {
        fail(`No pude transcribir lo que dijiste: ${(e as Error)?.message ?? e}`);
      }
    },
    finish() {
      session?.finish();
    },
    cancel() {
      session?.cancel();
    },

    async startWake() {
      if (wake || state !== "idle") return;
      setState("loading", "0 %");
      try {
        await loadModel(); // primero el modelo, para que la primera orden no espere
        mic = await openContinuous(
          (audio) => {
            queue.push(audio);
            while (queue.length > MAX_QUEUE) queue.shift();
            void pump();
          },
          () => muted,
        );
      } catch (e) {
        mic = null;
        return fail(modelLoaded ? micMessage(e) : `No pude preparar el micrófono: ${(e as Error)?.message ?? e}`);
      }
      wake = true;
      setState("standby");
    },
    stopWake() {
      if (!wake) return;
      wake = false;
      mic?.close();
      mic = null;
      queue.length = 0;
      closeConversation();
      setState("idle");
    },
    openConversation(seconds: number) {
      if (!wake) return;
      clearTimeout(convTimer);
      awakeUntil = Date.now() + seconds * 1000;
      setState("listening");
      convTimer = setTimeout(closeConversation, seconds * 1000);
    },
    setMuted(value: boolean) {
      muted = value;
    },

    async preload() {
      await loadModel();
    },
    onState(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onTranscript(cb) {
      transcriptCbs.add(cb);
      return () => transcriptCbs.delete(cb);
    },
    onAttention(cb) {
      attentionCbs.add(cb);
      return () => attentionCbs.delete(cb);
    },
    onError(cb) {
      errorCbs.add(cb);
      return () => errorCbs.delete(cb);
    },
  };
  return api;
}
