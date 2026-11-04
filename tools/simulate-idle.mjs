// Simula horas de reposo con la configuración real de assets/animations/animations.json y
// muestra cada cuánto sale cada clip, si hay repeticiones y si todos llegan a aparecer.
// Sirve para calibrar `cooldown`, `weight` y `gap` al añadir clips, sin esperar horas con la app.
//
//   npm run simulate-idle                 (3 h × 40 semillas)
//   npm run simulate-idle -- 6 100        (6 h × 100 semillas)
//
// Requiere Node 22.6+ (importa el selector real, escrito en TypeScript).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { VariantPicker } from "../src/character/variantPicker.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOURS = Number(process.argv[2] ?? 3);
const SEEDS = Number(process.argv[3] ?? 40);
const FADE_S = 0.55; // debe coincidir con clipLayer.ts
const ENTER_DELAY = [3, 8];
const RETRY_S = 6;
const DEFAULT_GAP = [12, 30];
const DEFAULT_COOLDOWN = 90;

const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/animations/animations.json"), "utf8"));
const idle = manifest.idle;
if (!Array.isArray(idle)) {
  console.error('animations.json: "idle" debe ser una lista de variantes.');
  process.exit(1);
}

// Duración real de cada clip, leída de su .fbx.
const duration = (file) => {
  const buf = fs.readFileSync(path.join(root, "assets/animations", file));
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  return fbx.animations[0].duration;
};
const clips = idle.map((c) => ({
  file: c.file,
  weight: c.weight ?? 1,
  cooldown: c.cooldown ?? DEFAULT_COOLDOWN,
  gap: c.gap ?? DEFAULT_GAP,
  d: duration(c.file),
}));
const byFile = Object.fromEntries(clips.map((c) => [c.file, c]));

// PRNG determinista (mulberry32): mismos resultados en cada ejecución.
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

function simulate(hours, seed) {
  const r = rng(seed * 7919);
  const picker = new VariantPicker(r);
  const variants = clips.map((c) => ({ file: c.file, weight: c.weight, cooldown: c.cooldown }));
  const total = hours * 3600;
  let t = ENTER_DELAY[0] + r() * (ENTER_DELAY[1] - ENTER_DELAY[0]);
  const seq = [];
  while (t < total) {
    const file = picker.pick(variants, t);
    if (file === null) {
      t += RETRY_S;
      continue;
    }
    seq.push({ file, t });
    const [a, b] = byFile[file].gap;
    t += byFile[file].d + FADE_S + a + r() * (b - a);
  }
  return { seq, total };
}

// ---- Simulación larga: frecuencia de cada clip ----
const stats = Object.fromEntries(clips.map((c) => [c.file, { n: 0, gaps: [], maxWait: 0 }]));
let picks = 0, back2back = 0, aba = 0, clipTime = 0;
for (let s = 1; s <= SEEDS; s++) {
  const { seq, total } = simulate(HOURS, s);
  picks += seq.length;
  for (let i = 0; i < seq.length; i++) {
    clipTime += byFile[seq[i].file].d;
    if (i > 0 && seq[i].file === seq[i - 1].file) back2back++;
    if (i > 1 && seq[i].file === seq[i - 2].file && seq[i].file !== seq[i - 1].file) aba++;
  }
  for (const c of clips) {
    const times = seq.filter((x) => x.file === c.file).map((x) => x.t);
    const st = stats[c.file];
    st.n += times.length;
    const gaps = times.slice(1).map((v, i) => v - times[i]);
    st.gaps.push(...gaps);
    st.maxWait = Math.max(st.maxWait, times.length ? Math.max(times[0], total - times[times.length - 1], ...gaps) : total);
  }
}
const H = HOURS * SEEDS;
console.log(`Reposo simulado: ${HOURS} h × ${SEEDS} semillas = ${H} h`);
console.log(`Elecciones/h: ${(picks / H).toFixed(1)} | clip sonando: ${((100 * clipTime) / (H * 3600)).toFixed(0)} % del tiempo`);
console.log(`Mismo clip dos veces seguidas: ${back2back} | patrón A-B-A: ${aba} (${((100 * aba) / picks).toFixed(1)} %)\n`);
const pad = (v, n) => String(v).padStart(n);
console.log("clip".padEnd(28), pad("dur (s)", 8), pad("veces/h", 8), pad("cada (min)", 11), pad("máx sin salir", 14));
for (const c of clips) {
  const st = stats[c.file];
  const every = st.gaps.length ? (st.gaps.reduce((a, b) => a + b, 0) / st.gaps.length / 60).toFixed(1) : "-";
  console.log(c.file.padEnd(28), pad(c.d.toFixed(1), 8), pad((st.n / H).toFixed(1), 8), pad(every, 11), pad((st.maxWait / 60).toFixed(0) + " min", 14));
}

// ---- Cobertura: ¿se ve cada clip al menos una vez en una sesión de N horas? ----
console.log("\nProbabilidad de ver cada clip al menos una vez en una sesión de reposo de:");
const sessions = [0.5, 1, 2];
console.log("clip".padEnd(28), ...sessions.map((h) => pad(h + " h", 7)));
const seen = Object.fromEntries(clips.map((c) => [c.file, sessions.map(() => 0)]));
const N = Math.max(SEEDS, 200);
sessions.forEach((h, k) => {
  for (let s = 1; s <= N; s++) {
    const files = new Set(simulate(h, s + 1000).seq.map((x) => x.file));
    for (const f of files) seen[f][k]++;
  }
});
for (const c of clips) console.log(c.file.padEnd(28), ...seen[c.file].map((n) => pad(((100 * n) / N).toFixed(0) + " %", 7)));
