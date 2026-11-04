# Modelos

Coloca aquí tu modelo `.vrm` (VRM 1.0 recomendado; VRM 0.x también se carga). La app usa el **primero por orden alfabético**; si no hay ninguno, muestra un personaje de relleno.

- Los `.vrm` **no se versionan** (ver `.gitignore`).
- Tras añadir o cambiar el archivo, reinicia `npm run tauri dev`.
- El modelo debe tener los huesos humanoides estándar. Para la expresividad usa las expresiones VRM: `blink` (parpadeo), `aa/ih/ou/ee/oh` (lipsync), `happy`, `sad`, `surprised` y `relaxed` (según el estado). Los modelos de VRoid Studio las incluyen.
- Peso: los modelos con muchas texturas de 2048×2048 consumen más RAM/GPU (el de ejemplo, ~20 MB, ronda 1,2 GB en total entre los procesos de la app). Si quieres reducirlo, exporta con texturas de 1024.
