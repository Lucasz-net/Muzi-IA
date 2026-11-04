import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentConfig, AgentEvent, ConfigView } from "./events";

/** Control de la aplicación (cierre). */
export const app = {
  quit: () => invoke<void>("quit_app"),
};

/** Puente tipado con el backend. Toda la comunicación con Rust pasa por aquí. */
export const agent = {
  onEvent(handler: (ev: AgentEvent) => void): Promise<UnlistenFn> {
    return listen<AgentEvent>("agent-event", (e) => handler(e.payload));
  },
  send: (text: string) => invoke<void>("agent_send", { text }),
  stop: () => invoke<void>("agent_stop"),
  newConversation: () => invoke<void>("agent_new_conversation"),
  respondPermission: (requestId: string, allow: boolean, message?: string) =>
    invoke<void>("agent_respond_permission", { requestId, allow, message: message ?? null }),
  getConfig: () => invoke<ConfigView>("agent_get_config"),
  setConfig: (config: AgentConfig) => invoke<ConfigView>("agent_set_config", { config }),
};
