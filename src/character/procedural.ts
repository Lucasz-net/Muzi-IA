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
    // Brazos relajados: un poco adelantados y separados del cuerpo, con los codos algo doblados.
    armLPitch: 0.07,
    armLRoll: 0.3,
    armRPitch: 0.07,
    armRRoll: 0.3,
    armLElbow: 0.24,
    armRElbow: 0.24,
    weight: 0,
    curl: 0.5, // dedos sueltos, ligeramente doblados
    shoulders: 0,
    tint: 0,
  };
}

const { sin, cos, abs, exp, max } = Math;

/**
 * Reparto lento del peso entre las piernas (-1..1): cambia de pie cada ~8 s, como una persona
 * de pie. Dos senos de periodos distintos para que no sea un vaivén perfectamente regular.
 */
const weightShift = (t: number) => sin(t * 0.39) * 0.85 + sin(t * 0.13 + 1) * 0.15;

/** Poses generadas por código (pose + movimiento sutil) mientras no haya clips de animación. */
export const proceduralPoses: PoseSource = {
  poseFor(state: CompanionState, t: number, s: number): Pose {
    // Base común: respiración y movimientos lentos (aleatorios en apariencia, no mecánicos).
    const p = restPose();
    const breathing = sin(t * 1.45);
    p.breath = breathing * 0.012;
    p.shoulders = breathing * 0.014; // los hombros suben un poco al inspirar
    p.sway = sin(t * 0.43) * 0.012;
    p.headYaw = sin(t * 0.37) * 0.03;
    p.headRoll = sin(t * 0.29 + 0.6) * 0.025;
    p.headPitch = sin(t * 0.21) * 0.02;
    p.armLRoll += breathing * 0.012 + sin(t * 0.53) * 0.015;
    p.armRRoll += breathing * 0.012 + sin(t * 0.53 + 1.3) * 0.015;
    p.armLPitch += sin(t * 0.47) * 0.03;
    p.armRPitch += sin(t * 0.47 + 2) * 0.03;
    p.weight = weightShift(t) * 0.3; // en actividad el peso casi no cambia

    switch (state) {
      case "idle":
        // En reposo el peso sí pasa de una pierna a otra y se ladea un poco más la cabeza.
        p.weight = weightShift(t);
        p.lean = -0.012;
        p.headRoll += sin(t * 0.17) * 0.02;
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
