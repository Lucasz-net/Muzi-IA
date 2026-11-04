import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { agent } from "../core/bridge";
import { el } from "./dom";
import { icon, setIcon } from "./icons";

export interface MenuHandlers {
  onToggleChat: () => void;
  onToggleHistory: () => void;
  /** Alterna la voz; devuelve el nuevo estado. */
  onToggleVoice: () => boolean;
  voiceEnabled: boolean;
  /** Alterna cuerpo completo / plano medio; devuelve la nueva vista. */
  onToggleView: () => "full" | "upper";
  view: "full" | "upper";
  onStop: () => void;
  onQuit: () => void;
}

/** Se pliega solo tras este tiempo sin usarlo (ms). */
const AUTO_COLLAPSE_MS = 5000;
/** Movimiento (px) a partir del cual pulsar el punto se considera arrastrar la ventana. */
const DRAG_THRESHOLD = 4;

/**
 * Menú desplegable junto al personaje. Plegado solo se ve un punto discreto (que también
 * sirve para mover la ventana); el botón de detener aparece aparte mientras hay una tarea.
 */
export function createMenu(parent: HTMLElement, h: MenuHandlers) {
  const btn = (name: Parameters<typeof icon>[0], title: string, extra = "") => {
    const b = el("button", { class: `icon-btn ${extra}`.trim(), title, interactive: true });
    b.append(icon(name));
    return b;
  };

  const trigger = btn("menu", "Menú (arrastra para mover la ventana)", "menu-trigger");
  const stopBtn = btn("stop", "Detener la tarea", "stop hidden");
  const chatBtn = btn("chat", "Abrir chat");
  const folderBtn = btn("folder", "Carpeta de trabajo");
  const historyBtn = btn("history", "Historial");
  const voiceBtn = btn("volume", "");
  const viewBtn = btn("zoomIn", "");
  const quitBtn = btn("close", "Cerrar Mizu-IA", "quit");

  const items = el(
    "div",
    { class: "menu-items" },
    chatBtn,
    folderBtn,
    historyBtn,
    voiceBtn,
    viewBtn,
    el("div", { class: "menu-sep" }),
    quitBtn,
  );
  const root = el("div", { class: "menu" }, trigger, stopBtn, items);
  parent.append(root);

  // --- Plegar / desplegar ---
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;
  const setOpen = (open: boolean) => {
    root.classList.toggle("open", open);
    clearTimeout(collapseTimer);
    if (open) collapseTimer = setTimeout(() => setOpen(false), AUTO_COLLAPSE_MS);
  };
  const keepOpen = () => {
    if (root.classList.contains("open")) setOpen(true); // reinicia el temporizador
  };
  items.addEventListener("mousemove", keepOpen);
  items.addEventListener("click", keepOpen);
  window.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));

  // El punto: clic = plegar/desplegar; arrastrar = mover la ventana.
  trigger.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    const onMove = (m: MouseEvent) => {
      if (Math.hypot(m.clientX - sx, m.clientY - sy) > DRAG_THRESHOLD) {
        cleanup();
        getCurrentWindow().startDragging().catch(console.error);
      }
    };
    const onUp = () => {
      cleanup();
      setOpen(!root.classList.contains("open"));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // --- Acciones ---
  const showVoice = (on: boolean) => {
    setIcon(voiceBtn, on ? "volume" : "mute");
    voiceBtn.title = on ? "Voz activada (clic para silenciar)" : "Voz silenciada (clic para activar)";
  };
  showVoice(h.voiceEnabled);

  const showView = (view: "full" | "upper") => {
    setIcon(viewBtn, view === "full" ? "zoomIn" : "zoomOut");
    viewBtn.title = view === "full" ? "Acercar (plano medio)" : "Alejar (cuerpo completo)";
  };
  showView(h.view);
  viewBtn.addEventListener("click", () => showView(h.onToggleView()));

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
    setChatOpen: (isOpen: boolean) => {
      chatBtn.classList.toggle("active", isOpen);
      chatBtn.title = isOpen ? "Cerrar chat" : "Abrir chat";
    },
    setHistoryOpen: (isOpen: boolean) => historyBtn.classList.toggle("active", isOpen),
  };
}
