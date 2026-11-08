/**
 * Gestos hechos con código, sin ningún clip. Mezclan:
 *  - expresiones faciales del VRM (guiño, sonrisa, bostezo...),
 *  - movimientos de cabeza, hombros y torso,
 *  - hacia dónde mira,
 *  - brazos, muñecas y cada falange de los dedos (corazón coreano, saludo, paz...).
 * Se suman a lo que ya estén haciendo el estado, la mirada y los clips.
 *
 * Los gestos de brazo se definen una sola vez para el brazo DERECHO del personaje; si les toca el
 * izquierdo se reflejan solos (ver `VrmCharacter.applyBody`).
 */
export type HeadOffset = { pitch: number; yaw: number; roll: number };
export type Euler3 = [number, number, number];
/** Rotación local (x, y, z en radianes) de cada hueso de la mano, por nombre sin el lado: "IndexProximal", "ThumbDistal"... */
export type FingerSpec = Record<string, Euler3>;

/** Brazo de un gesto. `pitch`/`roll`/`elbow` como en `Pose`; `twist` gira el antebrazo sobre su eje. */
export interface ArmGesture {
  pitch: number;
  roll: number;
  elbow: number;
  twist?: number;
  /** Giro del brazo entero sobre su propio eje (hombro): orienta hacia dónde dobla el codo (+ = el antebrazo se cierra hacia el pecho). */
  uTwist?: number;
  wrist?: Euler3;
  fingers?: FingerSpec;
  /** Cuánto se impone el gesto sobre lo que esté haciendo el brazo (0..1). Es el peso del brazo; el máximo de todos. */
  w: number;
  /** Pesos propios del antebrazo, la mano, los dedos y el pulgar (por defecto, `w`): así cada articulación llega con su retardo. */
  we?: number;
  wh?: number;
  wf?: number;
  wt?: number;
}

/** Ajustes aditivos del torso. */
export interface PoseOffset {
  lean?: number;
  shoulders?: number;
  breath?: number;
  bodyY?: number;
  sway?: number;
}

export interface GestureFrame {
  /** Peso (0..1) de cada expresión VRM que el gesto pide. */
  exp: Record<string, number>;
  head: HeadOffset;
  pose: Required<PoseOffset>;
  /** Mirada impuesta (coordenadas normalizadas como `Gaze`) con su peso. */
  look: { x: number; y: number; w: number };
  /** Brazos del personaje: lo que pida el gesto, ya asignado a un lado. */
  body: { left?: ArmGesture; right?: ArmGesture };
  /** Corazón flotante sobre la mano (corazón coreano): cuánto se ve (0..1) y de qué mano sale. */
  heart: { w: number; side: "left" | "right" };
}

interface Result {
  exp?: Record<string, number>;
  head?: Partial<HeadOffset>;
  pose?: PoseOffset;
  look?: { x: number; y: number; w: number };
  /** Un brazo (el del lado que toque; las definiciones son del derecho). */
  arm?: ArmGesture;
  /** Los dos brazos, reflejados. */
  arms?: ArmGesture;
  /** El brazo contrario al de `arm`, con su propia pose (para que los dos no se muevan idénticos). */
  other?: ArmGesture;
  /** Corazón flotante sobre la mano de `arm` (0..1). */
  heart?: number;
}

interface Def {
  duration: number;
  /** Estado del gesto en el instante `t` (s). `side` = +1 izquierda / -1 derecha del personaje. */
  at(t: number, side: number): Result;
}

/** Sube en `up` s, se mantiene `hold` s y baja en `down` s. Devuelve 0..1. */
function env(t: number, up: number, hold: number, down: number) {
  if (t < 0) return 0;
  if (t < up) return smooth(t / up);
  if (t < up + hold) return 1;
  const k = (t - up - hold) / down;
  return k < 1 ? smooth(1 - k) : 0;
}
const smooth = (x: number) => x * x * (3 - 2 * x);
/** Oscilación con entrada y salida suaves (para asentir / negar). */
const wave = (t: number, d: number, hz: number) => Math.sin(t * Math.PI * 2 * hz) * Math.sin((Math.PI * t) / d);

/** Progreso 0..1 suavizado entre dos instantes. */
const ph = (t: number, a: number, b: number) => smooth(Math.min(1, Math.max(0, (t - a) / (b - a))));
/** Valor que parte de `start` y va pasando por etapas: cada una lleva el valor hasta su meta según su progreso. */
const chain = (start: number, steps: [number, number][]) => {
  let value = start;
  let prev = start;
  for (const [p, end] of steps) {
    value += (end - prev) * p;
    prev = end;
  }
  return value;
};

/** Subida que arranca decidida y se frena al llegar (menos mecánica que una S simétrica). */
const rise = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return 0.35 * smooth(c) + 0.65 * (1 - (1 - c) ** 3);
};
const fall = (x: number) => smooth(Math.min(1, Math.max(0, x)));

/** Pesos de un brazo con todas sus articulaciones en cascada. */
interface Limb {
  w: number;
  we: number;
  wh: number;
  wf: number;
  wt: number;
}
/**
 * Un brazo que sube en `up` s, se mantiene `hold` s y baja en `down` s, con cada articulación
 * desfasada: al subir va primero el brazo, luego el codo, la muñeca, los dedos y por último el
 * pulgar; al bajar se sueltan primero los dedos y el brazo cae el último (por eso un gesto dura
 * ~0,4 s más que `up + hold + down`).
 */
function limb(t: number, up: number, hold: number, down: number): Limb {
  const tf = up + hold;
  const part = (rs: number, fs: number) => rise((t - rs) / up) * (1 - fall((t - tf - fs) / down));
  return { w: part(0, 0.26), we: part(0.07, 0.18), wh: part(0.14, 0.12), wf: part(0.22, 0.05), wt: part(0.32, 0) };
}
/** Deriva lenta y irregular en [-1, 1]: lo que mueve un brazo que se mantiene en el aire sin estar congelado. */
const drift = (t: number, seed: number) => Math.sin(t * 1.7 + seed * 3.1) * 0.6 + Math.sin(t * 2.9 + seed * 7.3) * 0.4;
/** Pequeño rebote amortiguado tras llegar a la pose (en el instante `ta`). */
const settle = (t: number, ta: number) => (t < ta ? 0 : Math.exp(-4.5 * (t - ta)) * Math.sin(11 * (t - ta)));

const wink = (t: number, side: number): Result => {
  const closed = env(t, 0.1, 0.32, 0.16);
  return {
    exp: { [side > 0 ? "blinkLeft" : "blinkRight"]: closed, happy: 0.55 * env(t, 0.2, 0.4, 0.3) },
    head: { roll: side * -0.1 * closed, pitch: 0.02 * closed },
  };
};

// ---------------------------------------------------------------------------------------------
// Poses de mano (brazo derecho). Cada falange: [x, y, z]; z positivo = doblar hacia la palma.
// ---------------------------------------------------------------------------------------------

/** Puño: los cuatro dedos largos cerrados. */
const FIST: FingerSpec = {
  IndexProximal: [0, 0, 1.4], IndexIntermediate: [0, 0, 1.6], IndexDistal: [0, 0, 1.0],
  MiddleProximal: [0, 0, 1.5], MiddleIntermediate: [0, 0, 1.6], MiddleDistal: [0, 0, 1.0],
  RingProximal: [0, 0, 1.5], RingIntermediate: [0, 0, 1.6], RingDistal: [0, 0, 1.0],
  LittleProximal: [0, 0, 1.5], LittleIntermediate: [0, 0, 1.6], LittleDistal: [0, 0, 1.0],
};
/**
 * Corazón coreano: el índice, en gancho, y el pulgar, casi recto hacia arriba, se cruzan en X por la
 * mitad de sus últimos tramos (~90° entre ellos), y el resto de dedos van cerrados. Los ángulos
 * salen de una búsqueda numérica sobre este modelo (cruce a 1 mm, mano con los dedos hacia arriba) y
 * se revisaron mirando la mano de cerca; la muñeca y el antebrazo van en el gesto (`fingerHeart`).
 * Con otro VRM los ejes del pulgar cambian y hay que repetir la búsqueda.
 */
const FINGER_HEART: FingerSpec = {
  // Los tres dedos cerrados en escalera (el corazón algo menos que el meñique): menos tensos que un puño.
  MiddleProximal: [0, 0, 1.3], MiddleIntermediate: [0, 0, 1.5], MiddleDistal: [0, 0, 0.9],
  RingProximal: [0, 0, 1.4], RingIntermediate: [0, 0, 1.55], RingDistal: [0, 0, 0.95],
  LittleProximal: [0, 0, 1.5], LittleIntermediate: [0, 0, 1.6], LittleDistal: [0, 0, 1.0],
  IndexProximal: [0, 0, 0.35], IndexIntermediate: [0, 0, 1.887], IndexDistal: [0, 0, 1.362],
  ThumbMetacarpal: [-1.865, -0.945, 0.107], ThumbProximal: [-0.037, 0.014, -0.385], ThumbDistal: [-0.713, -0.372, -0.914],
};
/** Signo de la paz: índice y corazón estirados y separados. */
const PEACE: FingerSpec = {
  RingProximal: FIST.RingProximal, RingIntermediate: FIST.RingIntermediate, RingDistal: FIST.RingDistal,
  LittleProximal: FIST.LittleProximal, LittleIntermediate: FIST.LittleIntermediate, LittleDistal: FIST.LittleDistal,
  IndexProximal: [0, 0.12, 0], IndexIntermediate: [0, 0, 0], IndexDistal: [0, 0, 0],
  MiddleProximal: [0, -0.12, 0], MiddleIntermediate: [0, 0, 0], MiddleDistal: [0, 0, 0],
  ThumbMetacarpal: [0, 0, 0.5], ThumbProximal: [0, 0, 0.7], ThumbDistal: [0, 0, 0.5],
};
/** Pulgar arriba. */
const THUMBS_UP: FingerSpec = { ...FIST, ThumbMetacarpal: [0, 0, 0], ThumbProximal: [0, 0, 0], ThumbDistal: [0, 0, 0] };

/** Garra de gato: dedos a medio cerrar, el pulgar recogido. */
const PAW: FingerSpec = {
  IndexProximal: [0, 0.05, 0.85], IndexIntermediate: [0, 0, 1.0], IndexDistal: [0, 0, 0.5],
  MiddleProximal: [0, 0, 0.95], MiddleIntermediate: [0, 0, 1.05], MiddleDistal: [0, 0, 0.55],
  RingProximal: [0, 0, 1.05], RingIntermediate: [0, 0, 1.1], RingDistal: [0, 0, 0.55],
  LittleProximal: [0, -0.05, 1.1], LittleIntermediate: [0, 0, 1.1], LittleDistal: [0, 0, 0.5],
  ThumbMetacarpal: [0.2, -0.2, 0], ThumbProximal: [0, 0, 0.4], ThumbDistal: [0, 0, 0.3],
};
/** Mano del estiramiento: dedos algo separados y apenas curvados, como al entrelazarlos hacia arriba. */
const STRETCH_HAND: FingerSpec = {
  IndexProximal: [0, 0.1, 0.25], IndexIntermediate: [0, 0, 0.3], IndexDistal: [0, 0, 0.15],
  MiddleProximal: [0, 0.03, 0.3], MiddleIntermediate: [0, 0, 0.3], MiddleDistal: [0, 0, 0.15],
  RingProximal: [0, -0.05, 0.3], RingIntermediate: [0, 0, 0.3], RingDistal: [0, 0, 0.15],
  LittleProximal: [0, -0.1, 0.3], LittleIntermediate: [0, 0, 0.3], LittleDistal: [0, 0, 0.15],
};

const arm = (w: number, a: Omit<ArmGesture, "w">): ArmGesture => ({ ...a, w });

/**
 * Un brazo del estiramiento. `lag` lo retrasa respecto al otro, `reachRoll` es hasta dónde sube
 * (π ≈ 3,14 sería vertical y con el codo bloqueado: se queda algo por debajo) y `fwd` cuánto se
 * adelanta, para que las manos queden delante de la cabeza y no detrás.
 */
function stretchArm(t0: number, lag: number, reachRoll: number, fwd: number): ArmGesture {
  const t = t0 - lag;
  const rise = ph(t, 0, 1.0); // se abren con los codos doblados
  const reach = ph(t, 0.9, 2.3); // se estiran hacia arriba
  const drift = ph(t, 2.3, 3.7); // siguen creciendo despacio
  const soften = ph(t, 3.7, 4.4); // los codos se aflojan
  const drop = ph(t, 4.2, 5.3); // caen
  const up = env(t, 2.1, 1.7, 1.1);
  const tremor = (Math.sin(t0 * 9 + lag * 20) * 0.6 + Math.sin(t0 * 5.3 + lag * 7) * 0.4) * up;
  return arm(env(t0, 0.2, 5.0, 0.3), {
    pitch: chain(0.07, [[rise, 0.5], [reach, fwd], [soften, 0.35], [drop, 0.07]]),
    roll: chain(0.17, [[rise, 1.25], [reach, reachRoll - 0.15], [drift, reachRoll], [soften, 1.6], [drop, 0.17]]) + 0.025 * tremor,
    elbow: chain(0.24, [[rise, 1.7], [reach, 0.4], [drift, 0.25], [soften, 0.9], [drop, 0.24]]) + 0.04 * tremor,
    twist: chain(0, [[rise, -0.5], [reach, -0.85], [soften, -0.3], [drop, 0]]),
    wrist: [0, 0, -0.3 * up],
    fingers: STRETCH_HAND,
    // La muñeca y los dedos llegan un poco más tarde y se sueltan antes que el brazo.
    we: env(t0 - 0.06, 0.2, 5.0, 0.3),
    wh: env(t0 - 0.14, 0.3, 4.8, 0.3),
    wf: env(t0 - 0.24, 0.5, 4.5, 0.4),
  });
}

const DEFS: Record<string, Def> = {
  // ----- Cara y cabeza -----
  /** Guiño al azar. */
  wink: { duration: 0.9, at: (t, side) => wink(t, side) },
  /** Guiña el ojo izquierdo del personaje. */
  winkLeft: { duration: 0.9, at: (t) => wink(t, 1) },
  /** Guiña el ojo derecho del personaje. */
  winkRight: { duration: 0.9, at: (t) => wink(t, -1) },
  /** Sonrisa suave que se mantiene un momento. */
  smile: {
    duration: 2.8,
    at: (t) => ({
      exp: { happy: 0.45 * env(t, 0.45, 1.7, 0.65), relaxed: 0.3 * env(t, 0.45, 1.7, 0.65) },
      head: { roll: 0.05 * env(t, 0.4, 1.6, 0.7) },
    }),
  },
  /** Risa completa: ojos cerrados, boca abierta y la cabeza botando. */
  laugh: {
    duration: 2.4,
    at: (t) => ({
      exp: { happy: 0.95 * env(t, 0.2, 1.7, 0.5) },
      head: { pitch: 0.05 * wave(t, 2.4, 5), roll: 0.04 * env(t, 0.3, 1.6, 0.5) },
    }),
  },
  /** Susto: abre los ojos y echa la cabeza hacia atrás. */
  surprised: {
    duration: 1.4,
    at: (t) => ({ exp: { surprised: env(t, 0.08, 0.7, 0.4) }, head: { pitch: -0.14 * env(t, 0.1, 0.6, 0.5) } }),
  },
  /** Cara de sueño: ojos entrecerrados que se cierran despacio. */
  sleepy: {
    duration: 3,
    at: (t) => ({
      exp: { relaxed: 0.7 * env(t, 0.5, 1.8, 0.7), blink: 0.9 * env(t - 0.5, 0.6, 0.55, 0.7) },
      head: { pitch: 0.16 * env(t, 0.8, 1.4, 0.8) },
    }),
  },
  /** Asentir ("sí"). */
  nod: { duration: 1.2, at: (t) => ({ head: { pitch: 0.22 * wave(t, 1.2, 2.2) } }) },
  /** Negar con la cabeza ("no"). */
  shake: { duration: 1.3, at: (t) => ({ head: { yaw: 0.34 * wave(t, 1.3, 2.4) } }) },
  /** Ladea la cabeza con curiosidad. */
  tilt: {
    duration: 2.2,
    at: (t, side) => ({
      exp: { surprised: 0.15 * env(t, 0.3, 1.3, 0.6) },
      head: { roll: side * 0.24 * env(t, 0.4, 1.3, 0.5), pitch: -0.04 * env(t, 0.4, 1.3, 0.5) },
    }),
  },
  /** Timidez: sonrisita, cabeza baja y ladeada. */
  shy: {
    duration: 2.8,
    at: (t, side) => ({
      exp: { happy: 0.45 * env(t, 0.4, 1.7, 0.7), relaxed: 0.3 * env(t, 0.4, 1.7, 0.7) },
      head: { pitch: 0.17 * env(t, 0.5, 1.6, 0.7), roll: side * 0.12 * env(t, 0.5, 1.6, 0.7) },
    }),
  },
  /** Puchero: boca fruncida, ceño suave y mira hacia otro lado. */
  pout: {
    duration: 2.8,
    at: (t, side) => {
      const k = env(t, 0.45, 1.7, 0.6);
      return {
        exp: { ou: 0.6 * k, angry: 0.3 * k, sad: 0.12 * k, blink: 0.2 * k },
        head: { pitch: 0.07 * k, roll: side * 0.07 * k },
        look: { x: side * -0.85, y: -0.1, w: k },
      };
    },
  },
  /** Pensativa: mira hacia arriba y a un lado. */
  lookUp: {
    duration: 3.2,
    at: (t, side) => {
      const k = env(t, 0.5, 2, 0.7);
      return {
        exp: { relaxed: 0.3 * k },
        head: { pitch: -0.1 * k, roll: side * 0.05 * k },
        look: { x: side * 0.3, y: 0.75, w: k },
      };
    },
  },
  /** Suspiro: los hombros suben al inspirar y caen al soltar el aire, con la mirada baja. */
  sigh: {
    duration: 3.6,
    at: (t, side) => {
      const inhale = env(t, 1.2, 0.15, 0.9); // sube y baja
      const out = env(t - 1.4, 0.3, 0.9, 0.6); // soltar el aire
      return {
        exp: { sad: 0.25 * env(t, 1, 1.4, 0.9), ou: 0.45 * out, blink: 0.45 * env(t - 1.2, 0.4, 0.7, 0.6) },
        pose: { shoulders: 0.08 * inhale, breath: 0.03 * inhale, lean: 0.03 * env(t - 1.4, 0.6, 1, 0.9) },
        head: { pitch: 0.13 * env(t - 1.3, 0.6, 1, 0.9) },
        look: { x: side * -0.5, y: -0.35, w: env(t - 1.2, 0.5, 1.2, 0.8) },
      };
    },
  },
  /** Bostezo: boca muy abierta, ojos cerrándose, la cabeza hacia atrás y los hombros subiendo. */
  yawn: {
    duration: 3.8,
    at: (t) => {
      const open = env(t, 0.9, 1.3, 0.8);
      return {
        exp: { aa: 0.95 * open, blink: 0.85 * env(t - 0.3, 0.5, 1.5, 0.7), relaxed: 0.4 * env(t, 0.6, 2, 0.8) },
        head: { pitch: -0.15 * env(t, 0.8, 1.3, 0.9) },
        pose: { breath: 0.035 * env(t, 0.9, 1.2, 0.8), shoulders: 0.04 * env(t, 0.9, 1.2, 0.8) },
      };
    },
  },
  // ----- Brazos y manos -----
  /**
   * Estirarse. Cada articulación sigue su propia curva y cada brazo la suya (el segundo va un
   * instante por detrás y con otra apertura): los brazos suben abriéndose con los codos doblados, se
   * estiran hacia arriba sin bloquear los codos, siguen creciendo despacio mientras dura el
   * estiramiento (con un pequeño temblor), el torso se arquea hacia atrás y, al soltar, los codos se
   * aflojan antes de que los brazos caigan y se suelta el aire.
   */
  stretch: {
    duration: 5.6,
    at: (t, side) => {
      const up = env(t, 2.1, 1.7, 1.1); // cuánto está estirada
      const exhale = env(t - 4.2, 0.4, 0.4, 0.7);
      return {
        exp: {
          aa: 0.4 * env(t - 1.7, 0.6, 1.3, 0.7),
          blink: 0.8 * env(t - 1.5, 0.5, 1.6, 0.8),
          relaxed: 0.4 * up,
          ou: 0.3 * exhale,
        },
        pose: {
          lean: -0.12 * up + 0.04 * exhale,
          bodyY: 0.02 * up,
          shoulders: 0.06 * up,
          breath: 0.035 * up,
          sway: side * 0.04 * env(t - 0.6, 1.8, 1.2, 1),
        },
        head: { pitch: -0.14 * up, roll: side * 0.05 * up },
        arm: stretchArm(t, 0, 2.75, 0.32),
        other: stretchArm(t, 0.12, 2.5, 0.42),
      };
    },
  },
  /** Corazón coreano con los dedos junto a la cara, con un guiño. */
  fingerHeart: {
    duration: 5,
    at: (t, side) => {
      // La cabeza y la sonrisa se adelantan; el brazo sale un instante después y llega con un pequeño rebote.
      const L = limb(t - 0.2, 0.75, 2.2, 0.85);
      const k = L.w;
      const bounce = settle(t, 0.95);
      const pop = env(t - 1.45, 0.22, 0.3, 0.45); // el corazón sale: un pequeño cabeceo de alegría
      const [d1, d2, d3] = [drift(t, 1) * k, drift(t, 2) * k, drift(t, 3) * k]; // la mano flota, no queda congelada
      return {
        exp: {
          happy: 0.55 * env(t - 0.3, 0.6, 2.2, 0.9),
          [side > 0 ? "blinkRight" : "blinkLeft"]: env(t - 1.9, 0.1, 0.35, 0.18),
        },
        head: { roll: side * -0.09 * env(t - 0.05, 0.8, 2.4, 0.9) + 0.012 * d2, pitch: -0.03 * pop + 0.015 * d1 },
        pose: { bodyY: 0.006 * pop, shoulders: 0.035 * k, lean: -0.012 * env(t, 0.25, 0.4, 0.5), sway: side * 0.01 * d3 },
        look: { x: 0, y: 0, w: env(t, 0.6, 2.4, 0.9) },
        arm: arm(k, {
          // El codo sale hacia fuera y el antebrazo cruza el pecho en diagonal: la mano queda en el centro del pecho
          // (y la manga no la tapa). Valores hallados midiendo la posición de la mano respecto al pecho.
          pitch: -0.21 + 0.05 * bounce + 0.025 * d1,
          roll: 0.92 + 0.02 * d2,
          uTwist: 0.84,
          elbow: 1.66 + 0.08 * bounce + 0.03 * d3,
          twist: 0,
          wrist: [0.6 + 0.03 * d2, 0.036, -1.6 + 0.05 * d1],
          fingers: FINGER_HEART,
          we: L.we,
          wh: L.wh,
          wf: L.wf,
          wt: L.wt,
        }),
        heart: env(t - 1.45, 0.3, 1.4, 0.4),
      };
    },
  },
  /** Signo de la paz junto a la cara. */
  peace: {
    duration: 4.2,
    at: (t, side) => {
      const L = limb(t - 0.15, 0.65, 1.9, 0.75);
      const k = L.w;
      const bounce = settle(t, 0.8);
      const [d1, d2, d3] = [drift(t, 4) * k, drift(t, 5) * k, drift(t, 6) * k];
      // Un balanceo suave de la V, como quien la enseña a una cámara.
      const wave = Math.sin(t * 3.1) * k * env(t - 1.0, 0.4, 1.2, 0.5);
      return {
        exp: { happy: 0.6 * env(t - 0.2, 0.6, 2, 0.8) },
        head: { roll: side * -0.1 * env(t - 0.05, 0.7, 2.1, 0.8) + 0.01 * d2, pitch: 0.012 * d1 },
        pose: { shoulders: 0.03 * k, bodyY: 0.004 * Math.max(0, bounce) },
        look: { x: 0, y: 0, w: env(t, 0.55, 2.1, 0.8) },
        arm: arm(k, {
          pitch: 0.85 + 0.05 * bounce + 0.02 * d1,
          roll: 0.4 + 0.02 * d2,
          elbow: 2.05 + 0.07 * bounce + 0.03 * d3,
          twist: -1.2,
          wrist: [0, 0.04 * wave, 0.06 * wave],
          fingers: PEACE,
          we: L.we,
          wh: L.wh,
          wf: L.wf,
          wt: L.wt,
        }),
      };
    },
  },
  /** Pulgar arriba. */
  thumbsUp: {
    duration: 3.8,
    at: (t) => {
      const L = limb(t - 0.1, 0.6, 1.7, 0.7);
      const k = L.w;
      const bounce = settle(t, 0.7);
      const [d1, d2] = [drift(t, 8) * k, drift(t, 9) * k];
      // Dos cabeceos pequeños de "vale", con el pulgar acompañando.
      const nod = Math.sin((t - 1.0) * 7) * env(t - 1.0, 0.1, 0.45, 0.25);
      return {
        exp: { happy: 0.5 * env(t - 0.2, 0.55, 1.9, 0.7) },
        head: { pitch: 0.05 * nod },
        pose: { shoulders: 0.025 * k },
        look: { x: 0, y: 0, w: env(t, 0.5, 1.9, 0.7) },
        arm: arm(k, {
          pitch: 0.9 + 0.05 * bounce + 0.02 * d1 + 0.03 * nod,
          roll: 0.3 + 0.02 * d2,
          elbow: 1.35 + 0.08 * bounce + 0.03 * nod,
          wrist: [0.05 * nod, 0, 0],
          fingers: THUMBS_UP,
          we: L.we,
          wh: L.wh,
          wf: L.wf,
          wt: L.wt,
        }),
      };
    },
  },
  /**
   * Zarpitas de gato: las dos manos junto a la cara, con los antebrazos casi verticales, las
   * muñecas dobladas hacia delante y los dedos a medio cerrar (garras sueltas, no puños). Los brazos
   * "amasan" a contratiempo, uno sube mientras el otro baja, como un gatito.
   */
  catPaws: {
    duration: 4.4,
    at: (t, side) => {
      const L = limb(t - 0.1, 0.6, 2.5, 0.7);
      const L2 = limb(t - 0.2, 0.6, 2.4, 0.75); // la segunda pata llega un poco después
      const k = L.w;
      const bounce = settle(t, 0.7);
      // El amasado arranca suave y sube de ritmo; cada pata con su propio compás.
      const kneadIn = env(t - 0.9, 0.5, 1.9, 0.5);
      const paw = Math.sin(t * 6.4) * kneadIn;
      const paw2 = Math.sin(t * 6.4 + Math.PI + 0.3) * kneadIn;
      const make = (l: Limb, phase: number, seed: number) =>
        arm(l.w, {
          pitch: 0.95 + 0.04 * phase + 0.04 * bounce,
          roll: 0.5 + 0.02 * drift(t, seed) * l.w,
          elbow: 2.0 + 0.14 * phase + 0.06 * bounce,
          twist: -0.5,
          wrist: [0.2, 0, 0.6 + 0.2 * phase],
          fingers: PAW,
          we: l.we,
          wh: l.wh,
          wf: l.wf,
          wt: l.wt,
        });
      return {
        exp: { happy: 0.6 * env(t - 0.2, 0.6, 2.7, 0.8) },
        head: { roll: side * 0.1 * k + 0.012 * drift(t, 11) * k, pitch: 0.04 * k + 0.02 * paw },
        pose: { shoulders: 0.03 * k },
        arm: make(L, paw, 12),
        other: make(L2, paw2, 13),
      };
    },
  },
};

/** Gestos que se lanzan solos en reposo y su probabilidad relativa (los llamativos, poco a menudo). */
export const IDLE_GESTURES: { name: string; weight: number }[] = [
  { name: "smile", weight: 3 },
  { name: "tilt", weight: 2 },
  { name: "lookUp", weight: 2 },
  { name: "sigh", weight: 2 },
  { name: "shy", weight: 1.2 },
  { name: "wink", weight: 1.2 },
  { name: "pout", weight: 1 },
  { name: "yawn", weight: 1 },
  { name: "stretch", weight: 0.7 },
  { name: "catPaws", weight: 0.5 },
  { name: "peace", weight: 0.5 },
  { name: "fingerHeart", weight: 0.7 },
  { name: "thumbsUp", weight: 0.4 },
];

interface Active {
  def: Def;
  t: number;
  side: number;
}

export const emptyFrame = (): GestureFrame => ({
  exp: {},
  head: { pitch: 0, yaw: 0, roll: 0 },
  pose: { lean: 0, shoulders: 0, breath: 0, bodyY: 0, sway: 0 },
  look: { x: 0, y: 0, w: 0 },
  body: {},
  heart: { w: 0, side: "right" },
});

export class Gestures {
  private active: Active[] = [];

  list() {
    return Object.keys(DEFS);
  }

  /** Hay algún gesto en marcha. */
  get busy() {
    return this.active.length > 0;
  }

  /** Lanza un gesto; los lados aleatorios (guiño, brazo, ladear...) se sortean aquí. */
  trigger(name: string): boolean {
    const def = DEFS[name];
    if (!def) return false;
    this.active.push({ def, t: 0, side: Math.random() < 0.5 ? 1 : -1 });
    return true;
  }

  update(dt: number): GestureFrame {
    const frame = emptyFrame();
    this.active = this.active.filter((a) => (a.t += dt) < a.def.duration);
    for (const a of this.active) {
      const r = a.def.at(a.t, a.side);
      for (const [k, v] of Object.entries(r.exp ?? {})) frame.exp[k] = Math.min(1, Math.max(frame.exp[k] ?? 0, v));
      frame.head.pitch += r.head?.pitch ?? 0;
      frame.head.yaw += r.head?.yaw ?? 0;
      frame.head.roll += r.head?.roll ?? 0;
      // Vida propia: mientras dura el gesto la cabeza y el torso se mueven un poco por su cuenta (más en el centro del gesto).
      const live = Math.sin((Math.PI * a.t) / a.def.duration);
      frame.head.yaw += 0.018 * drift(a.t, 21) * live;
      frame.head.pitch += 0.012 * drift(a.t, 22) * live;
      frame.pose.sway += 0.012 * drift(a.t, 23) * live;
      frame.pose.breath += 0.004 * (drift(a.t * 1.3, 24) + 1) * live;
      for (const [k, v] of Object.entries(r.pose ?? {})) frame.pose[k as keyof PoseOffset] += v ?? 0;
      if (r.look && r.look.w > frame.look.w) frame.look = r.look;
      // Un brazo va al lado que tocó (izquierda si side > 0); si pide los dos, a ambos.
      const put = (side: "left" | "right", g: ArmGesture) => {
        if (g.w > (frame.body[side]?.w ?? 0)) frame.body[side] = g;
      };
      const own = a.side > 0 ? "left" : "right";
      if (r.arm) put(own, r.arm);
      if (r.other) put(own === "left" ? "right" : "left", r.other);
      if (r.heart && r.heart > frame.heart.w) frame.heart = { w: r.heart, side: own };
      if (r.arms) {
        put("left", r.arms);
        put("right", r.arms);
      }
    }
    return frame;
  }
}
