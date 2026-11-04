/**
 * Elige qué clip toca entre las variantes de un estado (p. ej. los del reposo), de forma que
 * cada uno salga con la frecuencia que se le pidió, sin repetirse en fila y sin que ninguno
 * se quede sin aparecer. Es una clase pura (sin dependencias) para poder simularla.
 *
 * Cada variante declara su `cooldown`: los segundos mínimos antes de que pueda volver a salir.
 *  - Enfriamiento: hasta que pasa el `cooldown` el clip no es candidato.
 *  - Memoria: se evitan los últimos clips elegidos (así no hay patrones A-B-A).
 *  - Refuerzo: una vez disponible, cuanto más tiempo lleva sin salir más sube su peso (hasta
 *    ×(1 + OVERDUE_BOOST)), de modo que ninguno se queda sin aparecer aunque tenga poco peso.
 *  - Fase inicial aleatoria: cada clip parte como si hubiera salido hace una fracción de su
 *    intervalo, para que no salgan todos a la vez al arrancar.
 * En la práctica el clip vuelve a salir a los ~1,2-1,5 × su `cooldown`, según cuánta competencia tenga.
 */
export interface Variant {
  file: string;
  /** Probabilidad relativa frente a las demás variantes disponibles (por defecto 1). */
  weight: number;
  /** Segundos mínimos antes de que pueda volver a salir. */
  cooldown: number;
}

/** Fracción del intervalo "típico" que representa el `cooldown` (intervalo = cooldown / COOLDOWN_SHARE). */
const COOLDOWN_SHARE = 0.45;
/** Cuánto sube el peso de un clip retrasado (a los 2 intervalos vale 1 + este valor veces su peso). */
const OVERDUE_BOOST = 2;
/** Cuántos de los últimos clips elegidos se evitan. */
const AVOID_RECENT = 2;

export class VariantPicker {
  private readonly lastAt = new Map<string, number>();
  private readonly recent: string[] = [];
  private readonly rng: () => number;

  /** @param rng Generador de números aleatorios (inyectable para simular de forma reproducible). */
  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  /** Instante (s) de la última vez que salió; si nunca salió, se le inventa una fase aleatoria. */
  private last(v: Variant, now: number): number {
    let at = this.lastAt.get(v.file);
    if (at === undefined) {
      at = now - (v.cooldown / COOLDOWN_SHARE) * (0.15 + this.rng() * 0.7);
      this.lastAt.set(v.file, at);
    }
    return at;
  }

  /**
   * Elige un clip, o `null` si ahora no toca ninguno (todos en enfriamiento): quien llama
   * debería reintentarlo un poco más tarde.
   * @param now Reloj en segundos (solo importan las diferencias).
   */
  pick(variants: Variant[], now: number): string | null {
    if (variants.length === 0) return null;
    // Con pocas variantes no se puede evitar tanta historia.
    const avoid = this.recent.slice(-Math.min(AVOID_RECENT, Math.max(0, variants.length - 2)));
    const weights = variants.map((v) => {
      const since = now - this.last(v, now);
      if (avoid.includes(v.file) || since < v.cooldown) return 0;
      const interval = v.cooldown / COOLDOWN_SHARE;
      const overdue = Math.min(1, Math.max(0, (since - interval) / interval));
      return Math.max(0, v.weight) * (1 + OVERDUE_BOOST * overdue);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;

    let r = this.rng() * total;
    const index = weights.findIndex((w) => (r -= w) < 0);
    const chosen = variants[index < 0 ? weights.findIndex((w) => w > 0) : index].file;
    this.lastAt.set(chosen, now);
    this.recent.push(chosen);
    if (this.recent.length > 8) this.recent.shift();
    return chosen;
  }
}
