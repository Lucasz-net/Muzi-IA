/**
 * De la respuesta en markdown a algo que se pueda decir en voz alta. Quita lo que no se lee bien (bloques de
 * código, tablas, rutas largas, enlaces, emojis, símbolos de formato) y, si hace falta, resume.
 */
export interface Speakable {
  /** Texto limpio, listo para trocear en frases. */
  text: string;
  /** Se omitieron bloques de código, tablas o similares: conviene avisar de que el resto está en pantalla. */
  omitted: boolean;
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** Última parte de una ruta o URL: `C:/a/b/main.ts` -> `main.ts`. */
const baseName = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || p;

/** Markdown -> texto hablable. Admite texto a medias (un bloque de código sin cerrar se descarta). */
export function toSpeakable(markdown: string): Speakable {
  let omitted = false;
  let t = markdown.replace(/\r/g, "");

  // Bloques de código (también el que aún no se ha cerrado, mientras llega la respuesta).
  t = t.replace(/```[\s\S]*?(?:```|$)/g, () => {
    omitted = true;
    return "\n";
  });
  // Tablas: se leen fatal.
  t = t
    .split("\n")
    .filter((line) => {
      if (/^\s*\|.*\|\s*$/.test(line) || /^\s*[-|: ]{3,}$/.test(line)) {
        if (/\|/.test(line)) omitted = true;
        return !/\|/.test(line);
      }
      return true;
    })
    .join("\n");

  t = t
    .replace(/<[^>]+>/g, " ") // etiquetas HTML
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // imágenes
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1") // [texto](enlace) -> texto
    .replace(/https?:\/\/[^\s)]+/g, "un enlace")
    .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, "$1.") // títulos: una frase aparte
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "") // viñetas y numeración
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, "")
    .replace(/`([^`\n]+)`/g, (_m, code: string) => {
      // Código en línea: rutas -> solo el nombre del archivo; lo demás, tal cual si es corto.
      if (/[\\/]/.test(code) && !/\s/.test(code)) return baseName(code);
      return code.length <= 40 ? code : "un fragmento de código";
    })
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@()-]+){2,}[\\/]?/g, (path) => baseName(path)) // rutas sueltas
    .replace(/\b[0-9a-f]{7,40}\b/g, (h) => (/\d/.test(h) && /[a-f]/.test(h) ? "" : h)) // hashes de commit
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(EMOJI, "")
    // Cada línea es una frase aparte si no termina en puntuación.
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:;]$/.test(l) ? l : `${l}.`))
    .join(" ")
    .replace(/:\./g, ":")
    .replace(/\s+/g, " ")
    .trim();

  return { text: t, omitted };
}

/**
 * Trocea en frases: se corta en el espacio que sigue a un `. ! ? …`, así que el punto de `main.ts` o de `3.5` no
 * parte nada. La última puede estar incompleta si el texto aún está llegando.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["»)]?)\s+/u)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export const SCREEN_NOTE = "El resto está en pantalla.";

/**
 * Resumen hablado: las primeras frases hasta unos `maxChars` caracteres (al menos una). Si se dejó algo fuera
 * (por recorte u omisiones como el código), añade que el resto está en pantalla.
 */
export function summarize(markdown: string, maxChars = 240, maxSentences = 3): string {
  const { text, omitted } = toSpeakable(markdown);
  const all = sentencesOf(text);
  if (!all.length) return omitted ? "Te dejé el detalle en pantalla." : "";
  // Un título suelto ("Resultado.") no es un buen comienzo para un resumen.
  if (all.length >= 3 && all[0].split(/\s+/).length <= 2) all.shift();
  const picked: string[] = [];
  let len = 0;
  for (const s of all) {
    if (picked.length >= maxSentences || (picked.length && len + s.length > maxChars)) break;
    picked.push(s);
    len += s.length;
  }
  const cut = picked.length < all.length || omitted;
  return picked.join(" ") + (cut ? ` ${SCREEN_NOTE}` : "");
}

/** Lectura completa, con un tope por si la respuesta es enorme. */
export function fullText(markdown: string, maxChars = 2600): { sentences: string[]; truncated: boolean } {
  const { text, omitted } = toSpeakable(markdown);
  const all = sentencesOf(text);
  const out: string[] = [];
  let len = 0;
  let truncated = false;
  for (const s of all) {
    if (len + s.length > maxChars) {
      truncated = true;
      break;
    }
    out.push(s);
    len += s.length;
  }
  if (truncated || omitted) out.push(SCREEN_NOTE);
  return { sentences: out, truncated };
}
