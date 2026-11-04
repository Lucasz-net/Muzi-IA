import type { AgentEvent } from "../core/events";
import type { TTSProvider } from "./tts";

const STORAGE_KEY = "mizu.voice";
/** Una respuesta sin herramientas solo se anuncia si tardó al menos esto (ms). */
const MIN_TASK_MS = 6000;

const DONE_PHRASES = ["Listo, terminé.", "Ya está, tarea completada.", "Terminé. Échale un vistazo."];
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

const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Decide cuándo y qué dice el personaje: al terminar una tarea, al necesitar un permiso
 * y ante errores. No lee las respuestas completas.
 */
export function createAnnouncer(tts: TTSProvider) {
  let enabled = loadEnabled();
  let startedAt = 0;
  let toolsUsed = 0;

  const say = (text: string) => {
    if (enabled) tts.speak(text).catch(console.error);
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
          const action = TOOL_ACTIONS[ev.tool_name] ?? `usar ${ev.tool_name}`;
          say(`Necesito tu permiso para ${action}.`);
          break;
        }
        case "done":
          if (toolsUsed > 0 || Date.now() - startedAt >= MIN_TASK_MS) say(pick(DONE_PHRASES));
          break;
        case "error":
          say(pick(ERROR_PHRASES));
          break;
        case "idle":
          tts.cancel(); // el usuario detuvo la tarea
          break;
      }
    },
  };
}
