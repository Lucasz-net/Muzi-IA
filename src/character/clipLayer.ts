import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { CompanionState } from "../core/stateMachine";

export interface ClipEntry {
  /** Estado que dispara el clip; `null` = solo se carga para reproducirlo a mano. */
  state: CompanionState | null;
  /** Nombre del archivo (clave para reproducirlo a mano en desarrollo). */
  file: string;
  url: string;
  loop: boolean;
  /** Probabilidad relativa frente a otras variantes del mismo estado (por defecto 1). */
  weight?: number;
}

interface Driven {
  node: THREE.Object3D;
  kind: "rotation" | "position";
  /** La pose procedural ya gobierna este hueso; si no, el clip parte del reposo. */
  owned: boolean;
  baseQ: THREE.Quaternion;
  baseP: THREE.Vector3;
}

interface Loaded {
  clip: THREE.AnimationClip;
  loop: boolean;
  weight: number;
  driven: Driven[];
}

/** Duración (s) de la transición entre la pose procedural y un clip, o entre dos clips. */
const FADE_S = 0.55;
/** Suavizado de entrada y salida: velocidad cero al empezar y al acabar. */
const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Reproduce clips (Mixamo) sobre la pose procedural. El mixer escribe el clip a peso completo
 * y aquí se mezcla con la pose base (`slerp`) con un factor que sube y baja suavemente: así
 * la entrada y la salida fluyen desde y hacia la pose procedural viva.
 *
 * Orden por fotograma: pose procedural -> `update()` de esta capa -> `vrm.update()`.
 */
export class ClipLayer {
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, Loaded>();
  /** Clips de cada estado; con más de uno, se alternan al azar al terminar cada uno (variantes). */
  private readonly byState = new Map<CompanionState, string[]>();

  private current: string | null = null;
  private action: THREE.AnimationAction | null = null;
  private pending: string | null | undefined; // undefined = sin cambios; null = parar
  private target = 0;
  /** Progreso lineal de la transición (0..1); lo que se aplica es `blend` = smooth(progress). */
  private progress = 0;
  private blend = 0;
  private override: string | null | undefined; // reproducción manual (desarrollo)
  private state: CompanionState = "idle";
  private readonly tmpQ = new THREE.Quaternion();
  /** Lo último que se mostró en cada hueso: punto de partida al pasar de un clip a otro. */
  private readonly lastOut = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /** Se llama tras mezclar y antes de anotar lo mostrado: permite sumar ajustes (mirada) sin romper la continuidad. */
  afterMix: (() => void) | null = null;
  /** Mientras es true, la capa base es lo último mostrado (clip -> clip) y no la pose procedural. */
  private fromLast = false;

  /** @param owned Huesos que la pose procedural escribe cada fotograma. */
  constructor(
    private readonly vrm: VRM,
    private readonly owned: Set<THREE.Object3D>,
  ) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.mixer.addEventListener("finished", () => {
      const variants = this.byState.get(this.state);
      if (this.override === undefined && this.current && variants && variants.length > 1 && variants.includes(this.current)) {
        this.pending = this.pickFor(this.state, this.current); // siguiente variante, enlazada con un fundido
      } else this.target = 0; // clip de una sola vez: al acabar vuelve a la pose procedural
    });
  }

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
        baseQ: new THREE.Quaternion(),
        baseP: new THREE.Vector3(),
      });
    }
    this.clips.set(entry.file, { clip, loop: entry.loop, weight: entry.weight ?? 1, driven });
    if (entry.state) {
      const list = this.byState.get(entry.state) ?? [];
      if (!list.includes(entry.file)) list.push(entry.file);
      this.byState.set(entry.state, list);
    }
    // Si ya estamos en un estado con clip y aún no suena ninguno, empieza ahora.
    if (!this.current && this.override === undefined) this.pending = this.pickFor(this.state);
  }

  /** Nombres de los clips cargados. */
  names() {
    return [...this.clips.keys()];
  }

  private pickFor(state: CompanionState, exclude?: string | null): string | null {
    const list = this.byState.get(state);
    if (!list || list.length === 0) return null;
    const options = list.length > 1 && exclude ? list.filter((f) => f !== exclude) : list;
    // Sorteo ponderado por el peso de cada variante.
    const weight = (f: string) => this.clips.get(f)?.weight ?? 1;
    let r = Math.random() * options.reduce((s, f) => s + weight(f), 0);
    return options.find((f) => (r -= weight(f)) < 0) ?? options[0];
  }

  /** Cuánto del clip se está mostrando ahora (0 = nada, 1 = todo). */
  get amount() {
    return this.blend;
  }

  has(file: string) {
    return this.clips.has(file);
  }

  setState(state: CompanionState) {
    this.state = state;
    if (this.override === undefined) this.pending = this.pickFor(state);
  }

  /** Reproduce un clip a mano (`null` = parar; `undefined` = volver al comportamiento por estado). */
  force(file: string | null | undefined) {
    this.override = file;
    this.pending = file === undefined ? this.pickFor(this.state) : file;
  }

  update(dt: number) {
    if (this.pending !== undefined) {
      const next = this.pending;
      this.pending = undefined;
      if (next === null) this.target = 0;
      else if (next === this.current && this.action) {
        this.target = 1; // vuelve al mismo clip que se estaba apagando: lo retoma donde iba
        if (!this.action.isRunning()) this.action.reset().play();
      } else this.begin(next);
    }
    if (!this.action || !this.current) return;
    const loaded = this.clips.get(this.current)!;

    // 1) Capa base: la pose procedural de este fotograma (lo que ella no gobierna parte del reposo)
    //    o, al pasar de un clip a otro, lo último que se mostró.
    for (const d of loaded.driven) {
      const prev = this.fromLast ? this.lastOut.get(d.node) : undefined;
      if (d.kind === "rotation") {
        if (!d.owned && !prev) d.node.quaternion.identity();
        d.baseQ.copy(prev ? prev.q : d.node.quaternion);
      } else d.baseP.copy(prev ? prev.p : d.node.position);
    }

    const step = dt / FADE_S;
    this.progress = this.target > this.progress ? Math.min(this.target, this.progress + step) : Math.max(this.target, this.progress - step);
    this.blend = smooth(this.progress);

    if (this.target === 0 && this.progress <= 0) {
      // Terminó la salida: parar y dejar los huesos como los dejó la pose procedural.
      this.action.stop();
      this.action = null;
      this.current = null;
      this.blend = 0;
      this.progress = 0;
      this.restoreBase(loaded);
      return;
    }

    // 2) El mixer escribe el clip a peso completo en los huesos.
    this.mixer.update(dt);

    // 3) Mezcla clip <-> base.
    for (const d of loaded.driven) {
      if (d.kind === "rotation") {
        this.tmpQ.copy(d.node.quaternion);
        d.node.quaternion.copy(d.baseQ).slerp(this.tmpQ, this.blend);
      } else d.node.position.lerpVectors(d.baseP, d.node.position, this.blend);
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

  private begin(file: string) {
    const loaded = this.clips.get(file);
    if (!loaded) return;
    // Clip -> clip: la transición parte de lo que se está mostrando, no de la pose procedural.
    this.fromLast = this.action !== null && this.blend > 0.02;
    this.action?.stop();
    const action = this.mixer.clipAction(loaded.clip);
    action.reset();
    action.setLoop(loaded.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    this.action = action;
    this.current = file;
    this.target = 1;
    this.progress = 0;
    this.blend = 0;
  }

  private restoreBase(loaded: Loaded) {
    for (const d of loaded.driven) {
      if (d.kind === "rotation") d.node.quaternion.copy(d.baseQ);
      else d.node.position.copy(d.baseP);
    }
  }
}
