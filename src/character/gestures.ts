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
  wrist?: Euler3;
  fingers?: FingerSpec;
  /** Cuánto se impone el gesto sobre lo que esté haciendo el brazo (0..1). */
  w: number;
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
 * Corazón coreano: el índice, algo flexionado, y el pulgar se cruzan en X por la mitad de sus
 * tramos finales (como en la imagen de referencia), y el resto de dedos van cerrados. Los ángulos
 * salen de una búsqueda numérica sobre este modelo (cruce a 0,1 mm, tramos a ~60°) y se revisaron a
 * ojo; la mano y el antebrazo, que la dejan erguida junto a la mejilla con el índice inclinado, van
 * en el gesto (`fingerHeart`). Con otro VRM puede hacer falta reajustarlos.
 */
const FINGER_HEART: FingerSpec = {
  // Los tres dedos cerrados en escalera (el corazón algo menos que el meñique): menos tensos que un puño.
  MiddleProximal: [0, 0, 1.3], MiddleIntermediate: [0, 0, 1.5], MiddleDistal: [0, 0, 0.9],
  RingProximal: [0, 0, 1.4], RingIntermediate: [0, 0, 1.55], RingDistal: [0, 0, 0.95],
  LittleProximal: [0, 0, 1.5], LittleIntermediate: [0, 0, 1.6], LittleDistal: [0, 0, 1.0],
  IndexProximal: [0, 0, 0.991], IndexIntermediate: [0, 0, 0.91], IndexDistal: [0, 0, 0.003],
  ThumbMetacarpal: [-1.716, -0.998, 0.134], ThumbProximal: [0.394, -0.779, -0.62], ThumbDistal: [0.016, -0.055, 0.003],
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
    duration: 4.2,
    at: (t, side) => {
      const k = env(t, 0.7, 2.4, 0.7);
      const pop = env(t - 1.0, 0.25, 0.3, 0.4); // el corazón sale: un pequeño cabeceo de alegría
      const sway = Math.sin(t * 2.6) * k; // la mano flota un poco, no queda congelada
      return {
        exp: {
          happy: 0.55 * env(t - 0.3, 0.5, 2, 0.7),
          [side > 0 ? "blinkRight" : "blinkLeft"]: env(t - 1.6, 0.1, 0.35, 0.15),
        },
        head: { roll: side * -0.09 * k, pitch: -0.03 * pop },
        pose: { bodyY: 0.006 * pop },
        look: { x: 0, y: 0, w: k },
        arm: arm(k, {
          pitch: 0.915 + 0.025 * sway,
          roll: 0.1 + 0.02 * Math.sin(t * 2.1 + 1) * k,
          elbow: 1.99 + 0.03 * sway,
          twist: -0.148,
          wrist: [-0.084, 0.036, -0.665 + 0.05 * sway],
          fingers: FINGER_HEART,
        }),
        heart: env(t - 1.0, 0.3, 1.5, 0.35),
      };
    },
  },
  /** Signo de la paz junto a la cara. */
  peace: {
    duration: 3.4,
    at: (t, side) => {
      const k = env(t, 0.6, 1.9, 0.6);
      return {
        exp: { happy: 0.6 * k },
        head: { roll: side * -0.1 * k },
        look: { x: 0, y: 0, w: k },
        arm: arm(k, { pitch: 0.85, roll: 0.4, elbow: 2.05, twist: -1.2, fingers: PEACE }),
      };
    },
  },
  /** Pulgar arriba. */
  thumbsUp: {
    duration: 3,
    at: (t) => {
      const k = env(t, 0.55, 1.7, 0.6);
      return {
        exp: { happy: 0.5 * k },
        look: { x: 0, y: 0, w: k },
        arm: arm(k, { pitch: 0.9, roll: 0.3, elbow: 1.35, fingers: THUMBS_UP }),
      };
    },
  },
  /**
   * Zarpitas de gato: las dos manos junto a la cara, con los antebrazos casi verticales, las
   * muñecas dobladas hacia delante y los dedos a medio cerrar (garras sueltas, no puños). Los brazos
   * "amasan" a contratiempo, uno sube mientras el otro baja, como un gatito.
   */
  catPaws: {
    duration: 3.8,
    at: (t, side) => {
      const k = env(t, 0.55, 2.5, 0.6);
      const paw = Math.sin(t * 7) * k;
      const make = (phase: number) =>
        arm(k, {
          pitch: 0.95 + 0.04 * phase,
          roll: 0.5,
          elbow: 2.0 + 0.14 * phase,
          twist: -0.5,
          wrist: [0.2, 0, 0.6 + 0.2 * phase],
          fingers: PAW,
        });
      return {
        exp: { happy: 0.6 * k },
        head: { roll: side * 0.1 * k, pitch: 0.04 * k },
        arm: make(paw),
        other: make(-paw),
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
