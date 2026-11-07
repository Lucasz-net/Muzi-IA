import fs from "node:fs";
const [origP, newP, outP] = process.argv.slice(2);
const parse = (buf) => { const jl = buf.readUInt32LE(12); return { json: JSON.parse(buf.slice(20, 20 + jl).toString("utf8")), jl, rest: buf.slice(20 + jl) }; };
const o = parse(fs.readFileSync(origP)), n = parse(fs.readFileSync(newP));
const q = new Map(o.json.materials.map((m, i) => [m.name, o.json.extensions.VRM.materialProperties[i].renderQueue]));
let patched = 0;
n.json.materials.forEach((m, i) => {
  const mp = n.json.extensions.VRM.materialProperties[i];
  if (q.has(m.name) && mp.renderQueue !== q.get(m.name)) { mp.renderQueue = q.get(m.name); patched++; }
});
let js = Buffer.from(JSON.stringify(n.json), "utf8");
const pad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
const head = Buffer.alloc(20); fs.readFileSync(newP).copy(head, 0, 0, 20);
head.writeUInt32LE(js.length, 12);
const out = Buffer.concat([head, js, n.rest]);
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(outP, out);
console.log("patched", patched, "of", n.json.materials.length);
