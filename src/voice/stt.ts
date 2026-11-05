/**
 * Reconocimiento de voz (voz a texto). Igual que `TTSProvider`: la app solo conoce esta interfaz y
 * el motor concreto (Whisper local hoy) se puede cambiar sin tocar la interfaz.
 *
 * Dos formas de usarlo:
 *  - Pulsar y hablar (`start`): abre el micrófono, espera una frase y lo cierra.
 *  - Escucha continua (`startWake`): el micrófono queda abierto y solo se hace caso a las frases que
 *    empiezan por la palabra de activación ("Mizu, abre Steam").
 */
export type ListenState =
  | "idle"
  /** Descargando o preparando el modelo (la primera vez tarda). */
  | "loading"
  /** Micrófono abierto y atento a lo que dices ahora (pulsar y hablar, o ventana de conversación abierta). */
  | "listening"
  /** Ya hablaste: se está transcribiendo. */
  | "transcribing"
  /** Escucha continua: a la espera de la palabra de activación. */
  | "standby";

export interface STTProvider {
  readonly id: string;
  /** Dónde corre el modelo una vez cargado: `webgpu` (tarjeta gráfica) o `wasm` (CPU). */
  readonly backend: "none" | "webgpu" | "wasm";
  readonly state: ListenState;
  /** La escucha continua está encendida. */
  readonly waking: boolean;
  /** Lo último que oyó en escucha continua (también lo descartado), para depurar. */
  readonly heard: { text: string; secs: number; accepted: boolean }[];

  // --- Pulsar y hablar ---
  /** Abre el micrófono; al callar (o al llamar a `finish`) transcribe y emite el texto. */
  start(): Promise<void>;
  /** Corta ya la grabación y transcribe lo que haya. */
  finish(): void;
  /** Descarta lo grabado sin transcribir. */
  cancel(): void;

  // --- Escucha continua con palabra de activación ---
  startWake(): Promise<void>;
  stopWake(): void;
  /** Durante estos segundos la siguiente frase se acepta sin decir la palabra de activación. */
  openConversation(seconds: number): void;
  /** Ignora el audio (por ejemplo mientras el personaje habla, para que no se oiga a sí mismo). */
  setMuted(muted: boolean): void;

  /** Descarga y prepara el modelo de antemano. */
  preload(): Promise<void>;
  onState(cb: (state: ListenState, detail?: string) => void): () => void;
  /** Una orden ya transcrita (sin la palabra de activación). */
  onTranscript(cb: (text: string) => void): () => void;
  /** Se oyó solo la palabra de activación: el personaje debe mostrar que está atento. */
  onAttention(cb: () => void): () => void;
  onError(cb: (message: string) => void): () => void;
}
