import type { CompanionState } from "../core/stateMachine";
import { restPose } from "./procedural";
import type { Character, Pose, PoseSource } from "./types";

/**
 * Lleva el personaje hacia la pose objetivo del estado actual con suavizado exponencial
 * y la aplica al modelo. No sabe nada del modelo concreto.
 */
export class Animator {
  private state: CompanionState = "idle";
  private enteredAt = 0;
  private pose: Pose = restPose();

  constructor(
    private character: Character,
    private source: PoseSource,
  ) {}

  setState(state: CompanionState, now: number) {
    if (state === this.state) return;
    this.state = state;
    this.enteredAt = now;
    this.character.setState(state);
  }

  update(t: number, dt: number) {
    const target = this.source.poseFor(this.state, t, t - this.enteredAt);
    // Los saltos necesitan respuesta más rápida que el resto de poses.
    const speed = this.state === "celebrating" ? 16 : 8;
    const k = 1 - Math.exp(-dt * speed);
    for (const key of Object.keys(target) as (keyof Pose)[]) {
      this.pose[key] += (target[key] - this.pose[key]) * k;
    }
    this.character.applyPose(this.pose, t);
  }
}
