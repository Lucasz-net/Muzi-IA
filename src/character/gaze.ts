import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";

const EYE_SPEED = 9;
const HEAD_SPEED = 3.2;

type Mode = "front" | "wander" | "cursor";

/** Tiempos (s) y probabilidades del comportamiento en reposo. */
const IDLE_MIX: { mode: Mode; weight: number; min: number; max: number }[] = [
  { mode: "wander", weight: 0.5, min: 3, max: 6 }, // mira alrededor, girando la cabeza
  { mode: "front", weight: 0.3, min: 2, max: 5 }, // mira de frente
  { mode: "cursor", weight: 0.2, min: 1.5, max: 3.5 }, // sigue el cursor un ratito
];
/** Un cursor "reciente" es uno que se movió hace menos de esto (s); si no, no tiene sentido seguirlo. */
const CURSOR_FRESH_S = 25;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Mirada con vida propia. En reposo alterna al azar entre mirar alrededor (girando la cabeza),
 * mirar de frente y seguir el cursor un rato; el cursor NO la acapara. Durante la actividad
 * (pensar, trabajar, responder...) mira de frente o hacia donde corresponde al estado.
 *
 * Expone un `target` para `vrm.lookAt` y `yaw/pitch` suavizados (más lentos que los ojos) para
 * que la cabeza acompañe. Las coordenadas son normalizadas (-1..1) respecto al personaje.
 */
export class Gaze {
  readonly target = new THREE.Object3D();
  yaw = 0;
  pitch = 0;

  private goalX = 0;
  private goalY = 0;
  private x = 0;
  private y = 0;
  private cursorX = 0;
  private cursorY = 0;
  private lastCursor = -Infinity;
  private state: CompanionState = "idle";
  private mode: Mode = "front";
  private modeUntil = 0;
  private nextGlance = 0;
  private nextJitter = 0;
  private jitterX = 0;
  private jitterY = 0;

  setCursor(nx: number, ny: number, now: number) {
    this.cursorX = nx;
    this.cursorY = ny;
    this.lastCursor = now;
  }

  setState(state: CompanionState) {
    this.state = state;
    this.modeUntil = 0; // reelige comportamiento en el siguiente fotograma
  }

  update(dt: number, now: number, head: THREE.Vector3) {
    if (now >= this.modeUntil) this.pickMode(now);
    this.updateGoal(now);

    this.x += (this.goalX + this.jitterX - this.x) * (1 - Math.exp(-dt * EYE_SPEED));
    this.y += (this.goalY + this.jitterY - this.y) * (1 - Math.exp(-dt * EYE_SPEED));
    this.yaw += (this.goalX - this.yaw) * (1 - Math.exp(-dt * HEAD_SPEED));
    this.pitch += (this.goalY - this.pitch) * (1 - Math.exp(-dt * HEAD_SPEED));

    // Punto delante de la cabeza hacia el que miran los ojos.
    this.target.position.set(head.x + this.x * 2.0, head.y + this.y * 1.2, head.z + 2.5);
  }

  private pickMode(now: number) {
    if (this.state !== "idle") {
      // Con actividad: de frente (el estado puede sesgar hacia dónde, ver updateGoal).
      this.mode = "front";
      this.modeUntil = now + 3;
      return;
    }
    const cursorFresh = now - this.lastCursor < CURSOR_FRESH_S;
    const options = IDLE_MIX.filter((o) => o.mode !== "cursor" || cursorFresh);
    let r = Math.random() * options.reduce((s, o) => s + o.weight, 0);
    const pick = options.find((o) => (r -= o.weight) < 0) ?? options[0];
    this.mode = pick.mode;
    this.modeUntil = now + rand(pick.min, pick.max);
    this.nextGlance = 0;
  }

  private updateGoal(now: number) {
    switch (this.mode) {
      case "cursor":
        this.goalX = this.cursorX;
        this.goalY = this.cursorY;
        break;
      case "wander":
        // Mira a un punto al azar y, a los ratos, a otro: gira la cabeza hacia los lados, arriba o abajo.
        if (now >= this.nextGlance) {
          this.goalX = rand(-0.95, 0.95);
          this.goalY = rand(-0.35, 0.45);
          this.nextGlance = now + rand(0.9, 2.2);
        }
        break;
      case "front": {
        // De frente; algunos estados miran hacia donde está lo que hacen.
        const bias = this.state === "working" ? -0.3 : this.state === "thinking" ? 0.35 : 0;
        this.goalX = this.state === "thinking" ? 0.3 : 0;
        this.goalY = bias;
        break;
      }
    }
    // Microsacadas: los ojos nunca están del todo quietos.
    if (now >= this.nextJitter) {
      this.jitterX = rand(-0.05, 0.05);
      this.jitterY = rand(-0.04, 0.04);
      this.nextJitter = now + rand(0.4, 1.4);
    }
  }
}
