import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";
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
    return { shoulder, arm, side };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // --- Indicadores de estado (no cuentan para el hit-test) ---
  const indicators = new THREE.Group();
  indicators.position.y = 1.98;
  pivot.add(indicators);

  const thinking = new THREE.Group();
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dots = [-1, 0, 1].map((i) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), dotMat);
    d.position.x = i * 0.17;
    thinking.add(d);
    return d;
  });

  const alert = new THREE.Group();
  const alertMat = new THREE.MeshBasicMaterial({ color: 0xffc233 });
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), alertMat);
  bar.position.y = 0.09;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), alertMat);
  dot.position.y = -0.1;
  alert.add(bar, dot);

  const sparkles = new THREE.Group();
  sparkles.position.y = -0.4;
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff08a });
  const sparks = Array.from({ length: 6 }, () => {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), sparkMat);
    sparkles.add(s);
    return s;
  });

  indicators.add(thinking, alert, sparkles);
  thinking.visible = alert.visible = sparkles.visible = false;

  const tintables = [bodyMat, headMat];
  const baseColors = [BODY_COLOR, HEAD_COLOR];

  return {
    root,
    hitTargets: [body, skull, armL.arm, armR.arm],

    setState(state: CompanionState) {
      thinking.visible = state === "thinking";
      alert.visible = state === "waiting_permission";
      sparkles.visible = state === "celebrating";
    },

    applyPose(p: Pose, time: number) {
      pivot.position.y = p.bodyY;
      pivot.rotation.set(p.lean, p.yaw, p.sway);
      const sy = 1 - p.squash + p.breath;
      const sxz = 1 + p.squash * 0.5 - p.breath * 0.5;
      pivot.scale.set(sxz, sy, sxz);

      head.rotation.set(p.headPitch, p.headYaw, p.headRoll);

      // Derecha: +roll abre hacia +X; izquierda hacia -X. Pitch + = hacia delante (+Z).
      armL.shoulder.rotation.set(-p.armLPitch, 0, -p.armLRoll);
      armR.shoulder.rotation.set(-p.armRPitch, 0, p.armRRoll);

      tintables.forEach((m, i) => m.color.copy(baseColors[i]).lerp(ERROR_COLOR, p.tint));

      if (thinking.visible) {
        dots.forEach((d, i) => {
          const w = Math.sin(time * 4 - i * 0.8);
          d.position.y = w * 0.05;
          d.scale.setScalar(0.75 + 0.25 * (w * 0.5 + 0.5));
        });
      }
      if (alert.visible) alert.scale.setScalar(1 + 0.12 * Math.sin(time * 8));
      if (sparkles.visible) {
        sparks.forEach((s, i) => {
          const a = time * 3 + (i * Math.PI) / 3;
          s.position.set(Math.cos(a) * 0.7, Math.sin(time * 5 + i) * 0.15, Math.sin(a) * 0.4);
          s.rotation.set(time * 2 + i, time * 3, 0);
        });
      }
    },
  };
}
