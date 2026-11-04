import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";
import { Animator } from "./animator";
import { createPlaceholder } from "./placeholder";
import { proceduralPoses } from "./procedural";

export interface CharacterScene {
  /** True si el punto (px lógicos de la ventana) cae sobre el personaje. */
  hitTest: (x: number, y: number) => boolean;
  /** Cambia el estado que anima al personaje. */
  setState: (state: CompanionState) => void;
}

export function createScene(canvas: HTMLCanvasElement): CharacterScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.0, 5.0);
  camera.lookAt(0, 0.95, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);

  const character = createPlaceholder();
  scene.add(character.root);
  const animator = new Animator(character, proceduralPoses);

  // El canvas ocupa solo la franja central de la ventana (ver CSS #stage): se dimensiona por él.
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let last = 0;
  renderer.setAnimationLoop(() => {
    const t = now();
    animator.update(t, Math.min(t - last, 0.1));
    last = t;
    renderer.render(scene, camera);
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitTest = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(character.hitTargets, true).length > 0;
  };

  return { hitTest, setState: (state) => animator.setState(state, now()) };
}
