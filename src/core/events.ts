/** Eventos normalizados que emite el backend (canal `agent-event`). Espejo de `AgentEvent` en Rust. */
export type AgentEvent =
  | { type: "session_started"; session_id: string; model?: string | null }
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "tool_use"; tool_id: string; name: string; input: unknown; summary: string }
  | { type: "tool_result"; tool_id: string; is_error: boolean; output: string }
  | {
      type: "waiting_permission";
      request_id: string;
      tool_name: string;
      input: unknown;
      description?: string | null;
    }
  | { type: "message"; text: string; is_delta: boolean }
  | { type: "done"; session_id?: string | null; duration_ms?: number | null; result?: string | null }
  | { type: "error"; message: string };

export interface AgentConfig {
  adapter: string;
  cwd: string | null;
  command: string | null;
  permission_mode: string | null;
}

export interface ConfigView extends AgentConfig {
  effective_cwd: string;
}
