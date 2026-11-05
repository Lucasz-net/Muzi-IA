import type { ReadMode } from "../core/settings";
import type { AgentEvent } from "../core/events";
import { fullText, sentencesOf, summarize, toSpeakable } from "./speakable";
import type { Mood, TTSProvider } from "./tts";

/** Tope de caracteres que se leen por turno en modo "completa" (unos 3 minutos de voz). */
const MAX_TURN_CHARS = 2600;

export interface NarratorOptions {
  /** Qué hay que leer ahora (se consulta en cada evento, así que cambiar el ajuste surte efecto al momento). */
  mode: () => ReadMode;
  /** ¿El turno tuvo tropiezos? Entonces la lectura es serena en vez de neutra. */
  isRough: () => boolean;
  /** ¿La voz está activada? (el botón de silenciar del menú). Si no, no se lee nada automáticamente. */
  enabled?: () => boolean;
}

/**
 * Lee en voz alta las respuestas de Mizu, más allá de los avisos:
 *  - "resumen": al terminar el turno dice las primeras frases de la respuesta final y avisa de que el resto está en
 *    pantalla (el código, las tablas y las listas largas no se leen).
 *  - "completa": va diciendo cada frase según llega la respuesta, sin esperar al final.
 * El texto se limpia antes (ver `speakable.ts`). Las frases se encolan: suenan una tras otra sin cortarse.
 */
export function createNarrator(tts: TTSProvider, { mode, isRough, enabled = () => true }: NarratorOptions) {
  let block = ""; // texto del bloque de respuesta en curso (entre dos usos de herramientas)
  let lastBlock = ""; // último bloque terminado: la respuesta final
  let spokenSentences = 0; // frases del bloque en curso ya encoladas ("completa")
  let spokenChars = 0; // caracteres leídos este turno ("completa")
  let spoke = false; // en este turno ya se ha dicho algo de la respuesta
  let notedCode = false; // ya se avisó de que había código en pantalla este turno ("completa")

  const mood = (): Mood => (isRough() ? "calma" : "neutral");
  const say = (text: string) => {
    if (!enabled()) return;
    spoke = true;
    const opts = { mood: mood() };
    (tts.enqueue ? tts.enqueue(text, opts) : tts.speak(text, opts)).catch(console.error);
  };

  /** "completa": encola las frases terminadas del bloque (la última puede estar a medias mientras llega). */
  const stream = (final: boolean) => {
    if (mode() !== "completa") return;
    const all = sentencesOf(toSpeakable(block).text);
    const ready = final ? all : all.slice(0, -1);
    for (let i = spokenSentences; i < ready.length; i++) {
      if (spokenChars + ready[i].length > MAX_TURN_CHARS) {
        if (spokenChars <= MAX_TURN_CHARS) say("El resto está en pantalla.");
        spokenChars = MAX_TURN_CHARS + 1;
        break;
      }
      say(ready[i]);
      spokenChars += ready[i].length;
    }
    spokenSentences = Math.max(spokenSentences, ready.length);
  };

  const endBlock = () => {
    stream(true);
    const cleaned = toSpeakable(block);
    if (mode() === "completa" && cleaned.omitted && !notedCode) {
      notedCode = true;
      say("El código está en pantalla.");
    }
    if (cleaned.text) lastBlock = block;
    block = "";
    spokenSentences = 0;
  };

  const reset = () => {
    block = "";
    lastBlock = "";
    spokenSentences = 0;
    spokenChars = 0;
    spoke = false;
    notedCode = false;
  };

  return {
    /** Hay algo de la respuesta que Mizu va a decir (o ya dijo) este turno: el aviso de "terminé" sobra. */
    get willSpeak() {
      return mode() !== "off" && enabled() && (spoke || toSpeakable(block).text.length > 0 || toSpeakable(lastBlock).text.length > 0);
    },
    /** El usuario envió un mensaje: se calla lo que estuviera diciendo y se empieza de cero. */
    userSent() {
      tts.cancel();
      reset();
    },
    handle(ev: AgentEvent) {
      switch (ev.type) {
        case "message":
          if (ev.is_delta) block += ev.text;
          else block = ev.text; // llega el texto completo: sustituye al acumulado (las frases ya dichas se saltan por posición)
          if (ev.is_delta) stream(false);
          else endBlock();
          break;
        case "tool_use":
          endBlock(); // lo dicho antes de usar una herramienta ya está completo
          break;
        case "done": {
          endBlock();
          if (mode() === "resumen") {
            const summary = summarize(lastBlock || ev.result || "");
            if (summary) say(summary);
          }
          reset();
          break;
        }
        case "error":
        case "idle":
          reset();
          break;
      }
    },
    /** Lee un texto entero (botón "Leer en voz alta" del globo), sin importar el ajuste. Devuelve false si no hay nada que leer. */
    readAll(markdown: string): boolean {
      const { sentences } = fullText(markdown);
      if (!sentences.length) return false;
      tts.cancel();
      for (const s of sentences) (tts.enqueue ? tts.enqueue(s, { mood: "neutral" }) : tts.speak(s, { mood: "neutral" })).catch(console.error);
      return true;
    },
    /** Corta lo que esté leyendo. */
    stop() {
      tts.cancel();
    },
  };
}

export type Narrator = ReturnType<typeof createNarrator>;
