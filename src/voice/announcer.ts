import type { AgentEvent } from "../core/events";
import type { ChatterLevel } from "../core/settings";
import type { JaPlayOptions, JaVoice } from "./jaVoice";
import type { TTSProvider } from "./tts";

const STORAGE_KEY = "mizu.voice";
/** Una respuesta sin herramientas solo se celebra si tardó al menos esto (ms). */
const MIN_TASK_MS = 6000;
/** Un turno de más de esto (ms) se despide con "qué largo se hizo". */
const LONG_TASK_MS = 90_000;
/** Si ya se dijo algo hace menos de esto (ms), el aviso de "terminé" se omite para no pisarlo. */
const QUIET_AFTER_SPEECH_MS = 6000;
/** Mientras trabaja suelta una frase como mucho cada tanto (ms, al azar entre los dos). */
const WORK_GAP_MS: [number, number] = [14_000, 28_000];
/** Pensando, igual. */
const THINK_GAP_MS = 25_000;
/** Silencio mínimo (ms, al azar entre los dos) antes de una frase suelta en reposo, según cuánto charla. */
const CHATTER_GAP_MS: Record<Exclude<ChatterLevel, "off">, [number, number]> = {
  poca: [240_000, 480_000],
  normal: [90_000, 200_000],
  mucha: [40_000, 90_000],
};

/** Categoría de frases de permiso según la herramienta. */
const PERM_CATEGORY: Record<string, string> = {
  Bash: "perm_command",
  PowerShell: "perm_command",
  Edit: "perm_edit",
  Write: "perm_edit",
  NotebookEdit: "perm_edit",
  WebFetch: "perm_web",
  WebSearch: "perm_web",
};
const DESKTOP_PERM: Record<string, string> = {
  screenshot: "perm_screen",
  screen_info: "perm_screen",
  cursor_position: "perm_screen",
  list_windows: "perm_screen",
  click: "perm_mouse",
  move: "perm_mouse",
  drag: "perm_mouse",
  scroll: "perm_mouse",
  type_text: "perm_keys",
  key: "perm_keys",
  focus_window: "perm_window",
};
const permCategory = (tool: string) =>
  tool.startsWith("mcp__mizu-desktop__") ? (DESKTOP_PERM[tool.slice(19)] ?? "perm_generic") : (PERM_CATEGORY[tool] ?? "perm_generic");

/** Categoría de frases al usar una herramienta (si no, una frase de trabajo cualquiera). */
const TOOL_CATEGORY: Record<string, string> = {
  Edit: "tool_edit",
  Write: "tool_edit",
  NotebookEdit: "tool_edit",
  Bash: "tool_command",
  PowerShell: "tool_command",
  WebSearch: "tool_search",
  WebFetch: "tool_search",
  Grep: "tool_search",
  Glob: "tool_search",
  Read: "tool_read",
};

const rand = ([min, max]: [number, number]) => min + Math.random() * (max - min);

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Decide cuándo y qué dice Mizu: frases cortas en japonés (pregrabadas, ver `jaVoice.ts`) al arrancar, al recibir una orden,
 * mientras piensa y trabaja, al pedir un permiso, al terminar, ante errores y, de vez en cuando, en reposo.
 * La lectura de las respuestas en español, si se activa en los ajustes, la hace `narrator.ts`.
 */
export interface AnnouncerOptions {
  /** ¿La tarea que termina tuvo tropiezos (tests rotos, errores)? Cambia la frase de "terminé". */
  isRough?: () => boolean;
  /** Si devuelve true, el aviso de "terminé" se omite porque el narrador ya está contando el resultado. */
  suppressDone?: () => boolean;
  /** Frecuencia de la charla en reposo (ajuste del usuario). */
  chatter?: () => ChatterLevel;
  /** ¿Se puede charlar ahora? (por ejemplo, no con el micrófono escuchando ni con un panel abierto). */
  canChatter?: () => boolean;
}

export function createAnnouncer(
  voice: JaVoice,
  tts: TTSProvider,
  { isRough = () => false, suppressDone = () => false, chatter = () => "normal", canChatter = () => true }: AnnouncerOptions = {},
) {
  let enabled = loadEnabled();
  let startedAt = 0;
  let toolsUsed = 0;
  let lastSpokeAt = 0;
  let inTurn = false;
  let nextWorkAt = 0;
  let nextThinkAt = 0;
  let spokeResponse = false;
  let nextChatterAt = 0;

  const scheduleChatter = () => {
    const level = chatter();
    nextChatterAt = level === "off" ? Infinity : Date.now() + rand(CHATTER_GAP_MS[level]);
  };
  scheduleChatter();

  /** Dice una frase de la categoría (si la voz está activada). `probability` < 1 la deja pasar solo a veces. */
  const play = (category: string, opts: JaPlayOptions & { probability?: number } = {}) => {
    if (!enabled) return false;
    if (opts.probability !== undefined && Math.random() > opts.probability) return false;
    const spoke = voice.play(category, opts);
    if (spoke) {
      lastSpokeAt = Date.now();
      scheduleChatter();
    }
    return spoke;
  };

  // Charla en reposo: cada cierto tiempo, si no hay nada en marcha, una frase suelta.
  setInterval(() => {
    if (!enabled || inTurn || voice.speaking || Date.now() < nextChatterAt) return;
    if (!canChatter()) return scheduleChatter();
    play("idle");
  }, 5000);

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) {
        voice.cancel();
        tts.cancel();
      }
      try {
        localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
      } catch {
        /* sin almacenamiento: solo vale para esta sesión */
      }
    },
    /** Dice una frase de una categoría (para reacciones, micrófono, arranque...). */
    play,
    /** Los ajustes de charla cambiaron. */
    rescheduleChatter: scheduleChatter,
    /** El usuario envió un mensaje: corta lo que estuviera diciendo, confirma y empieza a medir el turno. */
    userSent() {
      voice.cancel();
      tts.cancel();
      startedAt = Date.now();
      toolsUsed = 0;
      inTurn = true;
      spokeResponse = false;
      nextWorkAt = Date.now() + rand(WORK_GAP_MS);
      nextThinkAt = 0;
      play("ack", { probability: 0.85 });
    },
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "thinking":
          if (Date.now() >= nextThinkAt) {
            if (play("thinking", { probability: 0.6 })) nextThinkAt = Date.now() + THINK_GAP_MS;
          }
          break;
        case "tool_use":
          toolsUsed++;
          if (Date.now() >= nextWorkAt) {
            const specific = TOOL_CATEGORY[ev.name];
            if (play(specific && Math.random() < 0.5 ? specific : "working")) nextWorkAt = Date.now() + rand(WORK_GAP_MS);
          }
          break;
        case "waiting_permission":
          play(permCategory(ev.tool_name), { interrupt: true });
          break;
        case "message":
          // Primera respuesta del turno: una frasecita antes de contar (sin cortar lo que ya esté diciendo).
          if (!spokeResponse) {
            spokeResponse = true;
            play("responding", { probability: 0.7 });
          }
          break;
        case "done": {
          inTurn = false;
          const elapsed = Date.now() - startedAt;
          if ((toolsUsed > 0 || elapsed >= MIN_TASK_MS) && Date.now() - lastSpokeAt > QUIET_AFTER_SPEECH_MS && !suppressDone()) {
            play(isRough() ? "done_rough" : elapsed >= LONG_TASK_MS ? "done_long" : "done_ok", { interrupt: true });
          }
          break;
        }
        case "error":
          inTurn = false;
          play("error", { interrupt: true });
          break;
        case "idle":
          // El usuario detuvo la tarea.
          tts.cancel();
          if (inTurn) {
            inTurn = false;
            play("stopped", { interrupt: true });
          }
          break;
      }
    },
  };
}

export type Announcer = ReturnType<typeof createAnnouncer>;
