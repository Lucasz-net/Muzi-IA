import * as THREE from "three";

/** Alto (m) del corazón con el gesto en su punto máximo. */
const HEIGHT_M = 0.042;
/** Cuánto sube (m) por encima de las yemas de los dedos. */
const LIFT_M = 0.05;

/** Curva de un corazón de alto 1, con la punta hacia abajo y centrado en el origen. */
function heartGeometry(grow = 1) {
  const s = new THREE.Shape();
  s.moveTo(0.25, 0.25);
  s.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0);
  s.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35);
  s.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
  s.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35);
  s.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0);
  s.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
  const g = new THREE.ShapeGeometry(s, 24);
  g.translate(-0.25, -0.475, 0);
  // La curva está dibujada con el eje Y hacia abajo (como un lienzo): se voltea para que la punta quede abajo.
  g.scale(grow / 0.95, -grow / 0.95, 1);
  return g;
}

/** Entrada con un pequeño rebote y salida suave. */
const pop = (w: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, w * 1.6); // llega a su tamaño pronto y se queda
  return x <= 0 ? 0 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/**
 * Corazón rojo con contorno oscuro que flota sobre la mano en el corazón coreano. Se dibuja por
 * encima de todo (sin prueba de profundidad) para que el pelo no lo tape, y siempre mira a +Z, que
 * es hacia donde está la cámara.
 */
export function createHeart() {
  const root = new THREE.Group();
  const outline = new THREE.Mesh(
    heartGeometry(1.22),
    new THREE.MeshBasicMaterial({ color: 0x7d1424, depthTest: false, transparent: true, side: THREE.DoubleSide }),
  );
  const fill = new THREE.Mesh(
    heartGeometry(1),
    new THREE.MeshBasicMaterial({ color: 0xe8333d, depthTest: false, transparent: true, side: THREE.DoubleSide }),
  );
  // Un brillo pequeño arriba a la izquierda para que no se vea plano.
  const shine = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 16),
    new THREE.MeshBasicMaterial({ color: 0xff8a8f, depthTest: false, transparent: true, side: THREE.DoubleSide }),
  );
  shine.position.set(-0.17, 0.2, 0);
  outline.renderOrder = 20;
  fill.renderOrder = 21;
  shine.renderOrder = 22;
  root.add(outline, fill, shine);
  root.visible = false;

  const target = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  return {
    root,
    /**
     * @param w presencia 0..1 del corazón
     * @param tips posiciones del mundo de las yemas (índice y pulgar) entre las que flota
     * @param time reloj global (s), para el vaivén
     */
    update(w: number, tips: [THREE.Vector3, THREE.Vector3] | null, time: number) {
      if (!tips || w < 0.01) {
        root.visible = false;
        return;
      }
      root.visible = true;
      target.copy(tips[0]).add(tips[1]).multiplyScalar(0.5);
      root.parent?.worldToLocal(target);
      tmp.set(0, LIFT_M + 0.004 * Math.sin(time * 4.2), 0);
      root.position.copy(target).add(tmp);
      root.rotation.z = 0.12 * Math.sin(time * 2.6);
      const s = HEIGHT_M * pop(w) * (0.5 + 0.5 * Math.min(1, w * 2)) * (1 + 0.07 * Math.sin(time * 5.5));
      root.scale.setScalar(Math.max(s, 0.0001));
    },
  };
}
