/**
 * Lipsync básico: Web Speech no da audio ni niveles, así que la boca se mueve con una
 * oscilación suave mientras habla y recibe un empujón con cada palabra (evento `boundary`),
 * cambiando de vocal. Devuelve el peso de cada visema VRM (aa/ih/ou/ee/oh).
 */
export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh";
const VISEMES: Viseme[] = ["aa", "ih", "ou", "ee", "oh"];
// "aa" y "oh" abren más la boca: salen más a menudo.
const PICK: Viseme[] = ["aa", "aa", "oh", "ee", "ih", "ou", "aa", "oh"];

export class Lipsync {
  private speaking = false;
  private level = 0; // apertura suavizada 0..1
  private bump = 0; // empujón por palabra
  private vowel: Viseme = "aa";
  private t = 0;
  /** Cuánto está hablando ahora (0..1), para acompañar el habla con la cabeza. */
  get energy() {
    return this.level;
  }
  readonly weights: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  setSpeaking(value: boolean) {
    this.speaking = value;
    if (value) this.pulse();
  }

  /** Nueva palabra: cambia de vocal y abre un poco más. */
  pulse() {
    this.bump = 1;
    this.vowel = PICK[Math.floor(Math.random() * PICK.length)];
  }

  update(dt: number): Record<Viseme, number> {
    this.t += dt;
    this.bump = Math.max(0, this.bump - dt * 5);
    const wobble = 0.5 + 0.5 * Math.sin(this.t * 11) * Math.sin(this.t * 4.3 + 1);
    const target = this.speaking ? 0.2 + 0.35 * wobble + 0.3 * this.bump : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dt * 20));

    for (const v of VISEMES) {
      const goal = v === this.vowel ? this.level : 0;
      this.weights[v] += (goal - this.weights[v]) * (1 - Math.exp(-dt * 25));
    }
    return this.weights;
  }
}
