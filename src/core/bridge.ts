import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentConfig, AgentEvent, ConfigView } from "./events";

/** Posición global del cursor relativa a la ventana (px lógicos), emitida por el backend. */
export const cursor = {
  onMove(handler: (x: number, y: number) => void): Promise<UnlistenFn> {
    return listen<{ x: number; y: number }>("cursor-moved", (e) => handler(e.payload.x, e.payload.y));
  },
};

/** Control de la aplicación (cierre). */
export const app = {
  quit: () => invoke<void>("quit_app"),
  /** Muestra u oculta la ventana (Mizu sigue trabajando oculta; se controla también desde la bandeja). */
  setVisible: (visible: boolean) => invoke<void>("set_window_visible", { visible }),
};

/** Un recuerdo de Mizu sobre la persona (ver `memory.rs`). */
export interface MemoryNote {
  id: string;
  text: string;
  created: number;
}

export const memory = {
  list: () => invoke<MemoryNote[]>("memory_list"),
  remove: (id: string) => invoke<void>("memory_delete", { id }),
  clear: () => invoke<void>("memory_clear"),
};

/** Estado del motor de voz en vivo (VOICEVOX local, ver `voicevox.rs`). */
export interface VoiceEngineStatus {
  running: boolean;
  installed: boolean;
  launched: boolean;
  path: string | null;
}

export const voiceEngine = {
  status: () => invoke<VoiceEngineStatus>("voice_engine_status"),
  start: () => invoke<VoiceEngineStatus>("voice_engine_start"),
  stop: () => invoke<void>("voice_engine_stop"),
  warmup: (speaker: number) => invoke<void>("voice_warmup", { speaker }),
  /** Consulta de audio (JSON) de un texto japonés. */
  query: (text: string, speaker: number) => invoke<string>("voice_query", { text, speaker }),
  /** Audio WAV de una consulta. */
  synthesis: (query: string, speaker: number) => invoke<ArrayBuffer>("voice_synthesis", { query, speaker }),
};

/** Puente tipado con el backend. Toda la comunicación con Rust pasa por aquí. */
export const agent = {
  onEvent(handler: (ev: AgentEvent) => void): Promise<UnlistenFn> {
    return listen<AgentEvent>("agent-event", (e) => handler(e.payload));
  },
  send: (text: string) => invoke<void>("agent_send", { text }),
  stop: () => invoke<void>("agent_stop"),
  newConversation: () => invoke<void>("agent_new_conversation"),
  /** `updatedInput` sustituye a la entrada original al aceptar (así se devuelven las respuestas de una pregunta). */
  respondPermission: (requestId: string, allow: boolean, message?: string, updatedInput?: unknown) =>
    invoke<void>("agent_respond_permission", { requestId, allow, message: message ?? null, updatedInput: updatedInput ?? null }),
  getConfig: () => invoke<ConfigView>("agent_get_config"),
  setConfig: (config: AgentConfig) => invoke<ConfigView>("agent_set_config", { config }),
  /** Cambia la forma de hablar sin perder la conversación. */
  setPersona: (persona: string) => invoke<ConfigView>("agent_set_persona", { persona }),
  /** Activa o desactiva el control del PC sin perder la conversación. */
  setDesktop: (enabled: boolean) => invoke<ConfigView>("agent_set_desktop", { enabled }),
};
