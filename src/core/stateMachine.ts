import type { AgentEvent } from "./events";

/** Estados visibles del compañero. */
export type CompanionState =
  | "idle"
  | "thinking"
  | "working" // usando herramientas
  | "waiting_permission"
  | "responding" // escribiendo/diciendo la respuesta
  | "celebrating" // terminó la tarea (temporal)
  | "error"; // (temporal)

export interface StateMachineOptions {
  celebrateMs?: number;
  errorMs?: number;
}

export interface StateMachine {
  readonly state: CompanionState;
  /** Alimenta la máquina con un evento normalizado del agente. */
  handle(ev: AgentEvent): void;
  /** El usuario acaba de enviar un mensaje: reacciona antes de que el CLI responda. */
  userSent(): void;
  /** Fuerza un estado (depuración). */
  force(state: CompanionState): void;
  onChange(cb: (state: CompanionState, prev: CompanionState) => void): () => void;
}

export function createStateMachine(opts: StateMachineOptions = {}): StateMachine {
  const celebrateMs = opts.celebrateMs ?? 2800;
  const errorMs = opts.errorMs ?? 3500;

  let state: CompanionState = "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** En este turno se usaron herramientas: al terminar hay algo que celebrar (una simple respuesta de charla no). */
  let worked = false;
  const listeners = new Set<(s: CompanionState, p: CompanionState) => void>();

  const set = (next: CompanionState, revertAfterMs?: number) => {
    clearTimeout(timer);
    timer = undefined;
    if (revertAfterMs !== undefined) timer = setTimeout(() => set("idle"), revertAfterMs);
    if (next === state) return;
    const prev = state;
    state = next;
    listeners.forEach((cb) => cb(state, prev));
  };

  return {
    get state() {
      return state;
    },
    handle(ev) {
      switch (ev.type) {
        case "thinking":
          set("thinking");
          break;
        case "tool_use":
          worked = true;
          set("working");
          break;
        case "tool_result":
          // Tras aprobar/rechazar un permiso, la herramienta termina: volvemos a trabajar.
          if (state === "waiting_permission") set("working");
          break;
        case "waiting_permission":
          set("waiting_permission");
          break;
        case "message":
          set("responding");
          break;
        case "done":
          // Solo celebra un trabajo hecho; tras charlar un rato vuelve al reposo sin dar saltos.
          if (worked) set("celebrating", celebrateMs);
          else set("idle");
          worked = false;
          break;
        case "error":
          set("error", errorMs);
          break;
        case "idle":
          set("idle");
          break;
        case "session_started":
          break;
      }
    },
    userSent() {
      worked = false;
      set("thinking");
    },
    force(next) {
      set(next);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
