import type { AgentEvent } from "../core/events";

/**
 * Lo que Mizu dice en voz alta viaja dentro de sus mensajes, en etiquetas `<voz><ja>…</ja><es>…</es></voz>` (ver
 * `src-tauri/persona/mizu.txt`). Este filtro las saca del texto antes de que lo vean el globo y el historial, y avisa
 * de cada frase en cuanto se cierra su etiqueta, sin esperar al final del mensaje.
 */
export interface SpokenLine {
  ja: string;
  es: string;
}

const TAG = /<voz>\s*<ja>([\s\S]*?)<\/ja>\s*(?:<es>([\s\S]*?)<\/es>)?\s*<\/voz>[ \t]*\r?\n?/g;
const OPEN = "<voz>";

/** Frases de voz de un texto, en orden. */
export function spokenLines(text: string): SpokenLine[] {
  return [...text.matchAll(TAG)].map((m) => ({ ja: m[1].trim(), es: (m[2] ?? "").trim() })).filter((l) => l.ja);
}

/**
 * Texto visible: sin las etiquetas completas. Con `partial`, además se oculta una etiqueta a medio llegar (o el
 * principio de una, como `<vo`) para que no parpadee en pantalla mientras se escribe.
 */
export function stripVoice(text: string, partial = false): string {
  let out = text.replace(TAG, "");
  if (!partial) return out;
  const open = out.indexOf(OPEN);
  if (open >= 0) return out.slice(0, open);
  for (let n = OPEN.length - 1; n > 0; n--) {
    if (out.endsWith(OPEN.slice(0, n))) return out.slice(0, -n);
  }
  return out;
}

export function createVoiceTagFilter(onLine: (line: SpokenLine) => void) {
  let raw = ""; // bloque de texto en curso, tal cual llega
  let shown = 0; // caracteres visibles del bloque ya enviados
  let spoken = 0; // frases del bloque ya avisadas

  const speakNew = (text: string) => {
    const lines = spokenLines(text);
    for (let i = spoken; i < lines.length; i++) onLine(lines[i]);
    spoken = Math.max(spoken, lines.length);
  };
  const reset = () => {
    raw = "";
    shown = 0;
    spoken = 0;
  };

  return {
    /** Devuelve el evento sin las etiquetas de voz, o `null` si no queda nada que mostrar. */
    filter(ev: AgentEvent): AgentEvent | null {
      switch (ev.type) {
        case "message": {
          if (ev.is_delta) {
            raw += ev.text;
            speakNew(raw);
            const visible = stripVoice(raw, true).replace(/^\s+/, "");
            const delta = visible.slice(shown);
            shown = visible.length;
            return delta ? { ...ev, text: delta } : null;
          }
          // Mensaje completo: cierra el bloque (las frases ya dichas durante el streaming no se repiten).
          speakNew(ev.text);
          reset();
          const text = stripVoice(ev.text).trim();
          return text ? { ...ev, text } : null;
        }
        case "tool_use":
          reset();
          return ev;
        case "done":
          reset();
          return ev.result ? { ...ev, result: stripVoice(ev.result).trim() } : ev;
        case "error":
        case "idle":
          reset();
          return ev;
        default:
          return ev;
      }
    },
  };
}
