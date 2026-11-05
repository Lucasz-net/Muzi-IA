import type { AgentEvent } from "../core/events";
import { el } from "./dom";

/** Panel desplegable con el historial completo y los pasos de las herramientas. */
export function createHistoryPanel(parent: HTMLElement, onNewConversation: () => void) {
  const list = el("div", { class: "history-list" });
  const newBtn = el("button", { class: "link-btn", text: "Nueva conversación", interactive: true });
  const header = el("div", { class: "history-header" }, el("span", { text: "Historial" }), newBtn);
  const root = el("div", { class: "history hidden", interactive: true }, header, list);
  parent.append(root);

  let assistantEntry: HTMLElement | null = null; // entrada de texto del asistente en curso
  const tools = new Map<string, HTMLElement>();

  const scroll = () => (list.scrollTop = list.scrollHeight);
  const add = (cls: string, text: string) => {
    const node = el("div", { class: `entry ${cls}`, text });
    list.append(node);
    scroll();
    return node;
  };

  newBtn.addEventListener("click", () => {
    list.replaceChildren();
    assistantEntry = null;
    tools.clear();
    onNewConversation();
  });

  return {
    get open() {
      return !root.classList.contains("hidden");
    },
    close() {
      root.classList.add("hidden");
    },
    toggle() {
      root.classList.toggle("hidden");
      scroll();
      return !root.classList.contains("hidden");
    },
    addUser(text: string) {
      assistantEntry = null;
      add("user", text);
    },
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "message":
          if (ev.is_delta) {
            assistantEntry ??= add("assistant", "");
            assistantEntry.textContent += ev.text;
          } else {
            assistantEntry ??= add("assistant", "");
            assistantEntry.textContent = ev.text;
            assistantEntry = null;
          }
          scroll();
          break;
        case "tool_use":
          assistantEntry = null;
          tools.set(ev.tool_id, add("tool", ev.summary));
          break;
        case "tool_result": {
          const node = tools.get(ev.tool_id);
          if (node) {
            node.classList.add(ev.is_error ? "failed" : "ok");
            if (ev.output) node.title = ev.output;
          }
          break;
        }
        case "waiting_permission":
          add("system", `Permiso solicitado: ${ev.tool_name}`);
          break;
        case "error":
          assistantEntry = null;
          add("error", ev.message);
          break;
        case "done":
          assistantEntry = null;
          break;
      }
    },
  };
}
