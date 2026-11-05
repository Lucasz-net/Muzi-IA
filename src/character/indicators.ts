import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";

/**
 * Indicadores flotantes por estado (puntos al pensar, "!" al pedir permiso, destellos al
 * celebrar). Se anclan a la cabeza del personaje: el origen de `root` es el centro de la cabeza.
 */
export interface Indicators {
  root: THREE.Group;
  setState(state: CompanionState): void;
  update(time: number): void;
}

/** @param height Distancia (m) del centro de la cabeza a los puntos/"!" que flotan encima. */
/** Tamaño de los indicadores respecto al original: discretos, sin tapar la cara ni el globo. */
const K = 0.45;

export function createIndicators(height = 0.5): Indicators {
  const root = new THREE.Group();

  const thinking = new THREE.Group();
  thinking.position.y = height;
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xded5ff }); // lila claro, a juego con la interfaz
  const dots = [-1, 0, 1].map((i) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.055 * K, 12, 12), dotMat);
    d.position.x = i * 0.17 * K;
    thinking.add(d);
    return d;
  });

  const alert = new THREE.Group();
  alert.position.y = height;
  const alertMat = new THREE.MeshBasicMaterial({ color: 0xffd47a }); // ámbar suave
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * K, 0.12 * K, 4, 8), alertMat);
  bar.position.y = 0.09 * K;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055 * K, 12, 12), alertMat);
  dot.position.y = -0.1 * K;
  alert.add(bar, dot);

  const sparkles = new THREE.Group();
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xf1e6ff });
  const sparks = Array.from({ length: 6 }, () => {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07 * K), sparkMat);
    sparkles.add(s);
    return s;
  });

  root.add(thinking, alert, sparkles);
  thinking.visible = alert.visible = sparkles.visible = false;

  return {
    root,
    setState(state) {
      thinking.visible = state === "thinking";
      alert.visible = state === "waiting_permission";
      sparkles.visible = state === "celebrating";
    },
    update(time) {
      if (thinking.visible) {
        dots.forEach((d, i) => {
          const w = Math.sin(time * 4 - i * 0.8);
          d.position.y = w * 0.05 * K;
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
