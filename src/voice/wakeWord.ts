/**
 * Detección de la palabra de activación ("Mizu") en lo que Whisper transcribe.
 *
 * Whisper escribe un nombre raro de muchas formas y con una voz real falla bastante más que con voz sintética.
 * Formas vistas con voz real: "mis su", "me sub", "miso", "Mezmo", "Mezbo", y a veces pegado a la orden
 * ("Mezupara"). Aquí se aceptan todas esas familias, con un saludo opcional delante ("hola Mizu", "oye Mizu"),
 * procurando no confundir frases corrientes ("mi sobrino", "me suena", "mismo", "misión", "Mitsubishi").
 */
const END = String.raw`(?=[\s,.:;!?¡¿-]|$)[\s,.:;!?¡¿-]*`;
const GREETING = String.raw`(?:(?:hey|ey|eh|oye|ok|hola)[\s,]+)?`;

/** Una sola palabra: Mizu, Misu, Miso, Mizo, Mizú, Mezmo, Mezbo, Mitsu... */
const ONE_WORD = String.raw`(?:m[iíy][sz]{1,2}[uúoó]+h?|m[eé][sz]{1,2}[mn]?[uúoó]+h?|m[eéiíy]t[sz]{1,2}[uúoó]+)`;
/** El nombre partido en dos palabras cortas: "mis su", "mi zu", "me sub". Una segunda palabra larga ("suena") no vale. */
const TWO_WORDS = String.raw`m[eéiíy]s?[\s-]+[sz][uúoó]b?h?`;

const WAKE = new RegExp(String.raw`^\s*${GREETING}(?:${ONE_WORD}|${TWO_WORDS})${END}`, "i");

/** El nombre pegado a una orden de parar, sin espacio ("Mezupara", "Misudetente"). */
const GLUED_STOP = /^\s*m[eéiíy][sz]{1,2}[mn]?[uúoó]h?(para|detente|cancela|basta|alto|stop)(?![\p{L}])/iu;

/** Distancia de edición entre dos palabras cortas. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Una frase corta de una sola palabra que suena parecido a "Mizu" (Whisper la oye mal sin contexto). */
export function isLoneWakeLike(text: string): boolean {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .trim()
    .split(/\s+/);
  if (words.length !== 1 || words[0].length < 3 || words[0].length > 6) return false;
  const d = editDistance(words[0], "mizu");
  // Muy parecida ("Nizu", "Isu"), o con el esqueleto de "Mizu" (m + vocal + s/z: "Mezbo", "Mezmo", "Misu").
  return d <= 2 || (/^m[eiy][sz]/.test(words[0]) && d <= 3);
}

/** Si el texto empieza por la palabra de activación, devuelve lo que viene después; si no, `null`. */
export function stripWakeWord(text: string): string | null {
  // Whisper a veces pega el nombre a la orden de parar ("Mezupara"): detener es lo más importante y no puede fallar por eso.
  const glued = GLUED_STOP.exec(text);
  if (glued) return glued[1];
  const m = WAKE.exec(text);
  return m ? text.slice(m[0].length).trim() : null;
}
