import type { Object3D } from "three";
import type { CompanionState } from "../core/stateMachine";

/**
 * Pose abstracta del personaje, independiente del modelo.
 * Ángulos en radianes, desplazamientos en metros. El placeholder la aplica a sus mallas
 * y el cargador de VRM la aplicará a los huesos humanoides (spine, head, upperArm...).
 */
export interface Pose {
  bodyY: number; // desplazamiento vertical
  lean: number; // inclinación del torso (+ = hacia delante)
  sway: number; // balanceo lateral del torso
  yaw: number; // giro del cuerpo
  squash: number; // aplastar/estirar (+ = aplastado)
  breath: number; // expansión del torso al respirar
  headPitch: number; // + = asentir (mirar abajo)
  headYaw: number;
  headRoll: number;
  // Brazos: pitch + = hacia delante; roll = apertura hacia fuera/arriba (0 = colgando, π = vertical).
  armLPitch: number;
  armLRoll: number;
  armRPitch: number;
  armRRoll: number;
  tint: number; // 0..1 tinte de error (rojizo)
}

/** Dónde se obtiene la pose objetivo de cada estado: procedural hoy, clips (Mixamo/VRMA) después. */
export interface PoseSource {
  /** @param t tiempo global (s). @param stateTime tiempo desde que se entró al estado (s). */
  poseFor(state: CompanionState, t: number, stateTime: number): Pose;
}

/** Contrato que cumple cualquier personaje (placeholder, VRM...). */
export interface Character {
  root: Object3D;
  /** Objetos sobre los que se hace el hit-test del click-through (excluye indicadores). */
  hitTargets: Object3D[];
  /** Avisa del cambio de estado (para extras como indicadores de pensando/alerta). */
  setState(state: CompanionState): void;
  applyPose(pose: Pose, time: number): void;
}
