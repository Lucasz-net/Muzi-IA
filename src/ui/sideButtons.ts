import { open } from "@tauri-apps/plugin-dialog";
import { agent } from "../core/bridge";
import { el } from "./dom";

export interface SideButtonsHandlers {
  onToggleChat: () => void;
  onToggleHistory: () => void;
  /** Alterna la voz; devuelve el nuevo estado. */
  onToggleVoice: () => boolean;
  voiceEnabled: boolean;
  onStop: () => void;
  onQuit: () => void;
}

/** Columna de botones junto al personaje: chat, carpeta, historial, voz, detener y cerrar. */
export function createSideButtons(parent: HTMLElement, h: SideButtonsHandlers) {
  const btn = (text: string, title: string, extra = "") =>
    el("button", { class: `icon-btn ${extra}`.trim(), text, title, interactive: true });

  const chatBtn = btn("💬", "Abrir chat");
  const folderBtn = btn("📁", "Carpeta de trabajo");
  const historyBtn = btn("🕘", "Historial");
  const voiceBtn = btn("🔊", "");
  const stopBtn = btn("■", "Detener la tarea", "stop hidden");
  const quitBtn = btn("✕", "Cerrar Mizu-IA", "quit");

  // `data-drag`: arrastrar desde la columna (asa o huecos entre botones) mueve la ventana.
  const grip = el("div", { class: "grip", text: "⠿⠿", title: "Arrastrar para mover" });
  const column = el(
    "div",
    { class: "side", interactive: true },
    grip,
    chatBtn,
    folderBtn,
    historyBtn,
    voiceBtn,
    stopBtn,
    el("div", { class: "side-sep" }),
    quitBtn,
  );
  column.dataset.drag = "";
  parent.append(column);

  const showVoice = (on: boolean) => {
    voiceBtn.textContent = on ? "🔊" : "🔇";
    voiceBtn.title = on ? "Voz activada (clic para silenciar)" : "Voz silenciada (clic para activar)";
  };
  showVoice(h.voiceEnabled);

  chatBtn.addEventListener("click", h.onToggleChat);
  historyBtn.addEventListener("click", h.onToggleHistory);
  voiceBtn.addEventListener("click", () => showVoice(h.onToggleVoice()));
  stopBtn.addEventListener("click", h.onStop);
  quitBtn.addEventListener("click", h.onQuit);

  const refreshFolder = async () => {
    const cfg = await agent.getConfig();
    folderBtn.title = `Carpeta de trabajo:\n${cfg.effective_cwd}\n(clic para cambiar)`;
  };
  folderBtn.addEventListener("click", async () => {
    const cfg = await agent.getConfig();
    const picked = await open({ directory: true, defaultPath: cfg.effective_cwd });
    if (typeof picked === "string") {
      const { effective_cwd: _ignored, ...config } = cfg;
      await agent.setConfig({ ...config, cwd: picked });
      await refreshFolder();
    }
  });
  refreshFolder().catch(console.error);

  return {
    setBusy: (busy: boolean) => stopBtn.classList.toggle("hidden", !busy),
    setChatOpen: (open: boolean) => {
      chatBtn.classList.toggle("active", open);
      chatBtn.title = open ? "Cerrar chat" : "Abrir chat";
    },
    setHistoryOpen: (open: boolean) => historyBtn.classList.toggle("active", open),
  };
}
