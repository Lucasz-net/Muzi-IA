import { el } from "./dom";

/** Una pregunta de la herramienta `AskUserQuestion` de Claude Code. */
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

const RECOMMENDED = /\s*\((?:recommended|recomendad[ao]s?)\)\s*$/i;

/** Lee las preguntas de la entrada de la herramienta; devuelve [] si no tiene el formato esperado. */
export function parseQuestions(input: unknown): Question[] {
  const raw = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q): Question | null => {
      const o = q as Partial<Question>;
      if (typeof o.question !== "string" || !Array.isArray(o.options)) return null;
      const options = o.options
        .filter((x) => x && typeof x.label === "string")
        .map((x) => ({ label: x.label, description: typeof x.description === "string" ? x.description : undefined }));
      return { question: o.question, header: typeof o.header === "string" ? o.header : undefined, multiSelect: !!o.multiSelect, options };
    })
    .filter((q): q is Question => q !== null);
}

/**
 * Tarjeta de preguntas: cada opción es un botón (la recomendada va marcada). Con una sola pregunta de respuesta única,
 * elegir una opción envía la respuesta al instante; con varias (o de selección múltiple) hay un botón «Enviar».
 * Siempre se puede escribir una respuesta propia con «Otra…».
 * `onAnswer` recibe las respuestas como `{ [texto de la pregunta]: respuesta }`, el formato que espera Claude Code.
 */
export function createQuestionCard(questions: Question[], onAnswer: (answers: Record<string, string>) => void, onSkip: () => void): HTMLElement {
  const card = el("div", { class: "perm-card ask-card", interactive: true });
  const chosen: (Set<string> | string | null)[] = questions.map((q) => (q.multiSelect ? new Set<string>() : null));
  const others: string[] = questions.map(() => "");
  const instant = questions.length === 1 && !questions[0].multiSelect;
  const send = el("button", { class: "btn accept", text: "Enviar", interactive: true });

  const answerOf = (i: number): string => {
    const c = chosen[i];
    const parts = c instanceof Set ? [...c] : c ? [c] : [];
    if (others[i].trim()) parts.push(others[i].trim());
    return parts.join(", ");
  };
  const ready = () => questions.every((_, i) => answerOf(i) !== "");
  const refresh = () => send.toggleAttribute("disabled", !ready());
  const submit = () => {
    if (!ready()) return;
    onAnswer(Object.fromEntries(questions.map((q, i) => [q.question, answerOf(i)])));
  };
  send.addEventListener("click", submit);

  questions.forEach((q, qi) => {
    const block = el("div", { class: "ask-block" });
    if (q.header) block.append(el("span", { class: "ask-chip", text: q.header }));
    block.append(el("div", { class: "perm-title", text: q.question }));
    const list = el("div", { class: "ask-options" });
    const nodes: { label: string; node: HTMLElement }[] = [];

    const mark = () => {
      for (const n of nodes) {
        const c = chosen[qi];
        n.node.classList.toggle("picked", c instanceof Set ? c.has(n.label) : c === n.label);
      }
    };
    for (const opt of q.options) {
      const recommended = RECOMMENDED.test(opt.label);
      const text = opt.label.replace(RECOMMENDED, "");
      const node = el("button", { class: `ask-opt${recommended ? " recommended" : ""}`, interactive: true });
      node.append(el("span", { class: "ask-opt-label", text }));
      if (recommended) node.append(el("span", { class: "ask-tag", text: "Recomendada" }));
      if (opt.description) node.append(el("span", { class: "ask-opt-desc", text: opt.description }));
      node.addEventListener("click", () => {
        const c = chosen[qi];
        if (c instanceof Set) c.has(opt.label) ? c.delete(opt.label) : c.add(opt.label);
        else {
          chosen[qi] = opt.label;
          others[qi] = "";
        }
        mark();
        refresh();
        if (instant) submit();
      });
      nodes.push({ label: opt.label, node });
      list.append(node);
    }

    // Respuesta propia.
    const other = el("input", { class: "ask-other", interactive: true });
    other.type = "text";
    other.placeholder = "Otra respuesta…";
    other.addEventListener("input", () => {
      others[qi] = other.value;
      if (other.value.trim() && !(chosen[qi] instanceof Set)) chosen[qi] = null;
      mark();
      refresh();
    });
    other.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") submit();
    });
    block.append(list, other);
    card.append(block);
  });

  const skip = el("button", { class: "btn reject", text: "Decidir tú", title: "Que Mizu elija lo que le parezca mejor", interactive: true });
  skip.addEventListener("click", onSkip);
  card.append(el("div", { class: "perm-actions" }, skip, ...(instant ? [] : [send])));
  refresh();
  return card;
}

/** Tarjeta de aprobación de un plan (`ExitPlanMode`): el plan en texto y dos botones. */
export function createPlanCard(plan: string, onApprove: () => void, onRevise: () => void): HTMLElement {
  const approve = el("button", { class: "btn accept", text: "Aprobar plan", interactive: true });
  const revise = el("button", { class: "btn reject", text: "Seguir planeando", interactive: true });
  approve.addEventListener("click", onApprove);
  revise.addEventListener("click", onRevise);
  return el(
    "div",
    { class: "perm-card ask-card", interactive: true },
    el("div", { class: "perm-title", text: "¿Te parece bien este plan?" }),
    el("div", { class: "perm-detail ask-plan", text: plan }),
    el("div", { class: "perm-actions" }, revise, approve),
  );
}
