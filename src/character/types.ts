import type { Object3D } from "three";
import type { CompanionState } from "../core/stateMachine";

/**
 * Pose abstracta del personaje, independiente del modelo.
 * Ángulos en radianes, desplazamientos en metros. El placeholder la aplica a sus mallas
 * y el personaje VRM a los huesos humanoides (spine, head, upperArm...).
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
  // Brazos: pitch + = hacia delante; roll = apertura hacia fuera/arriba (0 = colgando, π/2 = horizontal, π = vertical).
  armLPitch: number;
  armLRoll: number;
  armRPitch: number;
  armRRoll: number;
  // Codos: flexión del antebrazo (0 = brazo estirado, + = antebrazo hacia delante/arriba).
  armLElbow: number;
  armRElbow: number;
  weight: number; // reparto del peso entre las piernas: + = sobre la pierna izquierda del personaje, - = sobre la derecha
  curl: number; // 0..1 curvatura relajada de los dedos
  shoulders: number; // elevación de los hombros (respiración)
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
  /** Encuadre de cámara: altura de pantalla que debe ocupar el modelo y su centro vertical (m). */
  framing: { centerY: number; height: number };
  /** Encuadre alternativo de plano medio (de medio muslo hacia arriba); si falta se usa `framing`. */
  framingUpper?: { centerY: number; height: number };
  /** Avisa del cambio de estado (indicadores, expresiones). */
  setState(state: CompanionState): void;
  applyPose(pose: Pose, time: number): void;
  /** Por fotograma, tras aplicar la pose: expresiones, mirada, físicas. */
  update?(dt: number, time: number): void;
  /** Punto de interés de la mirada, normalizado a -1..1 respecto al personaje (x: derecha, y: arriba). */
  setGaze?(nx: number, ny: number, time: number): void;
  /** El personaje está hablando (voz): activa el lipsync. */
  setSpeaking?(speaking: boolean): void;
  /** Una palabra nueva: empuja la boca. */
  pulseMouth?(): void;
  /** Carga animaciones (Mixamo) asignadas a estados. */
  loadAnimations?(entries: import("./clipLayer").ClipEntry[]): Promise<void>;
  /** Reproduce un clip a mano (desarrollo): `null` para, `undefined` vuelve al comportamiento por estado. */
  playClip?(file: string | null | undefined): void;
  /** Nombres de los clips cargados. */
  listClips?(): string[];
  /** Lanza un gesto hecho con código (guiño, sonrisa, asentir...). Devuelve false si no existe. */
  gesture?(name: string): boolean;
  /** Nombres de los gestos disponibles. */
  listGestures?(): string[];
}
