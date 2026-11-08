// Retoques al VRM sin Blender (JSON del glb): node tools/blender/fix_hair_collisions.mjs tools/blender/backup/pelo_anime5.vrm assets/models/pelo_anime5.vrm
//  1) Colisionadores de pecho solo para el pelo de delante: la trenza ya no atraviesa el pecho ni la sudadera.
//  2) Los dos mechones traseros del lado izquierdo de la pantalla (Back_Side_R, Back_Side_1_R: tablones rígidos; Back_Side_R_Ahoge: su punta quedaba suelta fuera de la manga) se quitan de
//     la simulación y se encogen: asomaban por el hombro.
import fs from "node:fs";
const [inP, outP] = process.argv.slice(2);
const buf = fs.readFileSync(inP);
const jl = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jl).toString("utf8"));
const sa = j.extensions.VRM.secondaryAnimation;
const idx = (name) => j.nodes.findIndex((n) => n.name === name);

// 1) Esferas en el espacio del hueso Chest (frente = -Z en VRM 0.x). La sudadera llega a z≈-0,28 en el pecho.
const sph = (x, y, z, r) => ({ offset: { x, y, z }, radius: r });
sa.colliderGroups.push({
  node: idx("Chest"),
  colliders: [
    sph(0.1, 0.115, -0.044, 0.16), sph(-0.1, 0.115, -0.044, 0.16), // pecho (solo esto: unos colisionadores más altos lanzaban la trenza a la cara)
  ],
});
const front = sa.boneGroups.find((g) => g.comment === "pelo de delante");
front.colliderGroups.push(sa.colliderGroups.length - 1);

// 2) Mechones traseros
const hide = ["Back_Side_R", "Back_Side_1_R", "Back_Side_R_Ahoge"].map(idx);
const hidden = new Set(hide);
for (const g of sa.boneGroups) g.bones = g.bones.filter((b) => !hidden.has(b));
for (const n of hide) j.nodes[n].scale = [1e-4, 1e-4, 1e-4];

let js = Buffer.from(JSON.stringify(j), "utf8");
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const head = Buffer.from(buf.slice(0, 20)); head.writeUInt32LE(js.length, 12);
const out = Buffer.concat([head, js, buf.slice(20 + jl)]);
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(outP, out);
console.log("ok", hide, sa.colliderGroups.length);
