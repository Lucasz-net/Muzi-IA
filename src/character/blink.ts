/** Parpadeo automático: devuelve el peso (0..1) de la expresión `blink` en cada fotograma. */
const CLOSE_S = 0.06;
const HOLD_S = 0.04;
const OPEN_S = 0.12;
const TOTAL_S = CLOSE_S + HOLD_S + OPEN_S;

export class Blink {
  private wait = 2.5; // segundos hasta el próximo parpadeo
  private t = -1; // progreso del parpadeo en curso (-1 = ojos abiertos)

  update(dt: number): number {
    if (this.t < 0) {
      this.wait -= dt;
      if (this.wait > 0) return 0;
      this.t = 0;
    }
    this.t += dt;
    if (this.t >= TOTAL_S) {
      this.t = -1;
      // A veces un parpadeo doble.
      this.wait = Math.random() < 0.2 ? 0.18 : 2 + Math.random() * 4;
      return 0;
    }
    if (this.t < CLOSE_S) return this.t / CLOSE_S;
    if (this.t < CLOSE_S + HOLD_S) return 1;
    return 1 - (this.t - CLOSE_S - HOLD_S) / OPEN_S;
  }
}
