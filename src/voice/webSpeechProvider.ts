import type { Mood, SpeakOptions, TTSProvider } from "./tts";

/** Ritmo y tono de la voz de Windows para cada ánimo. */
const MOOD_VOICE: Record<Mood, { rate: number; pitch: number }> = {
  neutral: { rate: 1.05, pitch: 1.15 },
  alegre: { rate: 1.15, pitch: 1.3 },
  calma: { rate: 0.95, pitch: 1.0 },
  atenta: { rate: 1.05, pitch: 1.2 },
};

/** TTS con la Web Speech API (SpeechSynthesis) del WebView. Sin dependencias ni red. */
export class WebSpeechProvider implements TTSProvider {
  readonly id = "web-speech";
  readonly available = typeof window !== "undefined" && "speechSynthesis" in window;
  speaking = false;

  private voice: SpeechSynthesisVoice | null = null;
  private speakingCbs = new Set<(s: boolean) => void>();
  private boundaryCbs = new Set<(i: number, t: string) => void>();

  constructor(private lang = "es") {
    if (!this.available) return;
    this.pickVoice();
    // Las voces se cargan de forma asíncrona.
    speechSynthesis.addEventListener("voiceschanged", () => this.pickVoice());
  }

  private pickVoice() {
    const voices = speechSynthesis.getVoices();
    const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(this.lang));
    // Prefiere voces neuronales ("Natural"/"Online") si existen.
    const best =
      matching.find((v) => /natural|online/i.test(v.name)) ?? matching[0] ?? null;
    this.voice = best;
    console.info(
      `[tts] ${voices.length} voces; elegida: ${best ? `${best.name} (${best.lang})` : "ninguna ‘" + this.lang + "’, se usa la predeterminada"}`,
    );
  }

  private setSpeaking(value: boolean) {
    if (this.speaking === value) return;
    this.speaking = value;
    this.speakingCbs.forEach((cb) => cb(value));
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.available || !text.trim()) return Promise.resolve();
    speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang ?? this.lang;
      const mood = MOOD_VOICE[opts.mood ?? "neutral"];
      u.rate = opts.rate ?? mood.rate;
      u.pitch = opts.pitch ?? mood.pitch;
      u.onstart = () => this.setSpeaking(true);
      u.onboundary = (e) => this.boundaryCbs.forEach((cb) => cb(e.charIndex, text));
      const finish = () => {
        this.setSpeaking(false);
        resolve();
      };
      u.onend = finish;
      u.onerror = finish; // incluye "canceled" al cortar con cancel()
      speechSynthesis.speak(u);
    });
  }

  cancel() {
    if (this.available) speechSynthesis.cancel();
    this.setSpeaking(false);
  }

  onSpeakingChange(cb: (speaking: boolean) => void) {
    this.speakingCbs.add(cb);
    return () => this.speakingCbs.delete(cb);
  }

  onBoundary(cb: (charIndex: number, text: string) => void) {
    this.boundaryCbs.add(cb);
    return () => this.boundaryCbs.delete(cb);
  }
}

/** Punto único donde se elige el motor de voz. */
export function createTTS(): import("./tts").TTSProvider {
  return new WebSpeechProvider("es");
}
