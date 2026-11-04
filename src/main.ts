import { getCurrentWindow } from "@tauri-apps/api/window";
import { agent, app, cursor } from "./core/bridge";
import { setupClickThrough } from "./core/clickThrough";
import { createStateMachine } from "./core/stateMachine";
import { createScene } from "./character/scene";
import { createChatInput } from "./ui/chatInput";
import { createHistoryPanel } from "./ui/historyPanel";
import { createPermissionPrompt } from "./ui/permissionPrompt";
import { watchDialogSide } from "./ui/layout";
import { createMenu } from "./ui/menu";
import { createSpeechBubble } from "./ui/speechBubble";
import { createAnnouncer } from "./voice/announcer";
import { createTTS } from "./voice/webSpeechProvider";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const stage = createScene(canvas);

// --- Máquina de estados: eventos del agente -> animaciones ---
const machine = createStateMachine();
machine.onChange((state) => stage.setState(state));

// --- Voz ---
const tts = createTTS();
const announcer = createAnnouncer(tts);

// La voz mueve la boca (lipsync) y el cursor atrae la mirada.
tts.onSpeakingChange((speaking) => stage.setSpeaking(speaking));
tts.onBoundary(() => stage.pulseMouth());
cursor.onMove((x, y) => stage.setGaze(x, y)).catch(console.error);

// Depuración en desarrollo (consola de la ventana): `mizu.force("celebrating")`, `mizuSay("hola")`.
if (import.meta.env.DEV) {
  const mizuHelp = () =>
    console.info(`Comandos de prueba (consola de la ventana: F12 o clic derecho > Inspeccionar)
  mizu.force("idle" | "thinking" | "working" | "waiting_permission" | "responding" | "celebrating" | "error")
  mizuStage.listClips()                    lista los clips de animación cargados
  mizuStage.playClip("Nombre.fbx")         reproduce un clip a mano
  mizuStage.playClip(null)                 detiene el clip
  mizuStage.playClip()                     vuelve al comportamiento por estado
  mizuStage.setView("full" | "upper")      cuerpo completo / plano medio
  mizuStage.debug.orbit(Math.PI / 2)       cámara de perfil (orbit(0) la restaura)
  mizuStage.setSpeaking(true | false)      lipsync sin audio
  mizuSay("texto")                         voz + lipsync
  mizuUi.bubble.handle({ type: "message", text: "**hola**", is_delta: false })   probar el globo
Clips cargados: ${stage.listClips().join(", ") || "(ninguno todavía)"}`);
  Object.assign(window, { mizu: machine, mizuSay: (text: string) => tts.speak(text), mizuStage: stage, mizuHelp });
}

// --- Vista (cuerpo completo / plano medio), recordada entre sesiones ---
const VIEW_KEY = "mizu.view";
let view: "full" | "upper" = "full";
try {
  if (localStorage.getItem(VIEW_KEY) === "upper") view = "upper";
} catch {
  /* sin almacenamiento: vista por defecto */
}
stage.setView(view);

// --- UI ---
watchDialogSide(canvas);
const bubble = createSpeechBubble(ui);
const permissions = createPermissionPrompt(ui);
if (import.meta.env.DEV) Object.assign(window, { mizuUi: { bubble } });
const history = createHistoryPanel(ui, () => {
  agent.newConversation().catch(console.error);
  bubble.reset();
});

const setBusy = (busy: boolean) => {
  input.setBusy(busy);
  side.setBusy(busy);
};

const input = createChatInput(ui, {
  onOpenChange: (open) => {
    ui.classList.toggle("chat-open", open);
    side.setChatOpen(open);
  },
  onSubmit: (text) => {
    history.addUser(text);
    bubble.reset();
    machine.userSent();
    announcer.userSent();
    setBusy(true);
    agent.send(text).catch((err) => {
      const message = String(err);
      machine.handle({ type: "error", message });
      announcer.handle({ type: "error", message });
      history.handle({ type: "error", message });
      bubble.handle({ type: "error", message });
      setBusy(false);
    });
  },
});

const side = createMenu(ui, {
  voiceEnabled: announcer.enabled,
  onToggleChat: () => input.toggle(),
  onToggleHistory: () => {
    const open = history.toggle();
    ui.classList.toggle("history-open", open);
    side.setHistoryOpen(open);
  },
  onToggleVoice: () => {
    announcer.setEnabled(!announcer.enabled);
    return announcer.enabled;
  },
  view,
  onToggleView: () => {
    view = view === "full" ? "upper" : "full";
    stage.setView(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* se pierde solo al cerrar */
    }
    return view;
  },
  onStop: () => agent.stop().catch(console.error),
  onQuit: () => app.quit().catch(console.error),
});

// --- Eventos del agente ---
agent
  .onEvent((ev) => {
    machine.handle(ev);
    announcer.handle(ev);
    bubble.handle(ev);
    history.handle(ev);
    permissions.handle(ev);
    if (ev.type === "done" || ev.type === "error" || ev.type === "idle") setBusy(false);
  })
  .catch(console.error);

// --- Ventana: arrastrar desde el personaje y click-through ---
window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest("button, textarea, input")) return;
  // Se puede arrastrar desde el personaje o desde zonas marcadas con data-drag (columna de botones).
  if (target.closest("[data-drag]") || (!target.closest(".interactive") && stage.hitTest(e.clientX, e.clientY))) {
    getCurrentWindow().startDragging().catch(console.error);
  }
});
setupClickThrough([stage.hitTest]).catch(console.error);
