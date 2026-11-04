import type { CompanionState } from "../core/stateMachine";
import type { ClipEntry } from "./clipLayer";

/**
 * Animaciones de Mixamo del usuario en `assets/animations/*.fbx` y su asignación a estados en
 * `assets/animations/animations.json`:
 *
 *   {
 *     "waiting_permission": { "file": "Standing Greeting.fbx", "loop": true },
 *     "idle": [ { "file": "Idle.fbx", "weight": 3 }, { "file": "Kawaii Kaiwai.fbx" } ]   // variantes al azar
 *   }
 *
 * Con una lista, cada clip se reproduce una vez ("loop": false) y al acabar pasa a otro al azar.
 *
 * Los .fbx no se versionan (licencia de Mixamo); sin ellos se usan las poses procedurales.
 */
const fbxUrls = import.meta.glob<string>("/assets/animations/*.fbx", {
  query: "?url",
  import: "default",
  eager: true,
});
type ClipConfig = { file: string; loop?: boolean; weight?: number };
const manifests = import.meta.glob<Partial<Record<CompanionState, ClipConfig | ClipConfig[]>>>(
  "/assets/animations/animations.json",
  { import: "default", eager: true },
);

const urlByFile = new Map<string, string>(
  Object.entries(fbxUrls).map(([path, url]) => [path.split("/").pop()!, url]),
);

export function findClipEntries(): ClipEntry[] {
  const manifest = Object.values(manifests)[0] ?? {};
  const entries: ClipEntry[] = [];
  for (const [state, value] of Object.entries(manifest)) {
    for (const cfg of Array.isArray(value) ? value : value ? [value] : []) {
      const url = urlByFile.get(cfg.file);
      if (!url) {
        console.warn(`animations.json: no se encuentra "${cfg.file}" (estado ${state})`);
        continue;
      }
      entries.push({ state: state as CompanionState, file: cfg.file, url, loop: cfg.loop ?? false, weight: cfg.weight });
    }
  }
  // Los .fbx que no están asignados a ningún estado también se cargan, para poder probarlos a mano.
  for (const [file, url] of urlByFile) {
    if (!entries.some((e) => e.file === file)) entries.push({ state: null, file, url, loop: false });
  }
  return entries;
}
