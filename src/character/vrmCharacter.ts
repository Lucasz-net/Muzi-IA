import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import type { CompanionState } from "../core/stateMachine";
import { Blink } from "./blink";
import { ClipLayer, type ClipEntry } from "./clipLayer";
import { loadMixamoClip } from "./mixamo";
import { Gaze } from "./gaze";
import { emptyFrame, Gestures, IDLE_GESTURES, type ArmGesture, type GestureFrame } from "./gestures";
import { createHeart } from "./heart";
import { createIndicators } from "./indicators";
import { Lipsync } from "./lipsync";
import type { Character, GestureLevel, Pose } from "./types";

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

const SIDES = ["left", "right"] as const;
const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
/** Curvatura (rad) de cada falange con `curl` = 1. */
const CURL_ANGLES = [0.45, 0.65, 0.4];
const fingerBone = (side: string, finger: string, segment: string) => `${side}${finger}${segment}` as VRMHumanBoneName;

/** Huesos que escribe la pose procedural en cada fotograma (bajo un clip se mezclan desde aquí). */
const OWNED_BONES: VRMHumanBoneName[] = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
  ...SIDES.flatMap((s) => FINGERS.flatMap((f) => SEGMENTS.map((g) => fingerBone(s, f, g)))),
];

/** Desplazamiento lateral (m) de la cadera hacia la pierna que carga el peso, con `weight` = 1. */
const HIP_SHIFT_M = 0.02;
/** Inclinación de la pelvis (rad) con `weight` = 1: la cadera de la pierna que carga sube. */
const HIP_TILT = 0.05;
/** Largo aproximado (m) de la pierna: sirve para calcular cuánto inclinarla y que el pie no se despegue del suelo. */
const LEG_LENGTH_M = 0.9;

/** Fracción de la altura del modelo a la que corta el plano medio (medio muslo). */
const UPPER_CUT = 0.38;

/** Margen (m) sobre la cabeza en el encuadre. */
const HEADROOM_M = 0.45;
/** Margen máximo sobre la cabeza como fracción de la altura del modelo. */
const HEADROOM_RATIO = 0.3;

/** Cuánto de la rotación de cabeza se reparte entre cuello y cabeza. */
const NECK_SHARE = 0.4;
/** Separación (rad) que se da al brazo que cuelga bajo un clip para que la manga no atraviese el cuerpo. */
const SLEEVE_SPREAD = 0.32;
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
  private readonly gestures = new Gestures();
  private gestureFrame: GestureFrame = emptyFrame();
  /** Gestos que se lanzan solos en reposo (se puede apagar desde la consola). */
  autoGestures = true;
  private idleClock = 0;
  private nextIdleGesture = 6 + Math.random() * 10;
  /** Multiplica el tiempo entre gestos automáticos (menos = más a menudo). Ver `setGestureLevel`. */
  private gestureFactor = 1;
  /** Brazos fijados a mano para ajustar poses en vivo (solo desarrollo). */
  private held: { left?: ArmGesture; right?: ArmGesture } | null = null;
  private readonly qBody = new THREE.Quaternion();
  private readonly indicators = createIndicators(0.3);
  private readonly heart = createHeart();
  private readonly heartTips: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  /** Gestos de cara programados para el clip que suena (ver `clipFace`). */
  private faceFile: string | null = null;
  private faceLast = 0;
  private faceRuns: { name: string; next: number; at: number[]; every?: [number, number] }[] = [];
  private readonly expr = new Map<string, number>(MANAGED_EXPRESSIONS.map((n) => [n, 0]));

  private readonly clips: ClipLayer;
  private readonly hips: THREE.Object3D;
  private readonly hipsRestX: number;
  private readonly hipsRestY: number;
  private readonly bone: (name: VRMHumanBoneName) => THREE.Object3D | null;
  /** +1 si el brazo apunta hacia +X en T-pose, -1 si hacia -X (depende del modelo). */
  private readonly armDir: { left: number; right: number };
  /**
   * +1 si el frente del personaje es el +Z local de sus huesos, -1 si es el -Z (VRM 0.x: `rotateVRM0`
   * gira la escena media vuelta y los ejes X y Z locales quedan invertidos respecto al mundo). Las
   * poses se escriben para +1; con -1 se invierten los giros sobre X ("hacia delante") y los del codo.
   */
  private readonly fwd: number;
  private readonly headPos = new THREE.Vector3();
  private readonly headCenter = new THREE.Vector3();
  private readonly headLift = new THREE.Vector3(0, 0.08, 0);
  private readonly e = new THREE.Euler();
  private readonly qGaze = new THREE.Quaternion();
  private lastClipFile: string | null = null;
  private readonly qSleeve = new THREE.Quaternion();
  private readonly vSleeve = new THREE.Vector3();

  constructor(private readonly vrm: VRM) {
    this.root.add(vrm.scene, this.indicators.root, this.heart.root);
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
    this.hipsRestX = this.hips.position.x;
    this.hipsRestY = this.hips.position.y;

    // Dirección de cada brazo en T-pose, medida en el propio modelo. Se mide en el espacio local del
    // padre del brazo (el mismo en el que se aplican las rotaciones) y no en el del mundo: en los
    // VRM 0.x `rotateVRM0` gira la escena media vuelta, el eje X local queda invertido respecto al
    // mundo y los brazos se levantaban en lugar de bajar.
    vrm.scene.updateMatrixWorld(true);
    const side = (arm: VRMHumanBoneName, hand: VRMHumanBoneName) => {
      const armNode = this.bone(arm);
      const handNode = this.bone(hand);
      if (!armNode?.parent || !handNode) return 1;
      const a = armNode.parent.worldToLocal(armNode.getWorldPosition(new THREE.Vector3()));
      const h = armNode.parent.worldToLocal(handNode.getWorldPosition(new THREE.Vector3()));
      return h.x < a.x ? -1 : 1;
    };
    const front = new THREE.Vector3(0, 0, 1);
    const spine = this.bone("spine");
    if (spine?.parent) front.transformDirection(spine.parent.matrixWorld.clone().invert());
    this.fwd = front.z < 0 ? -1 : 1;
    this.armDir = {
      left: side("leftUpperArm", "leftHand"),
      right: side("rightUpperArm", "rightHand"),
    };

    // Encuadre: el modelo completo más margen arriba para brazos levantados, saltos e indicadores.
    const box = new THREE.Box3().setFromObject(vrm.scene);
    // El margen es proporcional a la altura con un tope: un modelo bajito (1,1 m) con 0,45 m fijos quedaba pequeño y abajo.
    const top = Math.min(HEADROOM_M, (box.max.y - box.min.y) * HEADROOM_RATIO);
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

  gesture(name: string) {
    return this.gestures.trigger(name);
  }

  /** Con qué frecuencia lanza gestos sola en reposo: "off" los apaga; los demás espacian más o menos el reloj. */
  /** Centro de la cabeza en el mundo: el hueso de la cabeza está en la base del cráneo, así que se sube un poco. */
  headPosition() {
    return this.headCenter.copy(this.headPos).add(this.headLift);
  }

  setGestureLevel(level: GestureLevel) {
    this.autoGestures = level !== "off";
    this.gestureFactor = { off: 1, pocos: 2.2, normal: 1, muchos: 0.45 }[level];
    this.nextIdleGesture = Math.min(this.nextIdleGesture, Math.max(5, (14 + Math.random() * 24) * this.gestureFactor));
  }

  listGestures() {
    return this.gestures.list();
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
    const gh = this.gestureFrame.head;
    const gp = this.gestureFrame.pose;
    const gazeYaw = p.headYaw + this.gaze.yaw * GAZE_HEAD_YAW + gh.yaw;
    const gazePitch = p.headPitch - this.gaze.pitch * GAZE_HEAD_PITCH + gh.pitch;
    const headRoll = p.headRoll + gh.roll;

    // Reparto del peso: la cadera se desplaza y sube hacia la pierna que carga; la otra se relaja.
    const w = p.weight;
    this.hips.position.x = this.hipsRestX + w * HIP_SHIFT_M;
    this.hips.position.y = this.hipsRestY + p.bodyY + gp.bodyY - Math.abs(w) * 0.006;
    this.hips.rotation.set(0, p.yaw, w * HIP_TILT);
    this.vrm.scene.scale.set(1 + p.squash * 0.5, 1 - p.squash, 1 + p.squash * 0.5);

    // La columna compensa la inclinación de la pelvis para que los hombros sigan nivelados.
    const lean = p.lean + gp.lean;
    const breath = p.breath + gp.breath;
    const sway = p.sway + gp.sway;
    this.rot("spine", lean * 0.45 - breath, 0, sway * 0.5 - w * HIP_TILT * 0.7);
    this.rot("chest", lean * 0.35 - breath * 1.4, 0, sway * 0.3 - w * HIP_TILT * 0.3);
    this.rot("upperChest", lean * 0.2, 0, sway * 0.2);
    this.rot("neck", gazePitch * NECK_SHARE, gazeYaw * NECK_SHARE, headRoll * NECK_SHARE);
    this.rot("head", gazePitch * HEAD_SHARE, gazeYaw * HEAD_SHARE, headRoll * HEAD_SHARE);

    this.leg("left", Math.max(0, -w), w);
    this.leg("right", Math.max(0, w), w);
    for (const side of SIDES) this.rot(`${side}Shoulder`, 0, 0, this.armDir[side] * (p.shoulders + gp.shoulders));

    this.arm("left", p.armLPitch, p.armLRoll, p.armLElbow);
    this.arm("right", p.armRPitch, p.armRRoll, p.armRElbow);
    this.fingers(p.curl);
  }

  /**
   * Pierna: la que no carga el peso lleva la rodilla algo doblada y el pie adelantado. Además se
   * contrarresta la inclinación y el desplazamiento de la pelvis (`w`) para que el pie quede
   * plantado en el suelo en lugar de columpiarse con la cadera.
   */
  private leg(side: "left" | "right", free: number, w: number) {
    this.rot(`${side}UpperLeg`, -0.1 * free, 0, -(w * HIP_TILT + (w * HIP_SHIFT_M) / LEG_LENGTH_M));
    this.rot(`${side}LowerLeg`, 0.18 * free, 0, 0);
    this.rot(`${side}Foot`, -0.08 * free, 0, 0);
  }

  /** Dedos sueltos: cada falange se dobla un poco hacia la palma. */
  private fingers(curl: number) {
    for (const side of SIDES) {
      const dir = this.armDir[side];
      for (const finger of FINGERS) {
        SEGMENTS.forEach((segment, i) => this.rot(fingerBone(side, finger, segment), 0, 0, -dir * curl * CURL_ANGLES[i]));
      }
    }
  }

  update(dt: number, time: number) {
    const em = this.vrm.expressionManager;

    // Capa de clips (Mixamo) sobre la pose procedural que acaba de aplicarse.
    this.gestureFrame = this.gestures.update(dt);
    this.accompanySpeech(time);
    this.scheduleIdleGesture(dt);
    this.gaze.hold = this.gestureFrame.look;
    this.clips.update(dt);
    this.clipFace();
    this.applyBody(this.held ?? this.gestureFrame.body);
    this.updateHeart(time);

    this.bone("head")?.getWorldPosition(this.headPos);
    this.gaze.update(dt, time, this.headPos);
    this.indicators.root.position.copy(this.headPos);
    const playing = this.clips.amount > 0.3 ? this.clips.playingFile : null;
    if (playing !== this.lastClipFile) this.indicators.setClip((this.lastClipFile = playing));
    this.indicators.update(time);

    if (em) {
      // Expresión de fondo según el estado.
      const goal = STATE_EXPRESSIONS[this.state];
      const k = 1 - Math.exp(-dt * 6);
      const ge = this.gestureFrame.exp; // un gesto puede subir una expresión, nunca bajarla
      for (const [name, cur] of this.expr) {
        const next = cur + ((goal[name] ?? 0) - cur) * k;
        this.expr.set(name, next);
        em.setValue(name, Math.max(next, ge[name] ?? 0));
      }
      em.setValue("blink", Math.max(this.blink.update(dt), ge.blink ?? 0));
      em.setValue("blinkLeft", ge.blinkLeft ?? 0); // guiños
      em.setValue("blinkRight", ge.blinkRight ?? 0);
      const mouth = this.lipsync.update(dt);
      for (const v of Object.keys(mouth) as (keyof typeof mouth)[]) em.setValue(v, Math.max(mouth[v], ge[v] ?? 0));
    }

    this.vrm.update(dt);
  }

  /**
   * Cara durante un clip. Los clips solo mueven cuerpo y cabeza, así que aquí se le suma la cara:
   * una expresión de fondo (`mood`, que entra y sale con el clip) y gestos de cara lanzados en
   * instantes fijos o al azar (`cues`), según el `face` del clip en `animations.json`.
   */
  private clipFace() {
    const file = this.clips.playingFile;
    const time = this.clips.playTime;
    const face = file ? this.clips.faceOf(file) : undefined;
    // Clip nuevo (o el mismo que vuelve a empezar): se reprograma desde cero.
    if (file !== this.faceFile || time < this.faceLast - 0.5) {
      this.faceFile = file;
      this.faceRuns = (face?.cues ?? []).map((c) => ({
        name: c.name,
        every: c.every,
        at: [...(c.at ?? [])].sort((a, b) => a - b),
        next: c.every ? time + c.every[0] + Math.random() * (c.every[1] - c.every[0]) : Infinity,
      }));
    }
    const prev = this.faceLast;
    this.faceLast = time;
    if (!face) return;

    const amount = this.clips.amount;
    const exp = this.gestureFrame.exp;
    for (const [name, v] of Object.entries(face.mood ?? {})) exp[name] = Math.max(exp[name] ?? 0, v * amount);

    if (this.clips.isFading || amount < 0.3) return;
    for (const run of this.faceRuns) {
      let fire = false;
      while (run.at.length > 0 && run.at[0] <= time) {
        // Un instante que ya quedó atrás (por ejemplo tras saltar en el clip) no se lanza tarde.
        if (run.at[0] > prev - 0.25) fire = true;
        run.at.shift();
      }
      if (run.every && time >= run.next) {
        fire = true;
        run.next = time + run.every[0] + Math.random() * (run.every[1] - run.every[0]);
      }
      if (fire && !this.gestures.busy) this.gestures.trigger(run.name);
    }
  }

  /** Corazón rojo sobre la mano del corazón coreano. */
  private updateHeart(time: number) {
    const { w, side } = this.gestureFrame.heart;
    if (w < 0.01) {
      this.heart.update(0, null, time);
      return;
    }
    const a = this.bone(`${side}IndexDistal`);
    const b = this.bone(`${side}ThumbDistal`);
    if (!a || !b) return this.heart.update(0, null, time);
    a.getWorldPosition(this.heartTips[0]);
    b.getWorldPosition(this.heartTips[1]);
    this.heart.update(w, this.heartTips, time);
  }

  /** Al hablar, la cabeza acompaña al habla con pequeños cabeceos. */
  private accompanySpeech(time: number) {
    const talk = this.lipsync.energy;
    if (talk < 0.02) return;
    const h = this.gestureFrame.head;
    h.pitch += talk * 0.09 * Math.sin(time * 6.1);
    h.yaw += talk * 0.06 * Math.sin(time * 2.3 + 1);
    h.roll += talk * 0.04 * Math.sin(time * 3.1);
  }

  /**
   * En reposo, y solo mientras no suene ningún clip, lanza de vez en cuando un gesto al azar
   * (sonrisa, suspiro, bostezo, corazón coreano...). El reloj solo corre en esos ratos, así que
   * los gestos quedan muy espaciados.
   */
  private scheduleIdleGesture(dt: number) {
    if (!this.autoGestures || this.state !== "idle" || this.clips.amount > 0.05 || this.gestures.busy) return;
    this.idleClock += dt;
    if (this.idleClock < this.nextIdleGesture) return;
    this.idleClock = 0;
    this.nextIdleGesture = Math.max(5, (14 + Math.random() * 24) * this.gestureFactor);
    let r = Math.random() * IDLE_GESTURES.reduce((s, g) => s + g.weight, 0);
    const pick = IDLE_GESTURES.find((g) => (r -= g.weight) < 0) ?? IDLE_GESTURES[0];
    this.gestures.trigger(pick.name);
  }

  /**
   * Brazos y manos de un gesto, mezclados sobre lo que ya tengan los huesos (pose procedural o
   * clip) según el peso del gesto. Las poses están definidas para el brazo derecho; al izquierdo
   * se reflejan (las rotaciones en Y y Z cambian de signo).
   */
  private applyBody(body: { left?: ArmGesture; right?: ArmGesture }) {
    for (const side of SIDES) {
      const g = body[side];
      if (!g || g.w < 0.001) continue;
      const dir = this.armDir[side];
      const mirror = side === "left" ? -1 : 1;
      // Cada parte del brazo tiene su propio peso para que lleguen en cascada (hombro → codo → muñeca → dedos).
      const blend = (name: VRMHumanBoneName, weight: number, order: THREE.EulerOrder = "XYZ") => {
        if (weight < 0.001) return;
        this.e.order = order;
        this.bone(name)?.quaternion.slerp(this.qBody.setFromEuler(this.e), Math.min(1, weight));
        this.e.order = "XYZ";
      };

      const f = this.fwd;
      this.e.set(-g.pitch * f, (g.uTwist ?? 0) * mirror, -dir * (Math.PI / 2 - g.roll));
      blend(`${side}UpperArm`, g.w);
      // Antebrazo: primero el giro sobre su eje (twist) y luego el codo.
      this.e.set((g.twist ?? 0) * f, -dir * f * g.elbow, 0);
      blend(`${side}LowerArm`, g.we ?? g.w, "YXZ");
      if (g.wrist) {
        this.e.set(g.wrist[0] * f, g.wrist[1] * mirror, -dir * g.wrist[2]);
        blend(`${side}Hand`, g.wh ?? g.w);
      }
      for (const [key, [x, y, z]] of Object.entries(g.fingers ?? {})) {
        this.e.set(x * f, y * mirror, -dir * z);
        blend(`${side}${key}` as VRMHumanBoneName, key.startsWith("Thumb") ? (g.wt ?? g.wf ?? g.w) : (g.wf ?? g.w));
      }
    }
  }

  /** Solo desarrollo: fija los brazos a una pose (peso 1) para ajustarla en vivo; `null` la suelta. */
  holdBody(spec: { left?: Omit<ArmGesture, "w">; right?: Omit<ArmGesture, "w"> } | null) {
    this.held = spec
      ? { left: spec.left && { ...spec.left, w: 1 }, right: spec.right && { ...spec.right, w: 1 } }
      : null;
  }

  /**
   * Bajo un clip la cabeza la dicta el clip; se le suma el giro hacia donde mira, en la parte
   * que la pose procedural ya no aporta (así la cabeza sigue acompañando a la mirada).
   */
  private followGazeOverClip() {
    const amount = this.clips.amount;
    if (amount < 0.01) return;
    const gh = this.gestureFrame.head;
    const yaw = (this.gaze.yaw * GAZE_HEAD_YAW + gh.yaw) * amount;
    const pitch = (-this.gaze.pitch * GAZE_HEAD_PITCH + gh.pitch) * amount;
    const roll = gh.roll * amount;
    for (const [name, share] of [["neck", NECK_SHARE], ["head", HEAD_SHARE]] as const) {
      this.e.set(pitch * share, yaw * share, roll * share, "XYZ");
      this.bone(name)?.quaternion.multiply(this.qGaze.setFromEuler(this.e));
    }
    this.clearSleeves(amount);
  }

  /**
   * Los clips de Mixamo llevan los brazos pegados al cuerpo (su esqueleto es más delgado que el de
   * este modelo) y la manga atraviesa la cintura y las piernas. Si el brazo cuelga, se separa un poco
   * del cuerpo; cuanto más levantado está, menos se corrige, y se aleja un poco más el codo.
   */
  private clearSleeves(amount: number) {
    for (const side of SIDES) {
      const dir = this.armDir[side];
      const upper = this.bone(`${side}UpperArm`);
      if (!upper) continue;
      // Cuánto cuelga el brazo (1 = vertical hacia abajo), según su rotación actual desde la T-pose.
      this.qSleeve.copy(upper.quaternion);
      const down = -this.vSleeve.set(dir, 0, 0).applyQuaternion(this.qSleeve).y;
      const k = Math.min(1, Math.max(0, (down - 0.6) / 0.3)) * amount;
      if (k < 0.001) continue;
      // Abducción en el espacio del padre (el eje Z del hombro): mismo sentido que `roll` en `arm()`.
      this.e.set(0, 0, dir * SLEEVE_SPREAD * k, "XYZ");
      upper.quaternion.premultiply(this.qSleeve.setFromEuler(this.e));
    }
  }

  /** Rotación (Euler XYZ) de un hueso normalizado; ignora los que el modelo no tenga. */
  private rot(name: VRMHumanBoneName, x: number, y: number, z: number) {
    this.bone(name)?.rotation.set(x * this.fwd, y, z);
  }

  /**
   * Brazo desde la T-pose del VRM: roll 0 = colgando, π/2 = horizontal, π = vertical;
   * pitch = balanceo hacia delante; elbow = flexión del antebrazo (0 = estirado).
   */
  private arm(side: "left" | "right", pitch: number, roll: number, elbow: number) {
    const dir = this.armDir[side];
    this.e.set(-pitch * this.fwd, 0, -dir * (Math.PI / 2 - roll), "XYZ");
    this.bone(`${side}UpperArm`)?.quaternion.setFromEuler(this.e);

    this.e.set(0, -dir * this.fwd * elbow, 0, "XYZ");
    this.bone(`${side}LowerArm`)?.quaternion.setFromEuler(this.e);
  }
}
