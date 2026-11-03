import * as THREE from "three";
import { createPlaceholder } from "./placeholder";

export interface CharacterScene {
  /** True si el punto (px lógicos de la ventana) cae sobre el personaje. */
  hitTest: (x: number, y: number) => boolean;
}

export function createScene(canvas: HTMLCanvasElement): CharacterScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.0, 4.2);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);

  const character = createPlaceholder();
  scene.add(character.root);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    character.update((performance.now() - t0) / 1000);
    renderer.render(scene, camera);
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitTest = (x: number, y: number) => {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(character.root, true).length > 0;
  };

  return { hitTest };
}
