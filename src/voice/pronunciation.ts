/**
 * Pronunciación para la voz. Piper lee todo con reglas del español, así que las palabras en inglés ("Steam",
 * "GitHub"), las marcas y las siglas ("CS2", "API") suenan raras. Aquí se reescriben tal como las diría una
 * persona hispanohablante antes de pasárselas a la voz. Solo se usa para hablar: el texto de la pantalla no cambia.
 *
 * Para añadir una palabra, agrégala a `WORDS` (clave en minúsculas, valor = cómo se dice, escrito en español).
 */
const WORDS: Record<string, string> = {
  // Juegos y plataformas
  steam: "Estím",
  "cs:go": "ce ese guó",
  minecraft: "Máincraft",
  fortnite: "Fortnáit",
  discord: "Discór",
  twitch: "Tuích",
  youtube: "Yutúb",
  spotify: "Espotifái",
  netflix: "Netflis",
  chrome: "Króm",
  firefox: "Fáirfox",
  windows: "Güíndous",
  // Programación
  github: "Guithab",
  gitlab: "Guitlab",
  git: "guit",
  commit: "comit",
  commits: "comits",
  push: "pus",
  pull: "pul",
  merge: "merch",
  build: "bild",
  bug: "bag",
  bugs: "bags",
  debug: "dibag",
  deploy: "diplói",
  docker: "dóquer",
  python: "Páiton",
  javascript: "Yavascript",
  typescript: "Taipscript",
  rust: "Rast",
  npm: "ene pe eme",
  cli: "ce ele i",
  api: "a pe i",
  apis: "a pe is",
  json: "yéison",
  html: "hache te eme ele",
  css: "ce ese ese",
  url: "u erre ele",
  gpu: "ge pe u",
  cpu: "ce pe u",
  usb: "u ese be",
  pc: "pe ce",
  ram: "ram",
  gb: "gigas",
  mb: "megas",
  // Palabras sueltas del inglés de uso común
  ok: "okéi",
  online: "onláin",
  offline: "oflain",
  email: "iméil",
  wifi: "güifi",
  "wi-fi": "güifi",
  app: "ap",
  apps: "aps",
  stream: "estrím",
  streaming: "estrímin",
  software: "sofgüer",
  hardware: "jardgüer",
  // Nombres propios del proyecto
  claude: "Clod",
  anthropic: "Antrópic",
  tauri: "Táuri",
};

const LETTERS: Record<string, string> = {
  a: "a", b: "be", c: "ce", d: "de", e: "e", f: "efe", g: "ge", h: "hache", i: "i", j: "jota", k: "ka", l: "ele", m: "eme",
  n: "ene", o: "o", p: "pe", q: "cu", r: "erre", s: "ese", t: "te", u: "u", v: "uve", w: "uve doble", x: "equis", y: "i griega", z: "zeta",
};

/** Palabras españolas que a veces vienen en mayúsculas: no se deletrean como si fueran siglas. */
const SPANISH_CAPS = new Set([
  "NO", "SI", "SÍ", "YA", "EL", "LA", "LOS", "LAS", "UN", "UNA", "DE", "EN", "POR", "CON", "SIN", "MAS", "MÁS", "HAY", "ES", "SE",
  "TE", "ME", "MI", "TU", "TÚ", "SU", "LO", "AL", "ESTA", "ESTÁ", "ESTO", "ESE", "ASÍ", "ASI", "BIEN", "MAL", "OJO", "QUÉ", "QUE", "CÓMO", "COMO",
]);

/** Símbolos que no encajan en una palabra normal, se resuelven antes. */
const SYMBOLS: [RegExp, string][] = [
  [/\bc\+\+/gi, "ce más más"],
  [/\bc#/gi, "ce sharp"],
  [/\bnode\.js\b/gi, "noud yei ese"],
  [/\bcs:go\b/gi, "ce ese guó"],
];

const WORD = /[\p{L}\p{N}][\p{L}\p{N}:'-]*/gu;

/** Texto -> texto para la voz: palabras en inglés y siglas escritas como se pronuncian. */
export function normalizeForSpeech(text: string): string {
  let out = text;
  for (const [re, to] of SYMBOLS) out = out.replace(re, to);
  return out.replace(WORD, (token) => {
    const known = WORDS[token.toLowerCase()];
    if (known) return known;
    // Siglas: 2-4 mayúsculas, con cifras detrás ("CS2", "RTX3060"): se deletrean letra a letra.
    const m = /^([A-ZÁÉÍÓÚÑ]{2,4})(\d*)$/.exec(token);
    if (m && !SPANISH_CAPS.has(m[1]) && /^[A-Z]+$/.test(m[1])) {
      const letters = [...m[1].toLowerCase()].map((c) => LETTERS[c] ?? c).join(" ");
      return m[2] ? `${letters} ${m[2]}` : letters;
    }
    return token;
  });
}
