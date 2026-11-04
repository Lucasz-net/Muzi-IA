import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import type { CompanionState } from "../core/stateMachine";
import { Blink } from "./blink";
import { ClipLayer, type ClipEntry } from "./clipLayer";
import { loadMixamoClip } from "./mixamo";
import { Gaze } from "./gaze";
import { createIndicators } from "./indicators";
import { Lipsync } from "./lipsync";
import type { Character, Pose } from "./types";

/** Expresión de fondo según el estado (se suaviza entre cambios). */
const STATE_EXPRESSIONS: Record<CompanionState, Partial<Record<string, number>>> = {
  idle: { relaxed: 0.25 },
  thinking: {},
  working: { relaxed: 0.1 },
  waiting_permission: { surprised: 0.35 },
  responding: { happy: 0.25 },
  celebrating: { happy: 1 },
  error: { sad: 0.8 },
};
const MANAGED_EXPRESSIONS = ["relaxed", "happy", "sad", "surprised", "angry"];

/** Huesos que escribe la pose procedural en cada fotograma. */
const OWNED_BONES: VRMHumanBoneName[] = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
];

/** Fracción de la altura del modelo a la que corta el plano medio (medio muslo). */
const UPPER_CUT = 0.38;

/** Margen (m) sobre la cabeza en el encuadre. */
const HEADROOM_M = 0.45;

/** Cuánto de la rotación de cabeza se reparte entre cuello y cabeza. */
const NECK_SHARE = 0.4;
const HEAD_SHARE = 0.6;
/** Radianes de giro de cabeza por unidad de mirada normalizada. */
const GAZE_HEAD_YAW = 0.45;
const GAZE_HEAD_PITCH = 0.25;

/** Carga un .vrm y lo envuelve como `Character`. */
export async function loadVrmCharacter(url: string): Promise<Character> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${url} no es un VRM válido`);

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // los VRM 0.x miran a -Z; los 1.0 ya miran a +Z (hacia la cámara)
  vrm.scene.traverse((o) => (o.frustumCulled = false)); // las mallas con esqueleto se recortan mal

  return new VrmCharacter(vrm);
}

/**
 * Sube todas las texturas del modelo a la GPU y libera los bitmaps ya decodificados que el
 * navegador conserva en RAM (~190 MB menos con un modelo típico de VRoid). Se sube cada una
 * explícitamente antes de liberarla, para que ninguna quede sin subir.
 */
export function uploadAndReleaseTextures(renderer: THREE.WebGLRenderer, root: THREE.Object3D) {
  const seen = new Set<string>();
  const release = (candidate: unknown) => {
    const tex = candidate as THREE.Texture | null;
    if (!tex?.isTexture || seen.has(tex.uuid)) return;
    seen.add(tex.uuid);
    renderer.initTexture(tex);
    const img = tex.image as unknown;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
  };
  root.traverse((obj) => {
    const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      // Las texturas de MToon están como propiedades y también dentro de los uniforms.
      for (const key in m) release((m as unknown as Record<string, unknown>)[key]);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) release(u?.value);
    }
  });
}

class VrmCharacter implements Character {
  readonly root = new THREE.Group();
  readonly framing: { centerY: number; height: number };
  readonly framingUpper: { centerY: number; height: number };

  private state: CompanionState = "idle";
  private readonly blink = new Blink();
  private readonly gaze = new Gaze();
  private readonly lipsync = new Lipsync();
  private readonly indicators = createIndicators(0.36);
  private readonly expr = new Map<string, number>(MANAGED_EXPRESSIONS.map((n) => [n, 0]));

  private readonly clips: ClipLayer;
  private readonly hips: THREE.Object3D;
  private readonly hipsRestY: number;
  private readonly bone: (name: VRMHumanBoneName) => THREE.Object3D | null;
  /** +1 si el brazo apunta hacia +X en T-pose, -1 si hacia -X (depende del modelo). */
  private readonly armDir: { left: number; right: number };
  private readonly headPos = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly qGaze = new THREE.Quaternion();

  constructor(private readonly vrm: VRM) {
    this.root.add(vrm.scene, this.indicators.root);
    this.bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);

    // Huesos que la pose procedural escribe a diario (el resto parte del reposo bajo un clip).
    const owned = new Set<THREE.Object3D>();
    for (const name of OWNED_BONES) {
      const node = this.bone(name);
      if (node) owned.add(node);
    }
    this.clips = new ClipLayer(vrm, owned);
    this.clips.afterMix = () => this.followGazeOverClip();

    this.hips = this.bone("hips")!;
    this.hipsRestY = this.hips.position.y;

    // Dirección de cada brazo en T-pose, medida en el propio modelo.
    vrm.scene.updateMatrixWorld(true);
    const side = (arm: VRMHumanBoneName, hand: VRMHumanBoneName) => {
      const a = this.bone(arm)?.getWorldPosition(new THREE.Vector3());
      const h = this.bone(hand)?.getWorldPosition(new THREE.Vector3());
      return a && h && h.x < a.x ? -1 : 1;
    };
    this.armDir = {
      left: side("leftUpperArm", "leftHand"),
      right: side("rightUpperArm", "rightHand"),
    };

    // Encuadre: el modelo completo más margen arriba para brazos levantados, saltos e indicadores.
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const top = HEADROOM_M;
    const bottom = 0.05;
    const height = box.max.y - box.min.y + top + bottom;
    this.framing = { centerY: box.min.y - bottom + height / 2, height };

    // Plano medio: corta a medio muslo (≈38 % de la altura del modelo) y mantiene el margen superior.
    const cutY = box.min.y + (box.max.y - box.min.y) * UPPER_CUT;
    const upperHeight = box.max.y + top - cutY;
    this.framingUpper = { centerY: cutY + upperHeight / 2, height: upperHeight };

    if (vrm.lookAt) vrm.lookAt.target = this.gaze.target;
    this.setState("idle");
  }

  setState(state: CompanionState) {
    this.state = state;
    this.indicators.setState(state);
    this.clips.setState(state);
    this.gaze.setState(state);
  }

  async loadAnimations(entries: ClipEntry[]) {
    for (const entry of entries) {
      try {
        this.clips.register(entry, await loadMixamoClip(entry.url, this.vrm));
      } catch (err) {
        console.error(`No se pudo cargar la animación ${entry.file}:`, err);
      }
    }
  }

  playClip(file: string | null | undefined) {
    this.clips.force(file);
  }

  listClips() {
    return this.clips.names();
  }

  setGaze(nx: number, ny: number, time: number) {
    this.gaze.setCursor(nx, ny, time);
  }

  setSpeaking(speaking: boolean) {
    this.lipsync.setSpeaking(speaking);
  }

  pulseMouth() {
    this.lipsync.pulse();
  }

  applyPose(p: Pose, _time: number) {
    const gazeYaw = p.headYaw + this.gaze.yaw * GAZE_HEAD_YAW;
    const gazePitch = p.headPitch - this.gaze.pitch * GAZE_HEAD_PITCH;

    this.hips.position.y = this.hipsRestY + p.bodyY;
    this.hips.rotation.set(0, p.yaw, 0);
    this.vrm.scene.scale.set(1 + p.squash * 0.5, 1 - p.squash, 1 + p.squash * 0.5);

    this.rot("spine", p.lean * 0.45 - p.breath, 0, p.sway * 0.5);
    this.rot("chest", p.lean * 0.35 - p.breath * 1.4, 0, p.sway * 0.3);
    this.rot("upperChest", p.lean * 0.2, 0, p.sway * 0.2);
    this.rot("neck", gazePitch * NECK_SHARE, gazeYaw * NECK_SHARE, p.headRoll * NECK_SHARE);
    this.rot("head", gazePitch * HEAD_SHARE, gazeYaw * HEAD_SHARE, p.headRoll * HEAD_SHARE);

    this.arm("left", p.armLPitch, p.armLRoll, p.armLElbow);
    this.arm("right", p.armRPitch, p.armRRoll, p.armRElbow);
  }

  update(dt: number, time: number) {
    const em = this.vrm.expressionManager;

    // Capa de clips (Mixamo) sobre la pose procedural que acaba de aplicarse.
    this.clips.update(dt);

    this.bone("head")?.getWorldPosition(this.headPos);
    this.gaze.update(dt, time, this.headPos);
    this.indicators.root.position.copy(this.headPos);
    this.indicators.update(time);

    if (em) {
      // Expresión de fondo según el estado.
      const goal = STATE_EXPRESSIONS[this.state];
      const k = 1 - Math.exp(-dt * 6);
      for (const [name, cur] of this.expr) {
        const next = cur + ((goal[name] ?? 0) - cur) * k;
        this.expr.set(name, next);
        em.setValue(name, next);
      }
      em.setValue("blink", this.blink.update(dt));
      const mouth = this.lipsync.update(dt);
      for (const v of Object.keys(mouth) as (keyof typeof mouth)[]) em.setValue(v, mouth[v]);
    }

    this.vrm.update(dt);
  }

  /**
   * Bajo un clip la cabeza la dicta el clip; se le suma el giro hacia donde mira, en la parte
   * que la pose procedural ya no aporta (así la cabeza sigue acompañando a la mirada).
   */
  private followGazeOverClip() {
    const amount = this.clips.amount;
    if (amount < 0.01) return;
    const yaw = this.gaze.yaw * GAZE_HEAD_YAW * amount;
    const pitch = -this.gaze.pitch * GAZE_HEAD_PITCH * amount;
    for (const [name, share] of [["neck", NECK_SHARE], ["head", HEAD_SHARE]] as const) {
      this.e.set(pitch * share, yaw * share, 0, "XYZ");
      this.bone(name)?.quaternion.multiply(this.qGaze.setFromEuler(this.e));
    }
  }

  /** Rotación (Euler XYZ) de un hueso normalizado; ignora los que el modelo no tenga. */
  private rot(name: VRMHumanBoneName, x: number, y: number, z: number) {
    this.bone(name)?.rotation.set(x, y, z);
  }

  /**
   * Brazo desde la T-pose del VRM: roll 0 = colgando, π/2 = horizontal, π = vertical;
   * pitch = balanceo hacia delante; elbow = flexión del antebrazo (0 = estirado).
   */
  private arm(side: "left" | "right", pitch: number, roll: number, elbow: number) {
    const dir = this.armDir[side];
    this.e.set(-pitch, 0, -dir * (Math.PI / 2 - roll), "XYZ");
    this.bone(`${side}UpperArm`)?.quaternion.setFromEuler(this.e);

    this.e.set(0, -dir * elbow, 0, "XYZ");
    this.bone(`${side}LowerArm`)?.quaternion.setFromEuler(this.e);
  }
}
