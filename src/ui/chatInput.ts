import { agent } from "../core/bridge";
import { el } from "./dom";

export interface ChatInputHandlers {
  onSubmit: (text: string) => void;
  /** Se llama al abrir o cerrar la barra (también al cerrar con Escape). */
  onOpenChange: (open: boolean) => void;
}

/** Barra de texto del chat. Oculta por defecto: se abre con el botón 💬. */
export function createChatInput(parent: HTMLElement, h: ChatInputHandlers) {
  const field = el("textarea", { class: "field", interactive: true });
  field.rows = 1;
  field.placeholder = "Escríbele algo…";
  field.spellcheck = false;
  const sendBtn = el("button", { class: "send-btn", text: "➤", title: "Enviar", interactive: true });
  const bar = el("div", { class: "bar hidden", interactive: true }, field, sendBtn);
  parent.append(bar);

  let busy = false;
  let isOpen = false;

  const autosize = () => {
    field.style.height = "auto";
    field.style.height = Math.min(field.scrollHeight, 96) + "px";
  };
  const submit = () => {
    const text = field.value.trim();
    if (!text) return;
    field.value = "";
    autosize();
    h.onSubmit(text);
  };
  const setOpen = (value: boolean) => {
    if (value === isOpen) return;
    isOpen = value;
    bar.classList.toggle("hidden", !value);
    if (value) field.focus();
    h.onOpenChange(value);
  };

  field.addEventListener("input", autosize);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  });
  sendBtn.addEventListener("click", () => (busy ? agent.stop().catch(console.error) : submit()));

  return {
    toggle() {
      setOpen(!isOpen);
      return isOpen;
    },
    setBusy(value: boolean) {
      busy = value;
      sendBtn.textContent = value ? "■" : "➤";
      sendBtn.title = value ? "Detener" : "Enviar";
      sendBtn.classList.toggle("stop", value);
    },
  };
}
