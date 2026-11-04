/**
 * Proveedor de síntesis de voz. La app solo conoce esta interfaz; para cambiar de motor
 * (Piper/Kokoro local, ElevenLabs...) se implementa otro `TTSProvider` y se elige en `createTTS`.
 */
export interface SpeakOptions {
  rate?: number;
  pitch?: number;
}

export interface TTSProvider {
  readonly id: string;
  /** False si el motor no está disponible en este sistema. */
  readonly available: boolean;
  readonly speaking: boolean;
  /** Resuelve cuando termina de hablar (o se cancela). Hablar de nuevo corta lo anterior. */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  cancel(): void;
  onSpeakingChange(cb: (speaking: boolean) => void): () => void;
  /** Avance del habla por palabras (si el motor lo soporta): útil para el lipsync. */
  onBoundary(cb: (charIndex: number, text: string) => void): () => void;
}
