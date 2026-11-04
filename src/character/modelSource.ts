/**
 * Localiza el modelo VRM del usuario en `assets/models/*.vrm`. Vite resuelve la lista en
 * tiempo de compilación (en desarrollo y en el build). Si no hay ninguno, se usa el placeholder.
 * Los `.vrm` no se versionan (ver .gitignore).
 */
const models = import.meta.glob<string>("/assets/models/*.vrm", {
  query: "?url",
  import: "default",
  eager: true,
});

/** URL del primer modelo (orden alfabético), o `null` si no hay ninguno. */
export function findModelUrl(): string | null {
  const names = Object.keys(models).sort();
  return names.length > 0 ? models[names[0]] : null;
}
