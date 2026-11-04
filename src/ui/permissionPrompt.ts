import { agent } from "../core/bridge";
import type { AgentEvent } from "../core/events";
import { el } from "./dom";

type Input = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) + "…" : s);

/** Título y detalle legibles según la herramienta que pide permiso. */
function describe(tool: string, raw: unknown, description?: string | null) {
  const input = (raw && typeof raw === "object" ? raw : {}) as Input;
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return {
        title: "¿Ejecutar este comando?",
        detail: clip(str(input.command), 400),
        note: description ?? str(input.description),
      };
    case "Edit":
      return {
        title: "¿Editar este archivo?",
        detail: str(input.file_path),
        note: `− ${clip(str(input.old_string).split("\n")[0], 80)}\n+ ${clip(str(input.new_string).split("\n")[0], 80)}`,
      };
    case "Write":
      return {
        title: "¿Escribir este archivo?",
        detail: str(input.file_path),
        note: `${str(input.content).length} caracteres`,
      };
    case "WebFetch":
      return { title: "¿Abrir esta página?", detail: str(input.url), note: "" };
    case "WebSearch":
      return { title: "¿Buscar en internet?", detail: str(input.query), note: "" };
    default: {
      const json = JSON.stringify(raw ?? {});
      return { title: `¿Permitir ${tool}?`, detail: clip(description || json, 300), note: "" };
    }
  }
}

/** Solicitudes de permiso con botones Aceptar / Rechazar (en cola si hay varias). */
export function createPermissionPrompt(parent: HTMLElement) {
  const root = el("div", { class: "permissions" });
  parent.append(root);

  const cards = new Map<string, HTMLElement>();

  const resolve = (id: string, allow: boolean) => {
    agent.respondPermission(id, allow).catch(console.error);
    cards.get(id)?.remove();
    cards.delete(id);
  };

  return {
    handle(ev: AgentEvent) {
      if (ev.type === "waiting_permission") {
        const { title, detail, note } = describe(ev.tool_name, ev.input, ev.description);
        const accept = el("button", { class: "btn accept", text: "Aceptar", interactive: true });
        const reject = el("button", { class: "btn reject", text: "Rechazar", interactive: true });
        accept.addEventListener("click", () => resolve(ev.request_id, true));
        reject.addEventListener("click", () => resolve(ev.request_id, false));
        const card = el(
          "div",
          { class: "perm-card", interactive: true },
          el("div", { class: "perm-title", text: title }),
          el("div", { class: "perm-detail", text: detail }),
        );
        if (note) card.append(el("div", { class: "perm-note", text: note }));
        card.append(el("div", { class: "perm-actions" }, reject, accept));
        cards.set(ev.request_id, card);
        root.append(card);
      } else if (ev.type === "idle" || ev.type === "error" || ev.type === "done") {
        // La sesión terminó o se interrumpió: las solicitudes pendientes ya no son válidas.
        cards.forEach((c) => c.remove());
        cards.clear();
      }
    },
  };
}
