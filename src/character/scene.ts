import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";
import { Animator } from "./animator";
import { findClipEntries } from "./animationSource";
import { findModelUrl } from "./modelSource";
import { createPlaceholder } from "./placeholder";
import { proceduralPoses } from "./procedural";
import type { Character, GestureLevel } from "./types";
import { loadVrmCharacter, uploadAndReleaseTextures } from "./vrmCharacter";

export type ViewMode = "full" | "upper";

export interface CharacterScene {
  /** True si hay personaje (no transparente) bajo el punto (px lógicos de la ventana). */
  hitTest: (x: number, y: number) => boolean;
  /** Cambia el estado que anima al personaje. */
  setState: (state: CompanionState) => void;
  /** Posición del cursor (px lógicos de la ventana): el personaje lo mira. */
  setGaze: (x: number, y: number) => void;
  setSpeaking: (speaking: boolean) => void;
  pulseMouth: (vowel?: "aa" | "ih" | "ou" | "ee" | "oh") => void;
  /** Solo desarrollo: reproduce un clip por nombre de archivo (`null` para, sin argumento vuelve a los estados). */
  playClip: (file?: string | null) => void;
  /** Solo desarrollo: nombres de los clips cargados. */
  listClips: () => string[];
  /** Solo desarrollo: lanza un gesto hecho con código ("wink", "smile", "nod"...). Devuelve false si no existe. */
  gesture: (name: string) => boolean;
  listGestures: () => string[];
  /** Con qué frecuencia lanza gestos sola en reposo ("off", "pocos", "normal", "muchos"). */
  setGestureLevel: (level: GestureLevel) => void;
  /** "full" = cuerpo completo; "upper" = plano medio (de medio muslo hacia arriba). */
  setView: (view: ViewMode) => void;
  /** Resuelve cuando se intentó cargar el modelo VRM (con éxito o no). */
  modelReady: Promise<"vrm" | "placeholder">;
  /** Solo desarrollo: personaje activo y giro de la cámara (rad) para revisar poses. */
  debug: { character: () => Character; orbit: (yaw: number) => void; camera: () => THREE.PerspectiveCamera };
}

const FOV = 30;
/** Las animaciones son sutiles: 30 fps bastan y ahorran mucha CPU/GPU en un programa siempre abierto. */
const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;
/** Un píxel con más alfa que esto cuenta como "personaje" para el click-through. */
const SOLID_ALPHA = 24;

export function createScene(canvas: HTMLCanvasElement): CharacterScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);

  // El canvas ocupa solo la franja central de la ventana (ver CSS #stage): se dimensiona por él.
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // --- Personaje activo ---
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let state: CompanionState = "idle";
  let character: Character;
  let animator: Animator;

  // Cámara orbital alrededor del personaje (solo para depurar poses de perfil desde la consola).
  let framingDist = 5;
  let framingY = 1;
  let debugYaw = 0;
  const placeCamera = () => {
    camera.position.set(Math.sin(debugYaw) * framingDist, framingY, Math.cos(debugYaw) * framingDist);
    camera.lookAt(0, framingY, 0);
  };
  let view: ViewMode = "full";
  const frame = (c: Character) => {
    const f = view === "upper" ? (c.framingUpper ?? c.framing) : c.framing;
    framingDist = f.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    framingY = f.centerY;
    placeCamera();
  };
  const use = (next: Character) => {
    if (character) scene.remove(character.root);
    character = next;
    scene.add(next.root);
    animator = new Animator(next, proceduralPoses);
    next.setState(state);
    animator.setState(state, now());
    frame(next);
  };
  use(createPlaceholder());

  const url = findModelUrl();
  const modelReady: Promise<"vrm" | "placeholder"> = url
    ? loadVrmCharacter(url)
        .then((vrm) => {
          use(vrm);
          uploadAndReleaseTextures(renderer, vrm.root);
          vrm.loadAnimations?.(findClipEntries()).catch(console.error);
          return "vrm" as const;
        })
        .catch((err) => {
          console.error("No se pudo cargar el modelo VRM; se usa el placeholder:", err);
          return "placeholder" as const;
        })
    : Promise.resolve("placeholder" as const);

  // --- La interfaz sigue a la cabeza: se publica su posición y tamaño en píxeles de la ventana (variables CSS) para que
  // el globo de diálogo quede pegado al personaje, sea cual sea la vista (plano medio o cuerpo completo) ---
  const rootStyle = document.documentElement.style;
  const head = new THREE.Vector3();
  const side = new THREE.Vector3();
  const published = { x: NaN, y: NaN, r: NaN };
  const publish = (name: string, value: number, key: keyof typeof published) => {
    if (Math.abs(value - published[key]) < 1 || !Number.isFinite(value)) return;
    published[key] = value;
    rootStyle.setProperty(name, `${Math.round(value)}px`);
  };
  const trackHead = () => {
    // Se usa la cabeza en reposo, no la animada: si no, el globo y el chat bailan con cada gesto.
    const p = character.anchorPosition?.() ?? character.headPosition?.();
    if (!p) return;
    camera.updateMatrixWorld();
    const r = canvas.getBoundingClientRect();
    head.copy(p).project(camera);
    const x = r.left + (head.x * 0.5 + 0.5) * r.width;
    const y = r.top + (-head.y * 0.5 + 0.5) * r.height;
    // Radio de la cabeza en píxeles: un punto a 0,11 m a la derecha de la cámara.
    side.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(0.11);
    head.copy(p).add(side).project(camera);
    publish("--head-x", x, "x");
    publish("--head-y", y, "y");
    publish("--head-r", Math.abs(r.left + (head.x * 0.5 + 0.5) * r.width - x), "r");
  };

  // --- Hit-test por alfa del píxel renderizado (silueta exacta, sin raycast sobre mallas pesadas) ---
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  let probe: { x: number; y: number } | null = null;
  let solid = false;

  // --- Bucle de render ---
  let last = 0;
  let lastFrameAt = 0;
  renderer.setAnimationLoop((timestamp) => {
    if (timestamp - lastFrameAt < FRAME_MS - 2) return; // limita los fotogramas
    lastFrameAt = timestamp;
    const t = now();
    const dt = Math.min(t - last, 0.1);
    last = t;
    animator.update(t, dt);
    character.update?.(dt, t);
    renderer.render(scene, camera);
    trackHead();

    if (probe) {
      // Debe leerse justo tras render(): el búfer de dibujo se descarta al componer.
      gl.readPixels(probe.x, probe.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      solid = px[3] > SOLID_ALPHA;
      probe = null;
    }
  });

  const hitTest = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    probe = {
      x: Math.floor(((x - r.left) * canvas.width) / r.width),
      y: Math.floor(((r.bottom - y) * canvas.height) / r.height),
    };
    return solid; // resultado de la última lectura (un fotograma de retraso)
  };

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    hitTest,
    setState(next) {
      state = next;
      animator.setState(next, now());
    },
    setGaze(x, y) {
      const r = canvas.getBoundingClientRect();
      // Cabeza aproximada: 28% desde arriba del encuadre.
      const nx = clamp((x - (r.left + r.width / 2)) / 450);
      const ny = clamp((r.top + r.height * 0.28 - y) / 350);
      character.setGaze?.(nx, ny, now());
    },
    setSpeaking: (speaking) => character.setSpeaking?.(speaking),
    pulseMouth: (vowel) => character.pulseMouth?.(vowel),
    playClip: (file) => character.playClip?.(file),
    listClips: () => character.listClips?.() ?? [],
    gesture: (name) => character.gesture?.(name) ?? false,
    listGestures: () => character.listGestures?.() ?? [],
    setGestureLevel: (level) => character.setGestureLevel?.(level),
    setView(next) {
      view = next;
      document.documentElement.dataset.view = next; // el CSS difumina el borde inferior en plano medio
      frame(character);
    },
    modelReady,
    debug: {
      character: () => character,
      camera: () => camera,
      orbit: (yaw) => {
        debugYaw = yaw;
        placeCamera();
      },
    },
  };
}
