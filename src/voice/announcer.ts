import type { AgentEvent } from "../core/events";
import type { Mood, TTSProvider } from "./tts";

const STORAGE_KEY = "mizu.voice";
/** Una respuesta sin herramientas solo se anuncia si tardó al menos esto (ms). */
const MIN_TASK_MS = 6000;
/** Si ya se dijo algo hace menos de esto (ms), el aviso de "terminé" se omite para no pisarlo. */
const QUIET_AFTER_SPEECH_MS = 6000;

// Cada grupo de frases se dice con su ánimo: contenta al terminar bien, serena ante un fallo, atenta al pedir algo.
const DONE_PHRASES = ["¡Listo, terminé!", "¡Ya está, tarea completada!", "Terminé. Échale un vistazo."];
const ROUGH_PHRASES = ["Terminé, pero hubo problemas por el camino. Échale un vistazo.", "Acabé, aunque no todo salió bien. Revísalo."];
const ERROR_PHRASES = ["Algo salió mal.", "Hubo un error."];

const TOOL_ACTIONS: Record<string, string> = {
  Bash: "ejecutar un comando",
  PowerShell: "ejecutar un comando",
  Edit: "editar un archivo",
  Write: "escribir un archivo",
  NotebookEdit: "editar un notebook",
  WebFetch: "abrir una página web",
  WebSearch: "buscar en internet",
};

/** Acciones de control del PC (servidor MCP propio), dichas en voz alta. */
const DESKTOP_ACTIONS: Record<string, string> = {
  screenshot: "ver tu pantalla",
  screen_info: "mirar tu escritorio",
  cursor_position: "mirar tu escritorio",
  list_windows: "ver qué ventanas tienes abiertas",
  click: "hacer clic",
  move: "mover el ratón",
  drag: "arrastrar con el ratón",
  scroll: "mover la rueda del ratón",
  type_text: "escribir",
  key: "pulsar unas teclas",
  focus_window: "cambiar de ventana",
  wait: "esperar un momento",
};
const actionFor = (tool: string) =>
  tool.startsWith("mcp__mizu-desktop__") ? (DESKTOP_ACTIONS[tool.slice(19)] ?? "controlar el escritorio") : (TOOL_ACTIONS[tool] ?? `usar ${tool}`);

const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Decide cuándo y qué dice el personaje en los avisos: al terminar una tarea, al necesitar un permiso y ante errores.
 * La lectura de las respuestas la hace `narrator.ts`.
 */
export interface AnnouncerOptions {
  /** ¿La tarea que termina tuvo tropiezos (tests rotos, errores)? Cambia el tono y la frase de "terminé". */
  isRough?: () => boolean;
  /** Si devuelve true, el aviso de "terminé" se omite porque el narrador ya está contando el resultado. */
  suppressDone?: () => boolean;
}

export function createAnnouncer(tts: TTSProvider, { isRough = () => false, suppressDone = () => false }: AnnouncerOptions = {}) {
  let enabled = loadEnabled();
  let startedAt = 0;
  let toolsUsed = 0;
  let lastSpokeAt = 0;

  /** `interrupt`: corta lo que esté sonando (un permiso no puede esperar detrás de una lectura larga); si no, se encola detrás. */
  const say = (text: string, mood: Mood = "neutral", interrupt = false) => {
    if (!enabled) return;
    lastSpokeAt = Date.now();
    (!interrupt && tts.enqueue ? tts.enqueue(text, { mood }) : tts.speak(text, { mood })).catch(console.error);
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) tts.cancel();
      try {
        localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
      } catch {
        /* sin almacenamiento: solo vale para esta sesión */
      }
    },
    /** Dice una frase (si la voz está activada). */
    say,
    /** El usuario envió un mensaje: corta lo que estuviera diciendo y empieza a medir el turno. */
    userSent() {
      tts.cancel();
      startedAt = Date.now();
      toolsUsed = 0;
    },
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "tool_use":
          toolsUsed++;
          break;
        case "waiting_permission": {
          const action = actionFor(ev.tool_name);
          say(`Necesito tu permiso para ${action}.`, "atenta", true);
          break;
        }
        case "done":
          if (
            (toolsUsed > 0 || Date.now() - startedAt >= MIN_TASK_MS) &&
            Date.now() - lastSpokeAt > QUIET_AFTER_SPEECH_MS &&
            !suppressDone()
          )
            isRough() ? say(pick(ROUGH_PHRASES), "calma") : say(pick(DONE_PHRASES), "alegre");
          break;
        case "error":
          say(pick(ERROR_PHRASES), "calma");
          break;
        case "idle":
          tts.cancel(); // el usuario detuvo la tarea
          break;
      }
    },
  };
}
