import * as THREE from "three";
import type { CompanionState } from "../core/stateMachine";

/**
 * Efectos flotantes por estado, estilo anime brillante: burbuja de pensamiento al pensar, engranajes,
 * símbolos de código y un anillo de carga al trabajar, "!" con ondas al pedir permiso, confeti y
 * estrellas al celebrar, nube con gota de sudor al fallar, y notas, corazones y destellos cuando
 * baila. Todo son sprites con texturas dibujadas en canvas (degradados, contorno y brillo) y un pequeño
 * sistema de partículas con reserva fija. Se anclan a la cabeza: el origen de `root` es la cabeza y
 * `height` la distancia a la coronilla.
 */
export interface Indicators {
  root: THREE.Group;
  setState(state: CompanionState): void;
  /** Clip que suena (nombre de archivo) o `null`: si es un baile, salen notas y corazones en reposo. */
  setClip(file: string | null): void;
  update(time: number): void;
}

// ───────────────────────────── Texturas ─────────────────────────────

const LILAC = 0xc9b8ff;
const PINK = 0xffb3d1;
const CYAN = 0x9fe3ff;
const GOLD = 0xffe08a;
const MINT = 0xb4f0cf;
const PASTELS = [LILAC, PINK, CYAN, GOLD, MINT];
const CONFETTI = [0xff8fb8, 0xffd36e, 0x7fd8ff, 0xb59bff, 0x8ff0b8, 0xffffff];

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function canvasTexture(w: number, h: number, draw: Draw) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  draw(c, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Estrella de cuatro puntas cóncava. */
function starPath(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number) {
  c.beginPath();
  c.moveTo(cx, cy - R);
  c.quadraticCurveTo(cx + r, cy - r, cx + R, cy);
  c.quadraticCurveTo(cx + r, cy + r, cx, cy + R);
  c.quadraticCurveTo(cx - r, cy + r, cx - R, cy);
  c.quadraticCurveTo(cx - r, cy - r, cx, cy - R);
  c.closePath();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const cache = new Map<string, THREE.CanvasTexture>();
const tex = (key: string, w: number, h: number, draw: Draw) => {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = canvasTexture(w, h, draw)));
  return t;
};

const T = {
  glow: () =>
    tex("glow", 128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.55)");
      g.addColorStop(0.6, "rgba(255,255,255,0.12)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }),

  /** Destello: halo, estrella principal, estrella pequeña en diagonal, rayos finos y núcleo. */
  sparkle: () =>
    tex("sparkle", 256, 256, (c, w, h) => {
      const m = w / 2;
      const halo = c.createRadialGradient(m, m, 0, m, m, m * 0.7);
      halo.addColorStop(0, "rgba(255,255,255,0.6)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = halo;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(255,255,255,0.55)";
      c.save();
      c.translate(m, m);
      c.rotate(Math.PI / 4);
      starPath(c, 0, 0, m * 0.5, m * 0.07);
      c.fill();
      c.restore();
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.5, "#fff");
      g.addColorStop(1, "#ffffff");
      c.fillStyle = g;
      starPath(c, m, m, m * 0.92, m * 0.09);
      c.lineWidth = 5;
      c.lineJoin = "round";
      c.strokeStyle = "rgba(70,50,130,0.6)";
      c.stroke();
      c.fill();
      c.shadowBlur = 0;
      const core = c.createRadialGradient(m, m, 0, m, m, m * 0.22);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = core;
      c.beginPath();
      c.arc(m, m, m * 0.22, 0, Math.PI * 2);
      c.fill();
    }),

  /** Anillo suave (ondas de pulso). */
  ring: () =>
    tex("ring", 256, 256, (c, w) => {
      const m = w / 2;
      const g = c.createRadialGradient(m, m, m * 0.7, m, m, m * 0.98);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.55, "rgba(255,255,255,0.95)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
    }),

  /** Anillo de carga: arco con degradado cónico y punta redondeada. */
  loader: () =>
    tex("loader", 256, 256, (c, w) => {
      const m = w / 2;
      const R = m * 0.7;
      c.lineWidth = m * 0.16;
      c.lineCap = "round";
      c.strokeStyle = "rgba(255,255,255,0.18)";
      c.beginPath();
      c.arc(m, m, R, 0, Math.PI * 2);
      c.stroke();
      if (typeof c.createConicGradient === "function") {
        const g = c.createConicGradient(-Math.PI / 2, m, m);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.7, "rgba(255,255,255,1)");
        g.addColorStop(0.7001, "rgba(255,255,255,0)");
        c.strokeStyle = g;
      } else c.strokeStyle = "#fff";
      c.shadowColor = "rgba(255,255,255,0.9)";
      c.shadowBlur = 14;
      c.beginPath();
      c.arc(m, m, R, -Math.PI / 2, Math.PI * 0.95);
      c.stroke();
    }),

  /** Engranaje con bisel, orificio y radios. En gris para teñirlo con el material. */
  gear: () =>
    tex("gear", 256, 256, (c, w) => {
      const m = w / 2;
      const n = 10;
      const Ro = m * 0.96;
      const Rr = m * 0.76;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const da = Math.PI / n;
        const pts: [number, number][] = [
          [a - da * 0.55, Rr],
          [a - da * 0.3, Ro],
          [a + da * 0.3, Ro],
          [a + da * 0.55, Rr],
        ];
        pts.forEach(([ang, r], k) => {
          const x = m + Math.cos(ang) * r;
          const y = m + Math.sin(ang) * r;
          if (i === 0 && k === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
      }
      c.closePath();
      const g = c.createLinearGradient(0, 0, w, w);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#9a9ab4");
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 6;
      c.lineJoin = "round";
      c.strokeStyle = "rgba(40,40,70,0.9)";
      c.stroke();
      // aro interior con relieve y orificio central
      c.beginPath();
      c.arc(m, m, Rr * 0.82, 0, Math.PI * 2);
      c.lineWidth = 5;
      c.strokeStyle = "rgba(60,60,90,0.55)";
      c.stroke();
      c.beginPath();
      c.arc(m, m, Rr * 0.78, 0, Math.PI * 2);
      c.lineWidth = 3;
      c.strokeStyle = "rgba(255,255,255,0.75)";
      c.stroke();
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.beginPath();
      c.arc(m, m, m * 0.24, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.beginPath();
      c.arc(m, m, m * 0.24, 0, Math.PI * 2);
      c.lineWidth = 6;
      c.strokeStyle = "rgba(40,40,70,0.9)";
      c.stroke();
    }),

  /** Símbolo de código con halo. */
  glyph: (text: string) =>
    tex("glyph:" + text, 256, 128, (c, w, h) => {
      c.font = "700 84px Consolas, 'Courier New', monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.lineWidth = 10;
      c.strokeStyle = "rgba(40,30,90,0.75)";
      c.strokeText(text, w / 2, h / 2 + 4);
      c.shadowColor = "rgba(255,255,255,0.95)";
      c.shadowBlur = 14;
      c.fillStyle = "#fff";
      c.fillText(text, w / 2, h / 2 + 4);
    }),

  /** Nota musical (corchea) o par de corcheas unidas. */
  note: (double: boolean) =>
    tex(double ? "note2" : "note1", 128, 128, (c, w, h) => {
      c.lineJoin = "round";
      c.lineCap = "round";
      const head = (x: number, y: number) => {
        c.save();
        c.translate(x, y);
        c.rotate(-0.4);
        c.beginPath();
        c.ellipse(0, 0, w * 0.15, w * 0.105, 0, 0, Math.PI * 2);
        c.restore();
      };
      const paint = () => {
        c.fillStyle = "#fff";
        c.fill();
        c.lineWidth = 5;
        c.strokeStyle = "rgba(60,40,110,0.85)";
        c.stroke();
      };
      c.shadowColor = "rgba(255,255,255,0.8)";
      c.shadowBlur = 10;
      if (!double) {
        head(w * 0.38, h * 0.76);
        paint();
        c.beginPath();
        c.moveTo(w * 0.51, h * 0.72);
        c.lineTo(w * 0.51, h * 0.16);
        c.bezierCurveTo(w * 0.56, h * 0.36, w * 0.8, h * 0.34, w * 0.76, h * 0.56);
        c.lineWidth = 11;
        c.strokeStyle = "rgba(60,40,110,0.85)";
        c.stroke();
        c.lineWidth = 6;
        c.strokeStyle = "#fff";
        c.stroke();
      } else {
        head(w * 0.28, h * 0.78);
        paint();
        head(w * 0.7, h * 0.7);
        paint();
        for (const [x1, y1, x2, y2] of [
          [w * 0.41, h * 0.74, w * 0.41, h * 0.24],
          [w * 0.83, h * 0.66, w * 0.83, h * 0.16],
        ]) {
          c.beginPath();
          c.moveTo(x1, y1);
          c.lineTo(x2, y2);
          c.lineWidth = 11;
          c.strokeStyle = "rgba(60,40,110,0.85)";
          c.stroke();
          c.lineWidth = 6;
          c.strokeStyle = "#fff";
          c.stroke();
        }
        c.beginPath();
        c.moveTo(w * 0.41, h * 0.24);
        c.lineTo(w * 0.83, h * 0.16);
        c.lineWidth = 15;
        c.strokeStyle = "rgba(60,40,110,0.85)";
        c.stroke();
        c.lineWidth = 9;
        c.strokeStyle = "#fff";
        c.stroke();
      }
    }),

  /** Corazón rosa con contorno y brillo (a color: no se tiñe). */
  heart: () =>
    tex("heart", 128, 128, (c, w) => {
      const s = w / 128;
      c.save();
      c.scale(s, s);
      c.beginPath();
      c.moveTo(64, 112);
      c.bezierCurveTo(10, 74, 10, 30, 40, 26);
      c.bezierCurveTo(54, 24, 62, 34, 64, 42);
      c.bezierCurveTo(66, 34, 74, 24, 88, 26);
      c.bezierCurveTo(118, 30, 118, 74, 64, 112);
      c.closePath();
      const g = c.createLinearGradient(0, 20, 0, 114);
      g.addColorStop(0, "#ffb6cf");
      g.addColorStop(1, "#ff5f8f");
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 6;
      c.lineJoin = "round";
      c.strokeStyle = "#b33a63";
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.ellipse(38, 44, 9, 5.5, -0.7, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(52, 36, 2.6, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }),

  /** Confeti: tira redondeada en blanco con un ligero degradado (se tiñe). */
  confetti: () =>
    tex("confetti", 64, 64, (c, w, h) => {
      roundRect(c, 8, 16, w - 16, h - 32, 6);
      const g = c.createLinearGradient(0, 16, 0, h - 16);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#c8c8d8");
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = "rgba(60,50,100,0.45)";
      c.stroke();
    }),

  /** Bola brillante pequeña (se tiñe). */
  bead: () =>
    tex("bead", 64, 64, (c, w) => {
      const m = w / 2;
      const g = c.createRadialGradient(m * 0.75, m * 0.7, 1, m, m, m * 0.9);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.5, "#e6e6f2");
      g.addColorStop(1, "#a8a8c4");
      c.fillStyle = g;
      c.beginPath();
      c.arc(m, m, m * 0.85, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = "rgba(60,50,100,0.5)";
      c.stroke();
    }),

  /** Nube de pensamiento: contorno lila, relleno claro y reflejo. */
  bubble: () =>
    tex("bubble", 256, 192, (c) => {
      const blobs: [number, number, number][] = [
        [62, 112, 40],
        [104, 82, 52],
        [160, 76, 54],
        [200, 112, 40],
        [150, 128, 48],
        [92, 130, 42],
      ];
      const draw = (grow: number, style: string | CanvasGradient) => {
        c.fillStyle = style;
        c.beginPath();
        for (const [x, y, r] of blobs) {
          c.moveTo(x + r + grow, y);
          c.arc(x, y, r + grow, 0, Math.PI * 2);
        }
        c.fill();
      };
      c.shadowColor = "rgba(150,120,255,0.6)";
      c.shadowBlur = 14;
      draw(7, "#a99cff");
      c.shadowBlur = 0;
      const g = c.createLinearGradient(0, 30, 0, 170);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#e7e0ff");
      draw(0, g);
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.beginPath();
      c.ellipse(96, 58, 22, 7, -0.5, 0, Math.PI * 2);
      c.fill();
    }),

  /** Signo de exclamación ámbar con contorno y brillo. */
  exclaim: () =>
    tex("exclaim", 128, 192, (c, w) => {
      const m = w / 2;
      c.lineJoin = "round";
      const bar = () => {
        c.beginPath();
        c.moveTo(m - 24, 26);
        c.quadraticCurveTo(m - 28, 18, m - 14, 14);
        c.lineTo(m + 14, 14);
        c.quadraticCurveTo(m + 28, 18, m + 24, 26);
        c.lineTo(m + 10, 118);
        c.quadraticCurveTo(m, 126, m - 10, 118);
        c.closePath();
      };
      const g = c.createLinearGradient(0, 14, 0, 160);
      g.addColorStop(0, "#fff0b8");
      g.addColorStop(0.55, "#ffc95a");
      g.addColorStop(1, "#ff9f2e");
      c.shadowColor = "rgba(255,190,80,0.9)";
      c.shadowBlur = 18;
      bar();
      c.fillStyle = g;
      c.fill();
      c.shadowBlur = 0;
      c.lineWidth = 7;
      c.strokeStyle = "#a3561a";
      c.stroke();
      c.beginPath();
      c.arc(m, 156, 15, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.8)";
      c.beginPath();
      c.ellipse(m - 9, 42, 4.5, 16, 0.08, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(m - 5, 150, 4, 0, Math.PI * 2);
      c.fill();
    }),

  /** Gota de sudor / lluvia (azul con brillo). */
  drop: () =>
    tex("drop", 96, 128, (c, w) => {
      const m = w / 2;
      c.beginPath();
      c.moveTo(m, 8);
      c.bezierCurveTo(m + 8, 36, m + 34, 62, m + 34, 88);
      c.bezierCurveTo(m + 34, 108, m + 18, 120, m, 120);
      c.bezierCurveTo(m - 18, 120, m - 34, 108, m - 34, 88);
      c.bezierCurveTo(m - 34, 62, m - 8, 36, m, 8);
      c.closePath();
      const g = c.createLinearGradient(0, 8, 0, 120);
      g.addColorStop(0, "#d9f4ff");
      g.addColorStop(1, "#5db7ff");
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 5;
      c.lineJoin = "round";
      c.strokeStyle = "#2f6fb0";
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.ellipse(m - 12, 86, 6, 14, 0.25, 0, Math.PI * 2);
      c.fill();
    }),

  /** Nube de tormenta (a color). */
  gloom: () =>
    tex("gloom", 256, 160, (c) => {
      const blobs: [number, number, number][] = [
        [60, 100, 38],
        [104, 70, 48],
        [158, 66, 50],
        [200, 100, 38],
        [130, 104, 42],
      ];
      const fill = (grow: number, style: string | CanvasGradient) => {
        c.fillStyle = style;
        c.beginPath();
        for (const [x, y, r] of blobs) {
          c.moveTo(x + r + grow, y);
          c.arc(x, y, r + grow, 0, Math.PI * 2);
        }
        c.fill();
      };
      fill(6, "#2a2c48");
      const g = c.createLinearGradient(0, 20, 0, 150);
      g.addColorStop(0, "#7d83ad");
      g.addColorStop(1, "#4b4f78");
      fill(0, g);
      c.fillStyle = "rgba(255,255,255,0.22)";
      c.beginPath();
      c.ellipse(96, 50, 24, 7, -0.4, 0, Math.PI * 2);
      c.fill();
    }),

  /** Rayo amarillo con núcleo claro. */
  bolt: () =>
    tex("bolt", 96, 160, (c) => {
      c.beginPath();
      c.moveTo(56, 6);
      c.lineTo(20, 84);
      c.lineTo(46, 84);
      c.lineTo(34, 152);
      c.lineTo(76, 64);
      c.lineTo(50, 64);
      c.closePath();
      c.shadowColor = "rgba(255,230,120,0.95)";
      c.shadowBlur = 16;
      c.fillStyle = "#ffe35e";
      c.fill();
      c.shadowBlur = 0;
      c.lineWidth = 5;
      c.lineJoin = "round";
      c.strokeStyle = "#b07a10";
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.moveTo(52, 22);
      c.lineTo(32, 78);
      c.lineTo(48, 78);
      c.lineTo(42, 112);
      c.lineTo(62, 62);
      c.closePath();
      c.fill();
    }),
};

// ───────────────────────────── Partículas ─────────────────────────────

const POOL = 220;
const GLYPHS = ["</>", "{ }", "01", "fn()", "=>", "#", "[ ]", "&&"];

interface Spawn {
  map: THREE.Texture;
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  ax?: number;
  ay?: number;
  drag?: number;
  life: number;
  s0: number;
  s1?: number;
  aspect?: number;
  color?: number;
  add?: boolean;
  opacity?: number;
  rot?: number;
  spin?: number;
  flutter?: number;
  sway?: number;
  swayF?: number;
  fadeOut?: number;
  twinkle?: number;
}

interface Particle extends Required<Omit<Spawn, "map">> {
  sprite: THREE.Sprite;
  active: boolean;
  age: number;
  phase: number;
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** Sprite que se dibuja por encima de todo (el pelo no lo tapa). */
function makeSprite(map: THREE.Texture | null, color = 0xffffff) {
  const m = new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending, // sin mezcla aditiva: sobre la ventana transparente no se vería
  });
  const s = new THREE.Sprite(m);
  s.renderOrder = 30;
  return s;
}

/** Elemento fijo de un estado: aparece con un pequeño rebote y se apaga con suavidad. */
interface Prop {
  sprite: THREE.Sprite;
  base: number;
  scale: [number, number];
}

export function createIndicators(height = 0.5): Indicators {
  const root = new THREE.Group();
  const H = height;

  // --- Partículas ---
  const pool: Particle[] = Array.from({ length: POOL }, () => {
    const sprite = makeSprite(null);
    sprite.visible = false;
    root.add(sprite);
    return {
      sprite, active: false, age: 0, phase: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, drag: 0, life: 1, s0: 0.05, s1: 0.05,
      aspect: 1, color: 0xffffff, add: false, opacity: 1, rot: 0, spin: 0, flutter: 0, sway: 0,
      swayF: 3, fadeOut: 0.4, twinkle: 0,
    };
  });
  let cursor = 0;
  const emit = (s: Spawn) => {
    // Busca una libre; si no hay, recicla la más antigua (el cursor recorre la reserva).
    let p: Particle | undefined;
    for (let i = 0; i < POOL; i++) {
      const c = pool[(cursor + i) % POOL];
      if (!c.active) {
        p = c;
        cursor = (cursor + i + 1) % POOL;
        break;
      }
    }
    if (!p) {
      p = pool[cursor];
      cursor = (cursor + 1) % POOL;
    }
    const { map, ...rest } = s;
    Object.assign(p, {
      z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, drag: 0, s1: s.s0, aspect: 1, color: 0xffffff, add: false,
      opacity: 1, rot: 0, spin: 0, flutter: 0, sway: 0, swayF: 3, fadeOut: 0.4, twinkle: 0,
    }, rest);
    p.active = true;
    p.age = 0;
    p.phase = Math.random() * Math.PI * 2;
    const m = p.sprite.material;
    m.map = map;
    m.color.setHex(p.color);
    m.needsUpdate = true;
    p.sprite.visible = true;
    p.sprite.position.set(p.x, p.y, p.z);
  };

  // --- Elementos fijos por estado ---
  const group = (list: Prop[]) => {
    for (const p of list) root.add(p.sprite);
    return list;
  };
  const prop = (map: THREE.Texture, x: number, y: number, w: number, h: number, color = 0xffffff, _add = false, base = 1): Prop => {
    const sprite = makeSprite(map, color);
    sprite.position.set(x, y, 0);
    sprite.visible = false;
    return { sprite, base, scale: [w, h] };
  };

  // Pensando: tres burbujas que suben hasta una nube con tres puntos que saltan dentro.
  const BX = 0.3;
  const BY = H + 0.12;
  const thinkTrail = [
    prop(T.bubble(), 0.13, H - 0.02, 0.04, 0.03),
    prop(T.bubble(), 0.19, H + 0.04, 0.06, 0.045),
    prop(T.bubble(), BX, BY, 0.26, 0.195),
  ];
  const thinkDots = [-1, 0, 1].map((i) => prop(T.bead(), BX + i * 0.06, BY - 0.005, 0.034, 0.034, LILAC));
  const thinkSpark = [prop(T.sparkle(), BX + 0.12, BY + 0.1, 0.06, 0.06, 0xffffff, true), prop(T.sparkle(), BX - 0.13, BY + 0.08, 0.04, 0.04, LILAC, true)];
  const thinking = group([...thinkTrail, ...thinkDots, ...thinkSpark]);

  // Trabajando: engranajes engranados, anillo de carga y símbolos de código que suben.
  const GX = -0.27;
  const GY = H + 0.1;
  const gearBig = prop(T.gear(), GX, GY, 0.17, 0.17, 0xb9c3ff);
  const gearSmall = prop(T.gear(), GX + 0.125, GY + 0.085, 0.1, 0.1, 0xffc9e0);
  const gearTiny = prop(T.gear(), GX - 0.1, GY + 0.105, 0.065, 0.065, 0xa8f0d0);
  const loaderGlow = prop(T.glow(), 0.27, H + 0.1, 0.24, 0.24, LILAC, true, 0.5);
  const loader = prop(T.loader(), 0.27, H + 0.1, 0.16, 0.16, 0x9a84ff, true);
  const working = group([loaderGlow, loader, gearBig, gearSmall, gearTiny]);

  // Permiso: "!" con halo y ondas de pulso.
  const alertGlow = prop(T.glow(), 0, H + 0.1, 0.34, 0.34, 0xffc65a, true, 0.8);
  const alertMark = prop(T.exclaim(), 0, H + 0.1, 0.1, 0.15);
  const alertRings = [0, 1].map(() => prop(T.ring(), 0, H + 0.1, 0.1, 0.1, 0xffd47a, true));
  const alert = group([alertGlow, ...alertRings, alertMark]);

  // Celebrando: estrellas que orbitan y un destello al entrar.
  const orbit = Array.from({ length: 6 }, (_, i) => prop(T.sparkle(), 0, 0, 0.09, 0.09, PASTELS[i % PASTELS.length], true));
  const flash = prop(T.ring(), 0, H, 0.2, 0.2, 0xfff2c8, true, 0);
  const celebrating = group([flash, ...orbit]);

  // Error: nube de tormenta, rayos y una gota de sudor.
  const gloomCloud = prop(T.gloom(), 0, H + 0.12, 0.34, 0.21);
  const bolt = prop(T.bolt(), 0.04, H + 0.01, 0.07, 0.115, 0xffffff, false, 0);
  const error = group([gloomCloud, bolt]);

  const all = [thinking, working, alert, celebrating, error];
  const fades = all.map(() => 0);

  let state: CompanionState = "idle";
  let dancing = false;
  let last = -1;
  let acc = { work: 0, talk: 0, conf: 0, dance: 0, rain: 0, sweat: 0, heart: 0, tw: 0 };
  let boltAt = 2;
  let ringAt = 0;
  let stateTime = 0;

  const groupOf = (s: CompanionState) =>
    s === "thinking" ? 0 : s === "working" ? 1 : s === "waiting_permission" ? 2 : s === "celebrating" ? 3 : s === "error" ? 4 : -1;

  const confettiBurst = () => {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.25, 0.95);
      emit({
        map: T.confetti(), x: rnd(-0.06, 0.06), y: H, vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp * 1.3 + 0.35,
        ay: -0.75, drag: 1.6, life: rnd(1.8, 3), s0: rnd(0.026, 0.045), aspect: rnd(0.45, 0.8), color: pick(CONFETTI),
        spin: rnd(-8, 8), rot: rnd(0, 6), flutter: rnd(6, 12), sway: rnd(0.02, 0.07), swayF: rnd(2.5, 5),
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      emit({
        map: T.sparkle(), x: 0, y: H, vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.4 + 0.25, drag: 2, life: rnd(0.8, 1.3),
        s0: rnd(0.07, 0.13), s1: 0.01, color: pick(PASTELS), add: true, spin: rnd(-3, 3), twinkle: 8,
      });
    }
  };

  return {
    root,
    setState(next) {
      if (next === state) return;
      state = next;
      stateTime = 0;
      acc = { work: 0, talk: 0, conf: 0, dance: 0, rain: 0, sweat: 0, heart: 0, tw: 0 };
      if (next === "celebrating") confettiBurst();
      if (next === "error") boltAt = 0.8;
    },
    setClip(file) {
      dancing = !!file && /bailetiktok|Bling|ハッピー|Kawaii/i.test(file);
    },
    update(time) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, time - last));
      last = time;
      stateTime += dt;
      const g = groupOf(state);

      // Aparición y salida de los grupos fijos.
      all.forEach((list, i) => {
        const target = i === g ? 1 : 0;
        fades[i] += (target - fades[i]) * Math.min(1, dt * 9);
        if (Math.abs(target - fades[i]) < 0.002) fades[i] = target;
        const f = fades[i];
        for (const p of list) {
          const on = f > 0.01;
          p.sprite.visible = on;
          if (!on) continue;
          const k = clamp01(f);
          const pop = k < 1 ? Math.max(0.0001, easeOutBack(k)) : 1;
          p.sprite.scale.set(p.scale[0] * pop, p.scale[1] * pop, 1);
          p.sprite.material.opacity = Math.min(1, k * 1.4) * p.base;
        }
      });

      // ── Pensando ──
      if (fades[0] > 0.01) {
        thinkTrail.forEach((p, i) => {
          const w = Math.sin(time * 2.2 + i * 0.7);
          p.sprite.position.y = (i === 2 ? BY : i === 1 ? H + 0.04 : H - 0.02) + w * 0.008 * (i + 1);
        });
        thinkDots.forEach((d, i) => {
          const w = Math.sin(time * 5 - i * 0.9);
          d.sprite.position.y = BY - 0.005 + Math.max(0, w) * 0.028;
          const s = 1 + 0.25 * Math.max(0, w);
          d.sprite.scale.multiplyScalar(s);
        });
        thinkSpark.forEach((s, i) => {
          const tw = 0.5 + 0.5 * Math.sin(time * 3.2 + i * 2);
          s.sprite.scale.multiplyScalar(0.3 + 0.7 * tw);
          s.sprite.material.rotation = time * 0.8 * (i ? -1 : 1);
        });
      }

      // ── Trabajando ──
      if (fades[1] > 0.01) {
        gearBig.sprite.material.rotation = time * 1.1;
        gearSmall.sprite.material.rotation = -time * 2.0 + 0.2;
        gearTiny.sprite.material.rotation = time * 2.9;
        loader.sprite.material.rotation = -time * 4.2;
        loaderGlow.sprite.material.opacity *= 0.55 + 0.25 * Math.sin(time * 3);
      }
      if (state === "working") {
        acc.work += dt;
        while (acc.work > 0.28) {
          acc.work -= 0.28;
          const side = Math.random() < 0.5 ? -1 : 1;
          emit({
            map: T.glyph(pick(GLYPHS)), x: side * rnd(0.16, 0.34), y: H - 0.02, vy: rnd(0.12, 0.2), sway: 0.02, swayF: rnd(2, 4),
            life: rnd(1.5, 2.1), s0: 0.12, s1: 0.16, aspect: 0.5, color: pick([LILAC, CYAN, MINT, PINK]), fadeOut: 0.6,
          });
        }
        acc.tw += dt;
        while (acc.tw > 0.16) {
          acc.tw -= 0.16;
          emit({
            map: T.sparkle(), x: rnd(-0.35, 0.35), y: H + rnd(-0.05, 0.25), life: rnd(0.5, 0.9), s0: 0.01, s1: rnd(0.04, 0.075),
            color: pick(PASTELS), add: true, spin: rnd(-2, 2), twinkle: 7, fadeOut: 0.7,
          });
        }
      }

      // ── Hablando: destellos suaves y alguna burbujita ──
      if (state === "responding") {
        acc.talk += dt;
        while (acc.talk > 0.22) {
          acc.talk -= 0.22;
          const side = Math.random() < 0.5 ? -1 : 1;
          emit({
            map: Math.random() < 0.35 ? T.bead() : T.sparkle(), x: side * rnd(0.2, 0.36), y: H - rnd(0, 0.18), vx: side * 0.03, vy: rnd(0.06, 0.14),
            life: rnd(1, 1.6), s0: 0.01, s1: rnd(0.035, 0.07), color: pick([LILAC, PINK, CYAN]), add: true, spin: rnd(-2, 2), twinkle: 5, fadeOut: 0.6,
          });
        }
      }

      // ── Permiso ──
      if (fades[2] > 0.01) {
        const bounce = Math.abs(Math.sin(time * 5.2)) * 0.012;
        alertMark.sprite.position.y = H + 0.1 + bounce;
        alertMark.sprite.material.rotation = Math.sin(time * 9) * 0.07;
        alertGlow.sprite.material.opacity *= 0.7 + 0.3 * Math.sin(time * 6);
        ringAt += dt;
        alertRings.forEach((r, i) => {
          const t = ((time * 0.9 + i * 0.5) % 1);
          const s = 0.1 + t * 0.3;
          r.sprite.scale.set(s, s, 1);
          r.sprite.material.opacity = (1 - t) * 0.75 * Math.min(1, fades[2] * 1.4);
        });
      }

      // ── Celebrando ──
      if (fades[3] > 0.01) {
        orbit.forEach((s, i) => {
          const a = time * 1.6 + (i * Math.PI * 2) / orbit.length;
          s.sprite.position.set(Math.cos(a) * 0.36, H - 0.02 + Math.sin(time * 2.4 + i * 1.3) * 0.07 + (i % 2) * 0.06, Math.sin(a) * 0.15);
          const tw = 0.55 + 0.45 * Math.sin(time * 6 + i * 2);
          s.sprite.scale.multiplyScalar(tw);
          s.sprite.material.rotation = time * (i % 2 ? 1.5 : -1.5);
        });
        // destello de entrada
        const fl = clamp01(stateTime / 0.7);
        flash.sprite.visible = stateTime < 0.7;
        const fs = 0.2 + fl * 1.1;
        flash.sprite.scale.set(fs, fs, 1);
        flash.sprite.material.opacity = (1 - fl) * 0.9;
      }
      if (state === "celebrating") {
        acc.conf += dt;
        while (acc.conf > 0.07) {
          acc.conf -= 0.07;
          emit({
            map: T.confetti(), x: rnd(-0.45, 0.45), y: H + rnd(0.05, 0.22), vy: rnd(-0.05, -0.02), ay: -0.12, drag: 0.5, life: rnd(2.2, 3.2),
            s0: rnd(0.025, 0.042), aspect: rnd(0.45, 0.8), color: pick(CONFETTI), spin: rnd(-6, 6), flutter: rnd(5, 11), sway: rnd(0.04, 0.09), swayF: rnd(2, 4.5),
          });
        }
        acc.heart += dt;
        if (acc.heart > 0.9) {
          acc.heart = 0;
          emit({ map: T.heart(), x: rnd(-0.3, 0.3), y: H - 0.05, vy: 0.18, sway: 0.05, swayF: 3, life: 2, s0: 0.01, s1: rnd(0.07, 0.1), rot: rnd(-0.3, 0.3) });
        }
        acc.tw += dt;
        while (acc.tw > 0.09) {
          acc.tw -= 0.09;
          emit({ map: T.sparkle(), x: rnd(-0.4, 0.4), y: H + rnd(-0.1, 0.25), life: rnd(0.5, 0.9), s0: 0.01, s1: rnd(0.05, 0.1), color: pick(PASTELS), add: true, spin: rnd(-2, 2), twinkle: 8, fadeOut: 0.7 });
        }
      }

      // ── Error ──
      if (fades[4] > 0.01) {
        gloomCloud.sprite.position.set(Math.sin(time * 1.3) * 0.015, H + 0.12 + Math.sin(time * 2.1) * 0.01, 0);
        boltAt -= dt;
        const flashT = boltAt < 0 && boltAt > -0.35 ? 1 - Math.abs(boltAt + 0.175) / 0.175 : 0;
        if (boltAt < -0.35) boltAt = rnd(1.4, 2.8);
        bolt.sprite.material.opacity = clamp01(flashT * 1.6) * Math.min(1, fades[4] * 1.4);
        bolt.sprite.position.x = 0.04 + Math.sin(time * 7) * 0.01;
      }
      if (state === "error") {
        acc.rain += dt;
        while (acc.rain > 0.09) {
          acc.rain -= 0.09;
          emit({ map: T.drop(), x: rnd(-0.14, 0.14), y: H + 0.05, vy: -0.08, ay: -0.9, life: 0.45, s0: 0.03, aspect: 1.3, fadeOut: 0.35, opacity: 0.85 });
        }
        acc.sweat += dt;
        if (acc.sweat > 2.4) {
          acc.sweat = 0;
          emit({ map: T.drop(), x: -0.2, y: H - 0.12, vy: 0, ay: -0.05, life: 2.2, s0: 0.03, s1: 0.06, aspect: 1.3, fadeOut: 0.3 });
          emit({ map: T.drop(), x: -0.2, y: H - 0.12, vy: -0.04, ay: -0.12, life: 2.2, s0: 0.0001, s1: 0.0001, aspect: 1.3 });
        }
      }

      // ── Baile: notas, corazones y destellos ──
      if (dancing && state === "idle") {
        acc.dance += dt;
        while (acc.dance > 0.4) {
          acc.dance -= 0.4;
          const side = Math.random() < 0.5 ? -1 : 1;
          emit({
            map: T.note(Math.random() < 0.4), x: side * rnd(0.22, 0.4), y: H - rnd(0, 0.2), vy: rnd(0.12, 0.2), sway: 0.07, swayF: rnd(2.5, 4),
            life: rnd(1.8, 2.5), s0: 0.01, s1: rnd(0.07, 0.1), color: pick([PINK, LILAC, CYAN, GOLD]), rot: rnd(-0.3, 0.3), spin: rnd(-0.6, 0.6), fadeOut: 0.5,
          });
        }
        acc.heart += dt;
        if (acc.heart > 1.5) {
          acc.heart = 0;
          emit({ map: T.heart(), x: rnd(-0.3, 0.3), y: H - 0.05, vy: 0.16, sway: 0.05, swayF: 3, life: 2.1, s0: 0.01, s1: rnd(0.06, 0.09), rot: rnd(-0.3, 0.3) });
        }
        acc.tw += dt;
        while (acc.tw > 0.2) {
          acc.tw -= 0.2;
          emit({ map: T.sparkle(), x: rnd(-0.42, 0.42), y: H + rnd(-0.2, 0.2), life: rnd(0.6, 1), s0: 0.01, s1: rnd(0.04, 0.08), color: pick(PASTELS), add: true, spin: rnd(-2, 2), twinkle: 7, fadeOut: 0.7 });
        }
      }

      // ── Integración de partículas ──
      for (const p of pool) {
        if (!p.active) continue;
        p.age += dt;
        const t = p.age / p.life;
        if (t >= 1) {
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vy = p.vy * damp + p.ay * dt;
        p.sprite.position.x += p.vx * dt + Math.cos(p.age * p.swayF + p.phase) * p.sway * dt * 2;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;
        const grow = t < 0.15 ? easeOutBack(t / 0.15) : 1;
        const size = (p.s0 + (p.s1 - p.s0) * t) * Math.max(0.0001, grow);
        const flut = p.flutter ? 0.2 + 0.8 * Math.abs(Math.cos(p.age * p.flutter + p.phase)) : 1;
        p.sprite.scale.set(size, size * p.aspect * flut, 1);
        p.sprite.material.rotation = p.rot + p.spin * p.age;
        const fadeIn = clamp01(t / 0.08);
        const out = p.fadeOut > 0 ? clamp01((1 - t) / p.fadeOut) : 1;
        const tw = p.twinkle ? 0.65 + 0.35 * Math.sin(p.age * p.twinkle + p.phase) : 1;
        p.sprite.material.opacity = fadeIn * out * p.opacity * tw;
      }
    },
  };
}
