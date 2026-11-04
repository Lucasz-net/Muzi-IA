import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";
import { createIndicators } from "./indicators";
import type { Character, Pose } from "./types";

const BODY_COLOR = new THREE.Color(0x7cc4ff);
const HEAD_COLOR = new THREE.Color(0xa5d8ff);
const ERROR_COLOR = new THREE.Color(0xff6b6b);

/** Personaje de relleno (cuerpo, cabeza, brazos) usado cuando no hay un .vrm disponible. */
export function createPlaceholder(): Character {
  const root = new THREE.Group();
  const pivot = new THREE.Group(); // gira/sube/aplasta todo el cuerpo desde los pies
  root.add(pivot);

  const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ color: HEAD_COLOR, roughness: 0.45 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 8, 24), bodyMat);
  body.position.y = 0.65;
  pivot.add(body);

  const head = new THREE.Group(); // pivote del cuello
  head.position.y = 1.2;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 24), headMat);
  skull.position.y = 0.25;
  head.add(skull);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b2a3a });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), eyeMat);
    eye.position.set(side * 0.13, 0.28, 0.32);
    head.add(eye);
  }
  pivot.add(head);

  // Brazos: pivote en el hombro, la cápsula cuelga hacia -Y.
  const makeArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.38, 1.05, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.34, 6, 12), bodyMat);
    arm.position.y = -0.26;
    shoulder.add(arm);
    pivot.add(shoulder);
    return shoulder;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Indicadores anclados al centro de la cabeza.
  const indicators = createIndicators();
  indicators.root.position.set(0, 1.45, 0);
  pivot.add(indicators.root);

  const tintables = [bodyMat, headMat];
  const baseColors = [BODY_COLOR, HEAD_COLOR];

  return {
    root,
    framing: { centerY: 0.95, height: 2.55 },
    framingUpper: { centerY: 1.15, height: 1.7 },

    setState(state: CompanionState) {
      indicators.setState(state);
    },

    applyPose(p: Pose, time: number) {
      pivot.position.y = p.bodyY;
      pivot.rotation.set(p.lean, p.yaw, p.sway);
      const sy = 1 - p.squash + p.breath;
      const sxz = 1 + p.squash * 0.5 - p.breath * 0.5;
      pivot.scale.set(sxz, sy, sxz);

      head.rotation.set(p.headPitch, p.headYaw, p.headRoll);

      // Derecha: +roll abre hacia +X; izquierda hacia -X. Pitch + = hacia delante (+Z).
      armL.rotation.set(-p.armLPitch, 0, -p.armLRoll);
      armR.rotation.set(-p.armRPitch, 0, p.armRRoll);

      tintables.forEach((m, i) => m.color.copy(baseColors[i]).lerp(ERROR_COLOR, p.tint));
      indicators.update(time);
    },
  };
}
