/**
 * Genera los audios de Mizu con el motor de VOICEVOX (debe estar abierto en 127.0.0.1:50021) y el manifiesto
 * que lee la app. Solo hace falta cuando se cambian las frases de `lines.mjs`; la app no usa VOICEVOX en ejecución.
 *
 *   node tools/voicevox/generate.mjs
 *
 * Salida: assets/voice/ja/<id>.wav  y  src/voice/ja/lines.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINES } from "./lines.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIO_DIR = path.join(ROOT, "assets/voice/ja");
const MANIFEST = path.join(ROOT, "src/voice/ja/lines.json");
const ENGINE = process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021";
/** 四国めたん・あまあま */
const SPEAKER = 0;

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });

const manifest = {};
let total = 0;
for (const [cat, items] of Object.entries(LINES)) {
  manifest[cat] = [];
  for (let i = 0; i < items.length; i++) {
    const [ja, es] = items[i];
    const id = `${cat}_${String(i + 1).padStart(2, "0")}`;
    const q = await (await fetch(`${ENGINE}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(ja)}`, { method: "POST" })).json();
    // Un poco más expresiva y con menos silencio al principio y al final (para que subtítulo y voz vayan pegados).
    Object.assign(q, { intonationScale: 1.15, prePhonemeLength: 0.05, postPhonemeLength: 0.15, outputSamplingRate: 24000, outputStereo: false });
    const res = await fetch(`${ENGINE}/synthesis?speaker=${SPEAKER}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q),
    });
    if (!res.ok) throw new Error(`${id}: ${res.status} ${await res.text()}`);
    const wav = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(AUDIO_DIR, `${id}.wav`), wav);
    // WAV PCM 16 bits mono a 24 kHz: 48 000 bytes por segundo (cabecera de 44 bytes).
    const ms = Math.round(((wav.length - 44) / 48000) * 1000);
    manifest[cat].push({ id, ja, es, ms, leadMs: Math.round(q.prePhonemeLength * 1000), tailMs: Math.round(q.postPhonemeLength * 1000) });
    total++;
  }
  console.log(cat, items.length);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n", "utf8");
const size = fs.readdirSync(AUDIO_DIR).reduce((s, f) => s + fs.statSync(path.join(AUDIO_DIR, f)).size, 0);
console.log(`${total} audios, ${(size / 1048576).toFixed(1)} MB`);
