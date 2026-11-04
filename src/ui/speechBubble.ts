import type { AgentEvent } from "../core/events";
import { el } from "./dom";
import { icon } from "./icons";
import { renderMarkdown } from "./markdown";

/** Globo de diálogo junto al personaje: etiqueta con el nombre, estado y la respuesta con formato. */
export function createSpeechBubble(parent: HTMLElement) {
  const status = el("span", { class: "bubble-status" });
  const closeBtn = el("button", { class: "bubble-close", title: "Ocultar", interactive: true }, icon("close"));
  const head = el(
    "div",
    { class: "bubble-head" },
    el("span", { class: "bubble-name", text: "Mizu" }),
    status,
    closeBtn,
  );
  const body = el("div", { class: "bubble-body" });
  const root = el("div", { class: "bubble hidden", interactive: true }, head, body);
  parent.append(root);

  const hide = () => root.classList.add("hidden");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hide();
  });
  root.addEventListener("dblclick", hide);

  let text = "";
  let newBlock = true; // el siguiente fragmento empieza un bloque de texto nuevo

  const show = () => {
    if (root.classList.contains("hidden")) {
      root.classList.remove("hidden");
      // Reinicia la animación de entrada.
      root.classList.remove("pop");
      void root.offsetWidth;
      root.classList.add("pop");
    }
  };
  const setStatus = (s: string, busy = false) => {
    status.textContent = s;
    status.classList.toggle("empty", !s);
    status.classList.toggle("busy", busy);
  };
  const render = () => {
    body.innerHTML = renderMarkdown(text);
    body.classList.toggle("empty", !text);
    body.scrollTop = body.scrollHeight;
  };

  return {
    /** Llamar al enviar un mensaje del usuario. */
    reset() {
      text = "";
      newBlock = true;
      render();
      setStatus("Pensando", true);
      show();
    },
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "thinking":
          if (!text) setStatus("Pensando", true);
          break;
        case "tool_use":
          setStatus(ev.summary, true);
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
