import lines from "./ja/lines.json";

/**
 * La voz de Mizu: frases cortas en japonés pregrabadas (VOICEVOX:四国めたん), elegidas al azar según lo que pasa.
 * No sintetiza nada en ejecución: los audios (assets/voice/ja) y el manifiesto (ja/lines.json) los genera
 * `tools/voicevox/generate.mjs` a partir de `tools/voicevox/lines.mjs`.
 *
 * Mientras suena una frase se avisa de cuántas letras del subtítulo toca mostrar (siguiendo el audio) y se empuja
 * la boca con cada sílaba, para el lipsync.
 */
export interface JaLine {
  id: string;
  ja: string;
  es: string;
  ms: number;
  leadMs: number;
  tailMs: number;
}

export type JaCategory = keyof typeof lines;

const files = import.meta.glob<string>("/assets/voice/ja/*.wav", { query: "?url", import: "default", eager: true });
const urlOf = (id: string) => files[`/assets/voice/ja/${id}.wav`];
const manifest = lines as unknown as Record<string, JaLine[]>;

/** Cuánto dura (peso relativo) decir cada carácter: los kanji llevan más sílabas y los signos son pausas. */
function charWeight(ch: string): number {
  if (/[ゃゅょャュョぁぃぅぇぉァィゥェォ]/.test(ch)) return 0.3; // se funden con la sílaba anterior
  if (/[。！？!?]/.test(ch)) return 2.4;
  if (/[…]/.test(ch)) return 2;
  if (/[、，,]/.test(ch)) return 1.4;
  if (/[\s　]/.test(ch)) return 0.4;
  if (/[♪〜~]/.test(ch)) return 1.2;
  if (/[一-鿿]/.test(ch)) return 2.2;
  return 1;
}

/** Instante (ms desde el inicio del audio) en que debe aparecer cada carácter. */
export function revealTimes(line: JaLine): number[] {
  const chars = [...line.ja];
  const weights = chars.map(charWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(line.ms - line.leadMs - line.tailMs, 200);
  let acc = 0;
  return weights.map((w) => {
    const at = line.leadMs + (acc / total) * span;
    acc += w;
    return at;
  });
}

/** Movimiento de boca en un instante del audio: la vocal que suena (visema VRM). */
export interface MouthCue {
  at: number;
  v: "aa" | "ih" | "ou" | "ee" | "oh";
}

export interface JaPlayOptions {
  /** Corta lo que esté sonando (avisos importantes: permisos, "terminé", errores). Si no, la frase se omite si ya está hablando. */
  interrupt?: boolean;
  /** Frase concreta de la categoría (por defecto, una al azar distinta de la última). */
  index?: number;
}

export function createJaVoice() {
  let audio: HTMLAudioElement | null = null;
  let current: JaLine | null = null;
  let times: number[] = [];
  let shown = 0;
  let raf = 0;
  let volume = 1;
  let token = 0;
  /** Sílabas con su vocal e instante (voz en vivo); sin ellas la boca se mueve al ritmo del subtítulo. */
  let cues: MouthCue[] | null = null;
  let cueIndex = 0;
  /** La voz en vivo tiene frases esperando: las grabadas que no sean urgentes se callan. */
  let reserved = false;
  /** URL temporal del audio en curso (voz en vivo), para liberarla al acabar. */
  let blobUrl: string | null = null;
  const lastIndex = new Map<string, number>();
  const speakingCbs = new Set<(s: boolean) => void>();
  const pulseCbs = new Set<(v?: MouthCue["v"]) => void>();
  const lineCbs = new Set<(line: JaLine | null, shown: number) => void>();
  let speaking = false;

  const setSpeaking = (v: boolean) => {
    if (speaking === v) return;
    speaking = v;
    speakingCbs.forEach((cb) => cb(v));
  };

  const release = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  };

  const finish = (t: number) => {
    if (t !== token) return;
    cancelAnimationFrame(raf);
    release();
    audio = null;
    current = null;
    setSpeaking(false);
    lineCbs.forEach((cb) => cb(null, 0));
  };

  const tick = (t: number) => {
    if (t !== token || !audio || !current) return;
    const now = audio.currentTime * 1000;
    if (cues) {
      for (; cueIndex < cues.length && cues[cueIndex].at <= now; cueIndex++) {
        const v = cues[cueIndex].v;
        pulseCbs.forEach((cb) => cb(v));
      }
    }
    let n = shown;
    while (n < times.length && times[n] <= now) n++;
    if (n !== shown) {
      const chars = [...current.ja];
      // Una sílaba nueva (no un signo) empuja la boca.
      if (!cues) for (let i = shown; i < n; i++) if (charWeight(chars[i]) >= 1 && !/[。！？!?…、，,\s]/.test(chars[i])) pulseCbs.forEach((cb) => cb());
      shown = n;
      lineCbs.forEach((cb) => cb(current, shown));
    }
    raf = requestAnimationFrame(() => tick(t));
  };

  const stop = () => {
    token++;
    cancelAnimationFrame(raf);
    if (audio) {
      audio.onended = null;
      audio.pause();
    }
    audio = null;
    release();
    if (current) lineCbs.forEach((cb) => cb(null, 0));
    current = null;
    setSpeaking(false);
  };

  const begin = (line: JaLine, url: string, mouth: MouthCue[] | null) => {
    stop();
    const t = ++token;
    const a = new Audio(url);
    a.volume = volume;
    audio = a;
    current = line;
    times = revealTimes(line);
    shown = 0;
    cues = mouth;
    cueIndex = 0;
    a.onended = () => finish(t);
    a.onerror = () => finish(t);
    a.play().then(
      () => {
        if (t !== token) return;
        setSpeaking(true);
        lineCbs.forEach((cb) => cb(line, 0));
        raf = requestAnimationFrame(() => tick(t));
      },
      // El navegador puede bloquear el audio hasta el primer clic: entonces no hay voz ni subtítulo.
      () => finish(t),
    );
    return t;
  };

  return {
    get speaking() {
      return speaking;
    },
    /** Categorías disponibles y sus frases (para depurar y para la lista de frases). */
    manifest,
    /** Dice una frase de la categoría. Devuelve false si no la dijo (ya estaba hablando, o la categoría no existe). */
    play(category: JaCategory | string, { interrupt = false, index }: JaPlayOptions = {}): boolean {
      const items = manifest[category];
      if (!items?.length || volume <= 0) return false;
      if ((speaking || reserved) && !interrupt) return false;
      let i = index ?? Math.floor(Math.random() * items.length);
      const prev = lastIndex.get(category);
      if (index === undefined && items.length > 1 && i === prev) i = (i + 1 + Math.floor(Math.random() * (items.length - 1))) % items.length;
      lastIndex.set(category, i);
      const line = items[i];
      const url = urlOf(line.id);
      if (!url) return false;

      begin(line, url, null);
      return true;
    },
    /**
     * Dice una frase sintetizada al momento (voz en vivo): `url` es un audio temporal que se libera al terminar y
     * `mouth`, las sílabas con su vocal. Corta lo que esté sonando. Resuelve cuando termina (o la cortan).
     */
    playLive(line: JaLine, url: string, mouth: MouthCue[]): Promise<void> {
      if (volume <= 0) {
        URL.revokeObjectURL(url);
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const mine = begin(line, url, mouth);
        blobUrl = url;
        const timer = setInterval(() => {
          // Termina cuando esta frase ya no es la que suena (acabó, falló, la cortó otra o el audio estaba bloqueado).
          if (token !== mine || !audio) {
            clearInterval(timer);
            resolve();
          }
        }, 60);
      });
    },
    /** La voz en vivo avisa de que tiene frases pendientes (las grabadas no urgentes esperan). */
    setReserved(v: boolean) {
      reserved = v;
    },
    cancel: stop,
    setVolume(v: number) {
      volume = Math.min(1, Math.max(0, v));
      if (audio) audio.volume = volume;
    },
    onSpeakingChange(cb: (s: boolean) => void) {
      speakingCbs.add(cb);
      return () => speakingCbs.delete(cb);
    },
    /** Una sílaba nueva: para mover la boca. */
    onPulse(cb: (v?: MouthCue["v"]) => void) {
      pulseCbs.add(cb);
      return () => pulseCbs.delete(cb);
    },
    /** Frase actual y cuántos caracteres llevan mostrados (`null` al terminar). */
    onLine(cb: (line: JaLine | null, shown: number) => void) {
      lineCbs.add(cb);
      return () => lineCbs.delete(cb);
    },
  };
}

export type JaVoice = ReturnType<typeof createJaVoice>;
