import * as THREE from "three";

/** Personaje de relleno (cápsula con "ojos") usado cuando no hay un .vrm disponible. */
export interface Character {
  root: THREE.Object3D;
  update: (time: number) => void;
}

export function createPlaceholder(): Character {
  const root = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.9, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x7cc4ff, roughness: 0.5 }),
  );
  body.position.y = 0.95;
  root.add(body);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b2a3a });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), eyeMat);
    eye.position.set(side * 0.16, 1.25, 0.36);
    root.add(eye);
  }

  return {
    root,
    update(time) {
      // Respiración sutil.
      const breath = Math.sin(time * 1.6) * 0.015;
      body.scale.set(1 + breath, 1 - breath, 1 + breath);
    },
  };
}
