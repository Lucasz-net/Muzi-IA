import { getCurrentWindow } from "@tauri-apps/api/window";
import { agent, app, cursor } from "./core/bridge";
import { setupClickThrough } from "./core/clickThrough";
import { createStateMachine } from "./core/stateMachine";
import { createReactions } from "./core/reactions";
import { createScene } from "./character/scene";
import { createChatInput } from "./ui/chatInput";
import { createHistoryPanel } from "./ui/historyPanel";
import { createRuleStore } from "./core/permissionRules";
import { createPermissionPrompt } from "./ui/permissionPrompt";
import { createRulesPanel } from "./ui/rulesPanel";
import { createSettingsPanel } from "./ui/settingsPanel";
import { createSettings } from "./core/settings";
import { createNarrator } from "./voice/narrator";
import { watchDialogSide } from "./ui/layout";
import { createMenu } from "./ui/menu";
import { createSpeechBubble } from "./ui/speechBubble";
import { createAnnouncer } from "./voice/announcer";
import { createPiperTTS } from "./voice/piperProvider";
import { createTTS } from "./voice/webSpeechProvider";
import { createWhisperSTT } from "./voice/whisperProvider";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const stage = createScene(canvas);

// --- Máquina de estados: eventos del agente -> animaciones ---
const machine = createStateMachine();
machine.onChange((state) => stage.setState(state));

// --- Voz ---
// Piper (local, neuronal) con la voz de Windows como respaldo mientras se descarga el modelo la primera vez.
const tts = createPiperTTS(createTTS());
setTimeout(() => tts.preload().catch(() => {}), 2500);
// Ajustes del usuario (panel del menú): qué lee Mizu de sus respuestas y cuántos gestos hace sola.
const settings = createSettings();
// Lee en voz alta las respuestas (resumen o completa, según el ajuste), más allá de los avisos.
// "rough": si el turno tuvo tropiezos, la lectura y el "terminé" suenan serenos (ver `reactions`, más abajo).
const narrator = createNarrator(tts, {
  mode: () => settings.get().read,
  isRough: () => reactions.rough,
  enabled: () => announcer.enabled, // el botón de silenciar del menú también calla la lectura
});
// Los avisos ("terminé", permisos, errores). Si el narrador ya cuenta el resultado, el "terminé" sobra.
const announcer = createAnnouncer(tts, { isRough: () => reactions.rough, suppressDone: () => narrator.willSpeak });

// --- Micrófono (voz a texto con Whisper local) ---
const stt = createWhisperSTT();

// --- Reacciones al trabajo real (tests, compilación, git, errores...) ---
const reactions = createReactions({ gesture: (name) => stage.gesture(name), say: (text, mood) => announcer.say(text, mood) });

// La voz mueve la boca (lipsync) y el cursor atrae la mirada.
tts.onSpeakingChange((speaking) => {
  stage.setSpeaking(speaking);
  bubble.setReading(speaking); // el botón de leer del globo se marca mientras habla
});
// Gestos en reposo según el ajuste (hay que esperar a que cargue el modelo: el de relleno no los hace).
stage.modelReady.then(() => stage.setGestureLevel(settings.get().gestures)).catch(console.error);
settings.onChange((s) => stage.setGestureLevel(s.gestures));
tts.onBoundary(() => stage.pulseMouth());
cursor.onMove((x, y) => stage.setGaze(x, y)).catch(console.error);

// Depuración en desarrollo (consola de la ventana): `mizu.force("celebrating")`, `mizuSay("hola")`.
if (import.meta.env.DEV) {
  const mizuHelp = () =>
    console.info(`Comandos de prueba (consola de la ventana: F12 o clic derecho > Inspeccionar)
  mizu.force("idle" | "thinking" | "working" | "waiting_permission" | "responding" | "celebrating" | "error")
  mizuStage.listClips()                    lista los clips de animación cargados
  mizuStage.playClip("Nombre.fbx")         reproduce un clip a mano
  mizuStage.playClip(null)                 detiene el clip (y apaga los clips por estado hasta playClip())
  mizuStage.playClip()                     vuelve al comportamiento por estado
  mizuStage.gesture("wink")                gesto con código: ${stage.listGestures().join(", ")}
  mizuStage.setView("full" | "upper")      cuerpo completo / plano medio
  mizuStage.debug.orbit(Math.PI / 2)       cámara de perfil (orbit(0) la restaura)
  mizuStage.setSpeaking(true | false)      lipsync sin audio
  mizuSay("texto")                         voz + lipsync
  mizuUi.bubble.handle({ type: "message", text: "**hola**", is_delta: false })   probar el globo
Clips cargados: ${stage.listClips().join(", ") || "(ninguno todavía)"}`);
  Object.assign(window, { mizu: machine, mizuSay: (text: string) => tts.speak(text), mizuTts: tts, mizuStage: stage, mizuHelp });
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
const bubble = createSpeechBubble(ui, {
  // Botón de leer del globo: lee la respuesta que se ve (entera, sea cual sea el ajuste) o corta la lectura.
  onRead: () => {
    if (tts.speaking) return narrator.stop();
    if (!narrator.readAll(bubble.text)) {
      bubble.hint("No hay nada que leer", false);
      setTimeout(() => bubble.hint(null), 2000);
    }
  },
});
// Permisos recordados ("Siempre"): reglas estrechas que evitan volver a preguntar lo mismo.
const rules = createRuleStore();
const permissions = createPermissionPrompt(ui, rules);
const rulesPanel = createRulesPanel(ui, rules);
const settingsPanel = createSettingsPanel(ui, settings);
if (import.meta.env.DEV) Object.assign(window, { mizuUi: { bubble } });
const history = createHistoryPanel(ui, () => {
  agent.newConversation().catch(console.error);
  bubble.reset();
});

let busy = false;
const setBusy = (value: boolean) => {
  busy = value;
  input.setBusy(busy);
  side.setBusy(busy);
};

/** Envía un mensaje al agente, venga del chat o del micrófono. */
const submit = (text: string) => {
  // Solo desarrollo: con `window.__mizuDryRun = true` el texto se anota en `window.__mizuSent` en vez de enviarse al agente.
  if (import.meta.env.DEV && (window as unknown as { __mizuDryRun?: boolean }).__mizuDryRun) {
    ((window as unknown as { __mizuSent?: string[] }).__mizuSent ??= []).push(text);
    return;
  }
  history.addUser(text);
  bubble.reset();
  machine.userSent();
  announcer.userSent();
  narrator.userSent();
  reactions.userSent();
  setBusy(true);
  agent.send(text).catch((err) => {
    const message = String(err);
    machine.handle({ type: "error", message });
    announcer.handle({ type: "error", message });
    history.handle({ type: "error", message });
    bubble.handle({ type: "error", message });
    setBusy(false);
  });
};

const input = createChatInput(ui, {
  onOpenChange: (open) => {
    ui.classList.toggle("chat-open", open);
    side.setChatOpen(open);
  },
  onSubmit: submit,
});

// --- Micrófono ---
// El botón del micrófono escucha una frase (al callar, o al pulsarlo de nuevo, transcribe y envía). El botón
// de la oreja deja el micrófono abierto y solo hace caso a lo que empieza por "Mizu" (escucha continua).
const WAKE_KEY = "mizu.wake";
/** Órdenes que se atienden aunque haya una tarea en curso. */
const STOP_COMMAND = /^(?:para|pará|detente|detén|cancela|basta|alto|stop)/i;

stt.onState((state, detail) => {
  side.setMicState(state);
  if (state === "listening") bubble.hint(stt.waking ? "Te escucho…" : "Escuchando…");
  else if (state === "loading") bubble.hint(`Preparando el micrófono${detail ? ` (${detail})` : ""}`);
  else if (state === "transcribing") bubble.hint("Transcribiendo…");
  else bubble.hint(null);
});
stt.onTranscript((text) => {
  if (STOP_COMMAND.test(text.trim())) {
    stage.gesture("nod");
    agent.stop().catch(console.error);
    return;
  }
  if (busy) {
    // Hay una tarea en marcha: solo se puede detener. Lo demás espera.
    bubble.hint("Estoy trabajando. Dime «Mizu, para» si quieres detenerme.", false);
    setTimeout(() => bubble.hint(null), 3500);
    return;
  }
  stage.gesture("nod");
  submit(text);
});
stt.onAttention(() => stage.gesture("tilt")); // dijo solo "Mizu": la veo atenta
stt.onError((message) => bubble.handle({ type: "error", message }));

// Mientras habla no se escucha (para que no se oiga a sí misma); al terminar, la conversación queda abierta unos segundos.
let muteToken = 0;
tts.onSpeakingChange((speaking) => {
  const token = ++muteToken;
  if (speaking) return stt.setMuted(true);
  setTimeout(() => {
    if (token !== muteToken) return;
    stt.setMuted(false);
    if (stt.waking && !busy) stt.openConversation(8);
  }, 700);
});
const setWake = async (on: boolean) => {
  if (on) await stt.startWake();
  else stt.stopWake();
  side.setWakeState(stt.waking);
  try {
    localStorage.setItem(WAKE_KEY, stt.waking ? "on" : "off");
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
};
if (import.meta.env.DEV) Object.assign(window, { mizuStt: stt, mizuReact: reactions, mizuNarrator: narrator, mizuSettings: settings });

// Los paneles laterales (historial, permisos recordados, ajustes) comparten sitio: abrir uno cierra los otros.
const panels = {
  history: { panel: history, mark: (on: boolean) => side.setHistoryOpen(on) },
  rules: { panel: rulesPanel, mark: (on: boolean) => side.setRulesOpen(on) },
  settings: { panel: settingsPanel, mark: (on: boolean) => side.setSettingsOpen(on) },
};
const togglePanel = (name: keyof typeof panels) => {
  const opening = !panels[name].panel.open;
  for (const [key, p] of Object.entries(panels)) {
    if (key !== name && p.panel.open) {
      p.panel.close();
      p.mark(false);
    }
  }
  if (opening) panels[name].panel.toggle();
  else panels[name].panel.close();
  panels[name].mark(opening);
  ui.classList.toggle("history-open", opening); // comparte sitio (y hueco del globo) con el historial
};

const side = createMenu(ui, {
  voiceEnabled: announcer.enabled,
  onToggleChat: () => input.toggle(),
  onToggleMic: () => {
    if (stt.waking) {
      // Escucha continua: pulsar el micro equivale a decir "Mizu" (se queda atenta unos segundos).
      if (busy) return;
      tts.cancel();
      stage.gesture("tilt");
      return stt.openConversation(8);
    }
    if (stt.state === "listening") return stt.finish();
    if (stt.state !== "idle") return;
    if (busy) {
      bubble.hint("Espera a que termine la tarea", false);
      setTimeout(() => bubble.hint(null), 2500);
      return;
    }
    tts.cancel(); // que no se oiga a sí misma
    stage.gesture("tilt");
    stt.start().catch(console.error);
  },
  onToggleWake: () => {
    if (stt.state === "loading" || stt.state === "transcribing") return;
    setWake(!stt.waking).catch(console.error);
  },
  onToggleHistory: () => togglePanel("history"),
  onToggleRules: () => togglePanel("rules"),
  onToggleSettings: () => togglePanel("settings"),
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
    // Un permiso que ya marcaste como "Siempre" se aprueba solo, sin tarjeta, gesto ni aviso.
    if (permissions.tryAutoAllow(ev)) return;
    machine.handle(ev);
    announcer.handle(ev); // antes que el narrador: consulta si éste va a contar el resultado para no decir "terminé" dos veces
    narrator.handle(ev);
    reactions.handle(ev);
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

// Si la escucha continua estaba encendida la última vez, se retoma al arrancar (con el modelo ya en caché es rápido).
try {
  if (localStorage.getItem(WAKE_KEY) === "on") setTimeout(() => setWake(true).catch(console.error), 4000);
} catch {
  /* sin almacenamiento: empieza apagada */
}
