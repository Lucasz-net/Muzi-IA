import type { CompanionState } from "../core/stateMachine";
import type { Pose, PoseSource } from "./types";

export function restPose(): Pose {
  return {
    bodyY: 0,
    lean: 0,
    sway: 0,
    yaw: 0,
    squash: 0,
    breath: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    armLPitch: 0,
    armLRoll: 0.12,
    armRPitch: 0,
    armRRoll: 0.12,
    armLElbow: 0.12, // codos ligeramente flexionados en reposo
    armRElbow: 0.12,
    tint: 0,
  };
}

const { sin, cos, abs, exp, max } = Math;

/** Poses generadas por código (pose + movimiento sutil) mientras no haya clips de animación. */
export const proceduralPoses: PoseSource = {
  poseFor(state: CompanionState, t: number, s: number): Pose {
    // Base común: respiración y balanceo lentos.
    const p = restPose();
    p.breath = sin(t * 1.6) * 0.015;
    p.sway = sin(t * 0.7) * 0.02;
    p.headYaw = sin(t * 0.5) * 0.08;
    p.armLRoll += sin(t * 1.6) * 0.02;
    p.armRRoll += sin(t * 1.6 + 0.4) * 0.02;

    switch (state) {
      case "idle":
        break;

      case "thinking":
        p.headRoll = 0.22;
        p.headPitch = -0.12;
        p.headYaw = sin(t * 0.9) * 0.3;
        p.lean = -0.03;
        // Mano en la barbilla: brazo algo adelantado y antebrazo plegado hacia arriba.
        p.armRPitch = 0.6;
        p.armRRoll = 0.3;
        p.armRElbow = 2.3 + sin(t * 1.3) * 0.05;
        break;

      case "working":
        p.lean = 0.1;
        p.headPitch = 0.22;
        p.headYaw = sin(t * 2) * 0.1;
        p.bodyY = abs(sin(t * 9)) * 0.012;
        // Teclear: antebrazos horizontales al frente, las manos alternan arriba y abajo.
        p.armLPitch = 0.8;
        p.armRPitch = 0.8;
        p.armLRoll = 0.25;
        p.armRRoll = 0.25;
        p.armLElbow = 0.77 + sin(t * 14) * 0.12;
        p.armRElbow = 0.77 + sin(t * 14 + Math.PI) * 0.12;
        break;

      case "waiting_permission":
        p.headRoll = sin(t * 3) * 0.1;
        p.headPitch = -0.08;
        p.bodyY = abs(sin(t * 4)) * 0.035;
        // Saluda con el brazo derecho para pedir atención.
        p.armRRoll = 2.75 + sin(t * 9) * 0.22;
        p.armRElbow = 0.3;
        break;

      case "responding":
        p.headPitch = sin(t * 3.2) * 0.07;
        // Gesticula con el brazo izquierdo.
        p.armLRoll = 0.4 + sin(t * 2) * 0.1;
        p.armLPitch = 0.5 + sin(t * 2.4) * 0.12;
        p.armLElbow = 0.9 + sin(t * 2.4 + 1) * 0.2;
        p.armRRoll = 0.2;
        break;

      case "celebrating": {
        // Salto con brazos arriba, decayendo.
        const k = exp(-s * 0.6);
        p.bodyY = max(0, sin(s * 8)) * 0.22 * k;
        p.squash = cos(s * 8) * 0.07 * k;
        p.yaw = sin(s * 4) * 0.45 * k;
        p.headPitch = -0.2;
        p.armLRoll = 2.85 + sin(s * 18) * 0.2;
        p.armRRoll = 2.85 + sin(s * 18 + 1) * 0.2;
        p.armLElbow = 0;
        p.armRElbow = 0;
        break;
      }

      case "error": {
        p.lean = -0.08;
        p.bodyY = -0.02;
        p.headPitch = 0.35;
        p.headYaw = sin(s * 22) * 0.25 * exp(-s * 1.5);
        p.armLRoll = 0.04;
        p.armRRoll = 0.04;
        p.armLElbow = 0.05;
        p.armRElbow = 0.05;
        p.tint = 0.65;
        break;
      }
    }
    return p;
  },
};
