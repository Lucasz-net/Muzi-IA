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

/** Fragmento del nombre del modelo preferido; si no coincide ninguno, se usa el primero por orden alfabético. */
const PREFERRED_MODEL = "pelo_anime5";

/** URL del modelo preferido (o el primero alfabéticamente), o `null` si no hay ninguno. */
export function findModelUrl(): string | null {
  const names = Object.keys(models).sort();
  if (names.length === 0) return null;
  const chosen = names.find((n) => n.includes(PREFERRED_MODEL)) ?? names[0];
  return models[chosen];
}
