/** Genera docs/FRASES_MIZU.md: todas las frases de Mizu en japonés con su traducción. `node tools/voicevox/frases.mjs` */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINES } from "./lines.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WHEN = {
  startup: "Al arrancar la app",
  attention: "Al decir «Mizu» o pulsar el micrófono con la escucha continua",
  ack: "Al enviarle un mensaje o una orden",
  thinking: "Mientras piensa",
  working: "Mientras trabaja (suelta una cada 14–28 s)",
  tool_edit: "Mientras trabaja: editando archivos",
  tool_command: "Mientras trabaja: ejecutando comandos",
  tool_search: "Mientras trabaja: buscando",
  tool_read: "Mientras trabaja: leyendo archivos",
  responding: "Al empezar a responder",
  perm_generic: "Pide permiso (genérico)",
  perm_command: "Pide permiso: ejecutar un comando",
  perm_edit: "Pide permiso: editar o escribir un archivo",
  perm_web: "Pide permiso: abrir una web o buscar",
  perm_screen: "Pide permiso: ver la pantalla",
  perm_mouse: "Pide permiso: usar el ratón",
  perm_keys: "Pide permiso: usar el teclado",
  perm_window: "Pide permiso: cambiar de ventana",
  done_ok: "Termina una tarea",
  done_rough: "Termina una tarea con problemas",
  done_long: "Termina una tarea larga (más de 90 s)",
  error: "Error",
  tests_pass: "Los tests pasan",
  tests_fail: "Los tests fallan",
  build_ok: "Compila bien (a veces)",
  build_fail: "Falla la compilación",
  git_commit: "Hace un commit (a veces)",
  git_push: "Hace un push",
  stopped: "Detienes la tarea",
  busy: "Le hablas por micrófono mientras trabaja",
  idle: "En reposo, de vez en cuando (ajuste «Charla en reposo»)",
  preview: "Al soltar el control de volumen",
};
let out = "# Frases de Mizu\n\nVoz: VOICEVOX:四国めたん (あまあま). Generadas con `node tools/voicevox/generate.mjs` a partir de `tools/voicevox/lines.mjs`.\n";
let n = 0;
for (const [cat, items] of Object.entries(LINES)) {
  out += `\n## ${WHEN[cat] ?? cat} (\`${cat}\`)\n\n| Japonés | Español |\n|---|---|\n`;
  for (const [ja, es] of items) { out += `| ${ja} | ${es} |\n`; n++; }
}
out += `\nTotal: ${n} frases.\n`;
fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "docs/FRASES_MIZU.md"), out, "utf8");
console.log(n, "frases -> docs/FRASES_MIZU.md");
