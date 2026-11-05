import type { AgentEvent } from "./events";
import type { Mood } from "../voice/tts";

/**
 * Reacciones al trabajo real. El agente avisa de cada herramienta que usa y de su resultado; aquí se
 * interpreta lo que significa (¿pasaron los tests?, ¿compila?, ¿se subió a git?, ¿falló algo?) y el
 * personaje responde con un gesto y, a veces, una frase corta.
 */
export type Outcome =
  | "tests_pass"
  | "tests_fail"
  | "build_ok"
  | "build_fail"
  | "git_commit"
  | "git_push"
  | "error";

export interface Classified {
  outcome: Outcome;
  /** Cuántos tests pasaron/fallaron, si el resultado lo dice. */
  count?: number;
}

const SHELL = new Set(["Bash", "PowerShell"]);
/** Herramientas cuyo fallo merece una reacción (los fallos de Read/Grep/Glob son rutina). */
const NOTABLE = new Set(["Bash", "PowerShell", "Edit", "Write", "NotebookEdit"]);

const TEST_CMD =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|mocha|pytest|phpunit|rspec)\b|\bcargo\s+test\b|\bgo\s+test\b|\bdotnet\s+test\b|\bnode\s+--test\b/i;
const BUILD_CMD =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\btsc\b|\bcargo\s+(?:build|check|clippy)\b|\bdotnet\s+build\b|\bvite\s+build\b|\bgo\s+build\b|\bmake\b/i;
const GIT_PUSH = /\bgit\s+push\b/i;
const GIT_COMMIT = /\bgit\s+commit\b/i;

const PASS_COUNT = /(\d+)\s+(?:tests?\s+)?(?:passed|passing|pasaron)\b|test result: ok\.\s+(\d+) passed/i;
const FAIL_COUNT = /(\d+)\s+(?:tests?\s+)?(?:failed|failing|fallaron)\b|test result: FAILED\.\s+\d+ passed;\s+(\d+) failed/i;
const FAIL_WORDS = /\b(?:FAIL(?:ED|URES?)?|AssertionError|panicked at)\b/;
const BUILD_FAIL = /error TS\d+|error\[E\d+\]|Build failed|failed to compile|SyntaxError|Cannot find module|npm ERR!/i;

const num = (m: RegExpMatchArray | null) => {
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : undefined;
};

/** Qué significa el resultado de una herramienta; `null` si no merece reacción. */
export function classifyToolResult(name: string, command: string, output: string, isError: boolean): Classified | null {
  if (SHELL.has(name)) {
    if (TEST_CMD.test(command)) {
      const failed = num(output.match(FAIL_COUNT));
      if (isError || (failed ?? 0) > 0 || FAIL_WORDS.test(output)) return { outcome: "tests_fail", count: failed };
      const passed = num(output.match(PASS_COUNT));
      if (passed !== undefined || /\ball tests passed\b|\bOK\b/i.test(output)) return { outcome: "tests_pass", count: passed };
      return null; // sin pistas claras: no se adivina
    }
    if (GIT_PUSH.test(command) && !isError && /->|Everything up-to-date|To https?:/i.test(output)) return { outcome: "git_push" };
    if (GIT_COMMIT.test(command) && !isError && /\[[\w/.-]+ [0-9a-f]{7,}\]/.test(output)) return { outcome: "git_commit" };
    if (BUILD_CMD.test(command)) {
      return isError || BUILD_FAIL.test(output) ? { outcome: "build_fail" } : { outcome: "build_ok" };
    }
  }
  if (isError && NOTABLE.has(name)) return { outcome: "error" };
  return null;
}

interface Reaction {
  gestures: { name: string; weight: number }[];
  /** Frase que dice (si la voz está activada); sin ella, solo gesto. */
  say?: (count?: number) => string;
  /** Con qué ánimo la dice: contenta si salió bien, serena si salió mal. */
  mood?: Mood;
}

const g = (name: string, weight = 1) => ({ name, weight });

const REACTIONS: Record<Outcome, Reaction> = {
  tests_pass: {
    gestures: [g("thumbsUp", 2), g("fingerHeart", 1.2), g("smile", 2)],
    say: (n) => (n ? `¡Pasaron los ${n} tests!` : "¡Los tests pasaron!"),
    mood: "alegre",
  },
  tests_fail: {
    gestures: [g("surprised", 2), g("sigh", 1.5)],
    say: (n) => (n === 1 ? "Falló una prueba." : n ? `Fallaron ${n} pruebas.` : "Fallaron algunas pruebas."),
    mood: "calma",
  },
  build_ok: { gestures: [g("nod", 2), g("smile")] },
  build_fail: { gestures: [g("sigh", 2), g("surprised")], say: () => "Hay errores de compilación.", mood: "calma" },
  git_commit: { gestures: [g("nod")] },
  git_push: { gestures: [g("thumbsUp", 2), g("peace")], say: () => "¡Subido al repositorio!", mood: "alegre" },
  error: { gestures: [g("surprised")] },
};

/** Gestos al terminar el turno: con éxito, o con tropiezos por el camino. */
const DONE_OK = [g("smile", 3), g("thumbsUp", 2), g("fingerHeart", 1.2), g("peace", 0.8), g("catPaws", 0.5)];
const DONE_ROUGH = [g("shy", 2), g("sigh", 2), g("smile", 1)];

const GESTURE_GAP_MS = 5000;
const SPEECH_GAP_MS = 8000;
/** Un turno de más de esto (ms) merece estirarse al acabar. */
const LONG_TURN_MS = 90_000;
/** Pensando durante tanto (ms) pone cara de pensativa. */
const THINK_LONG_MS = 10_000;

const pick = (items: { name: string; weight: number }[]) => {
  let r = Math.random() * items.reduce((s, i) => s + i.weight, 0);
  return (items.find((i) => (r -= i.weight) < 0) ?? items[0]).name;
};

export interface ReactionDeps {
  gesture: (name: string) => boolean;
  /** Dice una frase (respeta si la voz está activada). */
  say: (text: string, mood?: Mood) => void;
}

export function createReactions({ gesture, say }: ReactionDeps) {
  const tools = new Map<string, { name: string; command: string }>();
  let startedAt = Date.now();
  let toolsUsed = 0;
  let errors = 0;
  let lastFail = false;
  let lastText = "";
  let lastGestureAt = 0;
  let lastSpeechAt = 0;
  let thinkTimer: ReturnType<typeof setTimeout> | undefined;

  const doGesture = (name: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastGestureAt < GESTURE_GAP_MS) return;
    if (gesture(name)) lastGestureAt = now;
  };
  const doSay = (text: string, mood?: Mood) => {
    const now = Date.now();
    if (now - lastSpeechAt < SPEECH_GAP_MS) return;
    lastSpeechAt = now;
    say(text, mood);
  };
  const stopThink = () => {
    clearTimeout(thinkTimer);
    thinkTimer = undefined;
  };

  return {
    /** El usuario envió un mensaje: empieza un turno nuevo. */
    userSent() {
      stopThink();
      tools.clear();
      startedAt = Date.now();
      toolsUsed = 0;
      errors = 0;
      lastFail = false;
      lastText = "";
    },
    /** El turno actual tuvo tropiezos (un error o un fallo de tests/compilación): cambia el tono del "terminé". */
    get rough() {
      return errors > 0 || lastFail;
    },
    /** Debug: qué reacción daría este resultado. */
    classify: classifyToolResult,
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "thinking":
          if (!thinkTimer) thinkTimer = setTimeout(() => doGesture("lookUp"), THINK_LONG_MS);
          break;
        case "tool_use": {
          stopThink();
          toolsUsed++;
          const input = ev.input as { command?: unknown } | null;
          tools.set(ev.tool_id, { name: ev.name, command: typeof input?.command === "string" ? input.command : "" });
          break;
        }
        case "tool_result": {
          const tool = tools.get(ev.tool_id);
          if (!tool) break;
          const c = classifyToolResult(tool.name, tool.command, ev.output, ev.is_error);
          if (!c) break;
          if (c.outcome === "error") errors++;
          lastFail = c.outcome === "tests_fail" || c.outcome === "build_fail" || c.outcome === "error";
          // Los errores sueltos solo asustan las dos primeras veces del turno.
          if (c.outcome === "error" && errors > 2) break;
          const r = REACTIONS[c.outcome];
          doGesture(pick(r.gestures));
          if (r.say) doSay(r.say(c.count), r.mood);
          break;
        }
        case "waiting_permission":
          stopThink();
          doGesture("tilt");
          break;
        case "message":
          stopThink();
          lastText = ev.is_delta ? lastText + ev.text : ev.text;
          break;
        case "error":
          stopThink();
          doGesture("sigh", true);
          break;
        case "idle":
          stopThink();
          break;
        case "done": {
          stopThink();
          const elapsed = Date.now() - startedAt;
          if (toolsUsed === 0 && elapsed < 6000) break; // una charla corta no necesita festejo
          if (elapsed >= LONG_TURN_MS && !lastFail && Math.random() < 0.4) doGesture("stretch", true);
          else if (/[?？]\s*$/.test(lastText.trim())) doGesture("tilt", true);
          else doGesture(pick(errors > 0 || lastFail ? DONE_ROUGH : DONE_OK), true);
          break;
        }
      }
    },
  };
}
