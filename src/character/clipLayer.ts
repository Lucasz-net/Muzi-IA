import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { CompanionState } from "../core/stateMachine";
import { VariantPicker, type Variant } from "./variantPicker";

/** Un gesto de cara que se lanza mientras suena un clip: en instantes fijos (`at`) y/o cada cierto tiempo al azar (`every`). */
export interface FaceCue {
  /** Nombre de un gesto de `gestures.ts` (de cara y cabeza: wink, smile, laugh, shy, surprised...). */
  name: string;
  /** Segundos de clip en los que se lanza. */
  at?: number[];
  /** [mín, máx] segundos entre lanzamientos al azar (el primero cuenta desde que arranca el clip). */
  every?: [number, number];
}

/** Cara del personaje mientras suena un clip: una expresión de fondo y gestos que se lanzan por encima. */
export interface FaceConfig {
  /** Expresiones VRM de fondo mientras suena el clip (por ejemplo `{ "happy": 0.4 }`). */
  mood?: Record<string, number>;
  cues?: FaceCue[];
}

export interface ClipEntry {
  /** Estado que dispara el clip; `null` = solo se carga para reproducirlo a mano. */
  state: CompanionState | null;
  /** Nombre del archivo (clave para reproducirlo a mano en desarrollo). */
  file: string;
  url: string;
  loop: boolean;
  /** Probabilidad relativa frente a otras variantes del mismo estado (por defecto 1). */
  weight?: number;
  /** Segundos mínimos antes de que este clip pueda volver a salir (en estados con variantes). */
  cooldown?: number;
  /** Descanso (s, mínimo y máximo al azar) con la pose procedural tras acabar este clip, antes del siguiente. */
  gap?: [number, number];
  /** El estado de este clip se declaró como lista de variantes en `animations.json`. */
  variants?: boolean;
  /** Expresiones y gestos de cara que acompañan al clip. */
  face?: FaceConfig;
}

interface Driven {
  node: THREE.Object3D;
  kind: "rotation" | "position";
  /** La pose procedural ya gobierna este hueso; si no, el clip parte del reposo. */
  owned: boolean;
  /** Intérprete de la pista: da el valor del clip en un instante. */
  sample: THREE.Interpolant;
  baseQ: THREE.Quaternion;
  baseP: THREE.Vector3;
}

interface Loaded {
  clip: THREE.AnimationClip;
  loop: boolean;
  weight: number;
  cooldown: number;
  gap?: [number, number];
  face?: FaceConfig;
  driven: Driven[];
}

/** Duración (s) de la transición entre la pose procedural y un clip, o entre dos clips. */
const FADE_S = 0.55;
/** Descanso por defecto entre dos clips de un estado con variantes (reposo), en segundos. */
const DEFAULT_GAP_S: [number, number] = [12, 30];
/** Respiro al entrar en un estado con variantes antes del primer clip, en segundos. */
const ENTER_DELAY_S: [number, number] = [3, 8];
/** Enfriamiento por defecto de una variante que no declara el suyo, en segundos. */
const DEFAULT_COOLDOWN_S = 90;
/** Si en un momento dado ningún clip está disponible, se reintenta pasado este tiempo (s). */
const RETRY_S = 6;
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
/** Suavizado de entrada y salida: velocidad cero al empezar y al acabar. */
const smooth = (x: number) => x * x * (3 - 2 * x);
const IDENTITY = new THREE.Quaternion();

/**
 * Reproduce clips (Mixamo) sobre la pose procedural, mezclándolos con un factor que sube y baja
 * suavemente: así la entrada y la salida fluyen desde y hacia la pose procedural viva.
 *
 * Las pistas se evalúan aquí con sus intérpretes en lugar de usar un `AnimationMixer`: éste solo
 * reescribe un hueso cuando su valor cambia respecto al fotograma anterior, y como esta capa
 * parte cada fotograma de una base limpia, los huesos que el clip deja quietos (manos, pies)
 * volvían a la T-pose. Evaluando directamente no hay estado oculto que se desincronice.
 *
 * Orden por fotograma: pose procedural -> `update()` de esta capa -> `vrm.update()`.
 */
export class ClipLayer {
  private readonly clips = new Map<string, Loaded>();
  /** Clips de cada estado; con más de uno, se alternan al azar al terminar cada uno (variantes). */
  private readonly byState = new Map<CompanionState, string[]>();
  /** Estados declarados con lista de variantes: entre clip y clip descansan con la pose procedural. */
  private readonly variantStates = new Set<CompanionState>();
  private clock = 0;
  /** Instante (en `clock`) en que acaba el descanso y toca elegir el siguiente clip. */
  private waitUntil: number | null = null;
  /** Un selector por estado con variantes: recuerda qué salió y cuándo para variar y espaciar. */
  private readonly pickers = new Map<CompanionState, VariantPicker>();

  private current: string | null = null;
  private time = 0;
  private ended = false; // un clip de una sola vez llegó a su fin
  private pending: string | null | undefined; // undefined = sin cambios; null = parar
  private target = 0;
  /** Progreso lineal de la transición (0..1); lo que se aplica es `blend` = smooth(progress). */
  private progress = 0;
  private blend = 0;
  private override: string | null | undefined; // reproducción manual (desarrollo)
  private state: CompanionState = "idle";
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  /** Lo último que se mostró en cada hueso: punto de partida al pasar de un clip a otro. */
  private readonly lastOut = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /** Mientras es true, la capa base es lo último mostrado (clip -> clip) y no la pose procedural. */
  private fromLast = false;
  /** Se llama tras mezclar y antes de anotar lo mostrado: permite sumar ajustes (mirada) sin romper la continuidad. */
  afterMix: (() => void) | null = null;

  /** @param owned Huesos que la pose procedural escribe cada fotograma. */
  constructor(
    private readonly vrm: VRM,
    private readonly owned: Set<THREE.Object3D>,
  ) {}

  register(entry: ClipEntry, clip: THREE.AnimationClip) {
    const driven: Driven[] = [];
    for (const track of clip.tracks) {
      const [nodeName, property] = track.name.split(".");
      const node = this.vrm.scene.getObjectByName(nodeName);
      if (!node) continue;
      driven.push({
        node,
        kind: property === "position" ? "position" : "rotation",
        owned: this.owned.has(node),
        // `createInterpolant` existe en tiempo de ejecución pero no figura en los tipos de three.
        sample: (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant(),
        baseQ: new THREE.Quaternion(),
        baseP: new THREE.Vector3(),
      });
    }
    this.clips.set(entry.file, {
      clip,
      loop: entry.loop,
      weight: entry.weight ?? 1,
      cooldown: entry.cooldown ?? DEFAULT_COOLDOWN_S,
      gap: entry.gap,
      face: entry.face,
      driven,
    });
    if (entry.state) {
      const list = this.byState.get(entry.state) ?? [];
      if (!list.includes(entry.file)) list.push(entry.file);
      this.byState.set(entry.state, list);
      if (entry.variants) this.variantStates.add(entry.state);
    }
    // Si ya estamos en un estado con clip y aún no suena (ni se espera) ninguno, arranca el estado.
    if (!this.current && this.override === undefined && this.waitUntil === null) this.enter(this.state);
  }

  /**
   * Entra en un estado. Los de variantes (reposo) empiezan con un respiro en la pose procedural y
   * luego un clip al azar; los de un solo clip lo reproducen enseguida.
   */
  private enter(state: CompanionState) {
    this.waitUntil = null;
    if (this.variantStates.has(state)) {
      this.pending = null; // apaga el clip anterior, si lo hay
      this.waitUntil = this.clock + rand(ENTER_DELAY_S);
    } else this.pending = this.pickFor(state);
  }

  /** Cuánto del clip se está mostrando ahora (0 = nada, 1 = todo). */
  get amount() {
    return this.blend;
  }

  /** Clip que está sonando (también mientras se apaga), o `null`. */
  get playingFile() {
    return this.current;
  }

  /** Segundos transcurridos del clip actual. */
  get playTime() {
    return this.time;
  }

  /** El clip actual se está apagando (ya no debe lanzar gestos nuevos). */
  get isFading() {
    return this.target === 0;
  }

  /** Cara configurada para un clip. */
  faceOf(file: string) {
    return this.clips.get(file)?.face;
  }

  /** Nombres de los clips cargados. */
  names() {
    return [...this.clips.keys()];
  }

  has(file: string) {
    return this.clips.has(file);
  }

  /** Salta a un instante del clip actual (depuración). */
  seek(seconds: number) {
    this.time = seconds;
    this.ended = false;
  }

  setState(state: CompanionState) {
    this.state = state;
    if (this.override === undefined) this.enter(state);
  }

  /** Reproduce un clip a mano (`null` = parar; `undefined` = volver al comportamiento por estado). */
  force(file: string | null | undefined) {
    this.override = file;
    this.waitUntil = null;
    if (file === undefined) this.enter(this.state);
    else this.pending = file;
  }

  /**
   * Clip que toca en un estado, o `null` si no hay ninguno disponible ahora. Los estados con
   * variantes (reposo) usan el selector, que espacia y varía; los demás, un sorteo por peso.
   */
  private pickFor(state: CompanionState): string | null {
    const list = this.byState.get(state);
    if (!list || list.length === 0) return null;
    const variants: Variant[] = list.map((file) => {
      const c = this.clips.get(file)!;
      return { file, weight: c.weight, cooldown: c.cooldown };
    });
    if (this.variantStates.has(state)) {
      let picker = this.pickers.get(state);
      if (!picker) this.pickers.set(state, (picker = new VariantPicker()));
      return picker.pick(variants, this.clock);
    }
    let r = Math.random() * variants.reduce((s, v) => s + v.weight, 0);
    return (variants.find((v) => (r -= v.weight) < 0) ?? variants[0]).file;
  }

  update(dt: number) {
    this.clock += dt;
    if (this.waitUntil !== null && this.clock >= this.waitUntil && this.override === undefined) {
      const next = this.pickFor(this.state);
      if (next === null) this.waitUntil = this.clock + RETRY_S; // ninguno disponible: reintenta enseguida
      else {
        this.waitUntil = null; // acabó el descanso: toca el siguiente clip
        this.pending = next;
      }
    }
    if (this.pending !== undefined) {
      const next = this.pending;
      this.pending = undefined;
      if (next === null) this.target = 0;
      else if (next === this.current) {
        this.target = 1; // vuelve al mismo clip que se estaba apagando: lo retoma donde iba
        if (this.ended) this.seek(0);
      } else this.begin(next);
    }
    if (!this.current) return;
    const loaded = this.clips.get(this.current)!;

    // 1) Capa base: la pose procedural de este fotograma (lo que ella no gobierna parte del reposo)
    //    o, al pasar de un clip a otro, lo último que se mostró.
    for (const d of loaded.driven) {
      const prev = this.fromLast ? this.lastOut.get(d.node) : undefined;
      if (d.kind === "rotation") d.baseQ.copy(prev ? prev.q : d.owned ? d.node.quaternion : IDENTITY);
      else d.baseP.copy(prev ? prev.p : d.node.position);
    }

    const step = dt / FADE_S;
    this.progress =
      this.target > this.progress
        ? Math.min(this.target, this.progress + step)
        : Math.max(this.target, this.progress - step);
    this.blend = smooth(this.progress);

    if (this.target === 0 && this.progress <= 0) {
      // Terminó la salida: dejar los huesos como los dejó la pose procedural.
      this.current = null;
      this.blend = 0;
      this.progress = 0;
      for (const d of loaded.driven) {
        if (d.kind === "rotation") d.node.quaternion.copy(d.baseQ);
        else d.node.position.copy(d.baseP);
      }
      return;
    }

    // 2) Avance del tiempo del clip.
    const duration = loaded.clip.duration;
    this.time += dt;
    if (loaded.loop) this.time %= duration;
    else if (this.time >= duration) {
      this.time = duration; // se queda en el último fotograma
      if (!this.ended) {
        this.ended = true;
        this.onEnded();
      }
    }

    // 3) Mezcla clip <-> base.
    for (const d of loaded.driven) {
      const value = d.sample.evaluate(this.time);
      if (d.kind === "rotation") {
        this.tmpQ.fromArray(value as ArrayLike<number>);
        d.node.quaternion.copy(d.baseQ).slerp(this.tmpQ, this.blend);
      } else {
        this.tmpV.fromArray(value as ArrayLike<number>);
        d.node.position.lerpVectors(d.baseP, this.tmpV, this.blend);
      }
    }
    this.afterMix?.();

    // 4) Se anota lo mostrado (ya con los ajustes) para una posible transición a otro clip.
    for (const d of loaded.driven) {
      let out = this.lastOut.get(d.node);
      if (!out) this.lastOut.set(d.node, (out = { q: new THREE.Quaternion(), p: new THREE.Vector3() }));
      out.q.copy(d.node.quaternion);
      out.p.copy(d.node.position);
    }
    if (this.fromLast && this.progress >= 1) this.fromLast = false;
  }

  /**
   * Un clip de una sola vez terminó y vuelve a la pose procedural. En un estado con variantes
   * (reposo) se queda descansando un rato al azar antes del siguiente clip.
   */
  private onEnded() {
    const current = this.current;
    this.target = 0;
    if (this.override === undefined && current && this.variantStates.has(this.state) && this.byState.get(this.state)?.includes(current)) {
      this.waitUntil = this.clock + rand(this.clips.get(current)?.gap ?? DEFAULT_GAP_S);
    }
  }

  private begin(file: string) {
    if (!this.clips.has(file)) return;
    // Clip -> clip: la transición parte de lo que se está mostrando, no de la pose procedural.
    this.fromLast = this.current !== null && this.blend > 0.02;
    this.current = file;
    this.time = 0;
    this.ended = false;
    this.target = 1;
    this.progress = 0;
    this.blend = 0;
  }
}
