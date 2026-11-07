/**
 * Proveedor de síntesis de voz. La app solo conoce esta interfaz; para cambiar de motor
 * (Piper/Kokoro local, ElevenLabs...) se implementa otro `TTSProvider` y se elige en `createTTS`.
 */
/**
 * Ánimo con el que se dice una frase. Lo elige quien habla según lo que pasa (tests que pasan, un error, un permiso...)
 * y el motor lo traduce a ritmo y entonación. `neutral` es la voz de siempre.
 */
export type Mood = "neutral" | "alegre" | "calma" | "atenta";

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  mood?: Mood;
}

export interface TTSProvider {
  readonly id: string;
  /** False si el motor no está disponible en este sistema. */
  readonly available: boolean;
  readonly speaking: boolean;
  /** Resuelve cuando termina de hablar (o se cancela). Hablar de nuevo corta lo anterior. */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /**
   * Añade texto a continuación de lo que esté sonando, sin cortarlo (para hablar mientras llega una respuesta).
   * Resuelve cuando ese texto termina de sonar. Si el motor no lo soporta, se usa `speak`.
   */
  enqueue?(text: string, opts?: SpeakOptions): Promise<void>;
  cancel(): void;
  /** Volumen propio de Mizu, de 0 a 1 (además del volumen de Windows). */
  setVolume?(volume: number): void;
  onSpeakingChange(cb: (speaking: boolean) => void): () => void;
  /** Avance del habla por palabras (si el motor lo soporta): útil para el lipsync. */
  onBoundary(cb: (charIndex: number, text: string) => void): () => void;
}
