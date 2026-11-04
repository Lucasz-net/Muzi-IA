import type { AgentEvent } from "../core/events";
import { el } from "./dom";

/** Globo de diálogo con la respuesta actual y una línea de estado. */
export function createSpeechBubble(parent: HTMLElement) {
  const status = el("div", { class: "bubble-status" });
  const body = el("div", { class: "bubble-body" });
  const root = el("div", { class: "bubble hidden", interactive: true, title: "Clic para ocultar" }, status, body);
  root.addEventListener("click", () => root.classList.add("hidden"));
  parent.append(root);

  let text = "";
  let newBlock = true; // el siguiente fragmento empieza un bloque de texto nuevo

  const show = () => root.classList.remove("hidden");
  const setStatus = (s: string) => {
    status.textContent = s;
    status.classList.toggle("empty", !s);
  };
  const render = () => {
    body.textContent = text;
    body.scrollTop = body.scrollHeight;
  };

  return {
    /** Llamar al enviar un mensaje del usuario. */
    reset() {
      text = "";
      newBlock = true;
      render();
      setStatus("Pensando…");
      show();
    },
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "thinking":
          if (!text) setStatus("Pensando…");
          break;
        case "tool_use":
          setStatus(`Trabajando — ${ev.summary}`);
          newBlock = true;
          show();
          break;
        case "waiting_permission":
          setStatus(`Necesito tu permiso para ${ev.tool_name}`);
          show();
          break;
        case "message":
          if (ev.is_delta) {
            if (newBlock) text = "";
            newBlock = false;
            text += ev.text;
          } else {
            text = ev.text;
            newBlock = true;
          }
          setStatus("");
          render();
          show();
          break;
        case "done":
          setStatus("");
          if (!text && ev.result) {
            text = ev.result;
            render();
          }
          break;
        case "error":
          setStatus("Error");
          text = ev.message;
          newBlock = true;
          render();
          show();
          break;
        case "idle":
          setStatus("");
          break;
      }
    },
  };
}
