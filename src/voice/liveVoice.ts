import { voiceEngine } from "../core/bridge";
import type { JaLine, JaVoice, MouthCue } from "./jaVoice";
import type { SpokenLine } from "./voiceTags";

/**
 * Voz en vivo: lo que Mizu decide decir en cada momento (ver `voiceTags.ts`) se sintetiza al instante con el motor
 * VOICEVOX local, con la misma voz que las frases grabadas (四国めたん・あまあま), y suena por el mismo reproductor
 * (`jaVoice.ts`), así que lleva subtítulo, traducción y boca. Las frases se preparan mientras suena la anterior y
 * salen en orden. Si el motor no está, no se dice nada aquí y la app sigue con las frases grabadas.
 */
export type LiveStatus = "off" | "missing" | "starting" | "ready";

/** 四国めたん・あまあま: la misma voz que los audios grabados. */
const SPEAKER = 0;
/** Cuánto se espera a que el motor arranque (carga unos segundos la primera vez). */
const START_TIMEOUT_MS = 90_000;
/** Una frase que tarda más que esto en llegar a sonar ya no viene a cuento: se descarta. */
const STALE_MS = 25_000;

interface AudioQuery {
  accent_phrases: {
    moras: { vowel: string; consonant_length?: number | null; vowel_length: number }[];
    pause_mora?: { vowel_length: number } | null;
  }[];
  speedScale: number;
  intonationScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLengthScale?: number;
  outputSamplingRate: number;
  outputStereo: boolean;
}

const VOWELS: Record<string, MouthCue["v"]> = { a: "aa", i: "ih", u: "ou", e: "ee", o: "oh" };

/** Instante de cada sílaba y su vocal, según las duraciones que calcula el motor. */
function mouthCues(q: AudioQuery): MouthCue[] {
  const cues: MouthCue[] = [];
  let t = q.prePhonemeLength;
  for (const phrase of q.accent_phrases) {
    for (const m of phrase.moras) {
      const v = VOWELS[m.vowel.toLowerCase()];
      t += m.consonant_length ?? 0;
      if (v) cues.push({ at: (t / q.speedScale) * 1000, v });
      t += m.vowel_length;
    }
    if (phrase.pause_mora) t += phrase.pause_mora.vowel_length * (q.pauseLengthScale ?? 1);
  }
  return cues;
}

/** Duración (ms) de un WAV PCM leyendo su cabecera. */
function wavMs(buf: ArrayBuffer): number {
  const v = new DataView(buf);
  if (buf.byteLength < 44) return 0;
  const byteRate = v.getUint32(28, true);
  return byteRate ? Math.round(((buf.byteLength - 44) / byteRate) * 1000) : 0;
}

interface Job {
  line: SpokenLine;
  at: number;
  ready: Promise<{ url: string; cues: MouthCue[]; ms: number; lead: number; tail: number } | null>;
}

export function createLiveVoice(ja: JaVoice, { wanted }: { wanted: () => boolean }) {
  let status: LiveStatus = "off";
  let generation = 0; // cambia al cancelar: lo que estuviera en camino se descarta
  let queue: Job[] = [];
  let playing = false;
  let turnLines = 0;
  let counter = 0;
  const statusCbs = new Set<(s: LiveStatus) => void>();

  const setStatus = (s: LiveStatus) => {
    if (s === status) return;
    status = s;
    statusCbs.forEach((cb) => cb(s));
  };

  /** Arranca el motor si hace falta y espera a que responda. */
  let ensuring: Promise<void> | null = null;
  const ensure = () =>
    (ensuring ??= (async () => {
      try {
        let st = await voiceEngine.start();
        if (!st.running && !st.installed) return setStatus("missing");
        if (!st.running) {
          setStatus("starting");
          const until = Date.now() + START_TIMEOUT_MS;
          while (!st.running && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 1500));
            st = await voiceEngine.status();
            if (!st.running && !st.launched) return setStatus("missing"); // el motor se cerró al arrancar
          }
          if (!st.running) return setStatus("missing");
        }
        // La primera frase de un hablante carga su modelo: se hace ya, en silencio.
        if (status !== "ready") {
          setStatus("starting");
          await voiceEngine.warmup(SPEAKER).catch(() => {});
        }
        setStatus(wanted() ? "ready" : "off");
      } catch (err) {
        console.error("Voz en vivo:", err);
        setStatus("missing");
      } finally {
        ensuring = null;
      }
    })());

  const synthesize = async (text: string) => {
    const q = JSON.parse(await voiceEngine.query(text, SPEAKER)) as AudioQuery;
    // Igual que los audios grabados: algo más expresiva y con poco silencio delante y detrás.
    Object.assign(q, { intonationScale: 1.15, prePhonemeLength: 0.05, postPhonemeLength: 0.15, outputSamplingRate: 24000, outputStereo: false });
    const wav = await voiceEngine.synthesis(JSON.stringify(q), SPEAKER);
    return {
      url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })),
      cues: mouthCues(q),
      ms: wavMs(wav),
      lead: Math.round((q.prePhonemeLength / q.speedScale) * 1000),
      tail: Math.round((q.postPhonemeLength / q.speedScale) * 1000),
    };
  };

  const pump = async () => {
    if (playing) return;
    playing = true;
    const mine = generation;
    try {
      while (queue.length && mine === generation) {
        const job = queue[0];
        const audio = await job.ready;
        if (mine !== generation) {
          if (audio) URL.revokeObjectURL(audio.url);
          break;
        }
        queue.shift();
        if (!audio) continue;
        if (Date.now() - job.at > STALE_MS) {
          URL.revokeObjectURL(audio.url);
          continue;
        }
        // Deja terminar la frase grabada que esté sonando (son cortas) antes de hablar encima.
        for (let waited = 0; ja.speaking && waited < 2500 && mine === generation; waited += 80) await new Promise((r) => setTimeout(r, 80));
        if (mine !== generation) {
          URL.revokeObjectURL(audio.url);
          break;
        }
        const line: JaLine = { id: `live_${++counter}`, ja: job.line.ja, es: job.line.es, ms: audio.ms, leadMs: audio.lead, tailMs: audio.tail };
        await ja.playLive(line, audio.url, audio.cues);
      }
    } finally {
      playing = false;
      if (mine === generation) ja.setReserved(queue.length > 0);
      if (queue.length && mine !== generation) void pump();
    }
  };

  return {
    get status() {
      return status;
    },
    /** Se puede hablar en vivo ahora mismo. */
    get ready() {
      return status === "ready";
    },
    /** Frases en vivo dichas (o en camino) desde el último mensaje del usuario. */
    get turnLines() {
      return turnLines;
    },
    /** Hay una frase en vivo sonando o esperando. */
    get busy() {
      return playing || queue.length > 0;
    },
    onStatus(cb: (s: LiveStatus) => void) {
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
    /** Aplica el ajuste: enciende (arrancando el motor si hace falta) o apaga la voz en vivo. */
    async sync() {
      if (!wanted()) {
        this.cancel();
        setStatus("off");
        voiceEngine.stop().catch(() => {});
        return;
      }
      await ensure();
    },
    userSent() {
      turnLines = 0;
      this.cancel();
    },
    /** Dice una frase. Devuelve false si la voz en vivo no está disponible (quien llama recurre a las grabadas). */
    say(line: SpokenLine): boolean {
      if (status !== "ready" || !line.ja) return false;
      turnLines++;
      const gen = generation;
      const ready = synthesize(line.ja).catch((err) => {
        console.error("Voz en vivo:", err);
        // El motor dejó de responder: se vuelve a comprobar (y a arrancar) para la próxima.
        if (gen === generation) void ensure();
        return null;
      });
      queue.push({ line, at: Date.now(), ready });
      ja.setReserved(true);
      void pump();
      return true;
    },
    /** Calla y descarta lo pendiente. */
    cancel() {
      generation++;
      for (const job of queue) void job.ready.then((a) => a && URL.revokeObjectURL(a.url));
      queue = [];
      ja.setReserved(false);
    },
  };
}

export type LiveVoice = ReturnType<typeof createLiveVoice>;
