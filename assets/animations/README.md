# Animaciones

Cada estado del compañero se anima por **capas**: una pose procedural (por código) siempre activa y, encima, un **clip de Mixamo** opcional por estado. Un estado sin clip usa solo la pose procedural.

## Estados

| Estado | Cuándo | Pose procedural (sin clip) |
|---|---|---|
| `idle` | Sin actividad | Respiración y balanceo suaves |
| `thinking` | El modelo razona | Cabeza ladeada, mano en la barbilla, puntos sobre la cabeza |
| `working` | Usando herramientas | Inclinado, antebrazos al frente "tecleando" |
| `waiting_permission` | Pide aprobación | Saluda con un brazo, "!" ámbar |
| `responding` | Escribiendo la respuesta | Asiente y gesticula |
| `celebrating` | Tarea terminada (~2.8 s) | Salto con brazos arriba y destellos |
| `error` | Fallo (~3.5 s) | Cabizbajo, niega con la cabeza |

## Clips de Mixamo

1. En [mixamo.com](https://www.mixamo.com) elige la animación y descárgala con **Format: FBX Binary (.fbx)**, **Skin: Without Skin**, 30 fps. No hace falta subir ningún personaje.
2. Copia el `.fbx` en esta carpeta.
3. Asígnalo a un estado en `animations.json`:

```json
{
  "idle": { "file": "Idle.fbx", "loop": true },
  "working": { "file": "Texting While Standing.fbx", "loop": true },
  "waiting_permission": { "file": "Standing Greeting.fbx", "loop": true }
}
```

- `loop: true` repite el clip mientras dure el estado; `false` lo reproduce una vez y vuelve a la pose procedural (útil para `celebrating`).
- **Variantes:** un estado puede tener una lista de clips. Cada uno suena una vez y, al acabar, pasa a otro al azar con un fundido. `weight` (por defecto 1) hace que unos salgan más que otros; así el reposo puede mezclar clips tranquilos con otros raros:

```json
"idle": [
  { "file": "Idle.fbx", "weight": 3 },
  { "file": "Look Around.fbx", "weight": 2 },
  { "file": "Kawaii Kaiwai.fbx", "weight": 1 }
]
```
- Los `.fbx` no asignados también se cargan, para probarlos a mano.
- Reinicia `npm run tauri dev` tras añadir archivos.
- Los `.fbx` **no se versionan** (ver `.gitignore`): la licencia de Mixamo no permite redistribuir las animaciones como archivos sueltos. Sí se versiona `animations.json`.

Qué hace la app: retargetea cada clip a los huesos humanoides del VRM (`src/character/mixamo.ts`) y lo mezcla con la pose procedural con una transición suave de 0,55 s, tanto de pose a clip como de clip a clip (`src/character/clipLayer.ts`). La cabeza sigue acompañando a la mirada aunque haya un clip.

Requisitos del clip: un esqueleto humanoide con T-pose mirando a +Z y huesos `mixamorig*` (lo que exporta Mixamo) o con los mismos nombres sin prefijo (`Hips`, `Spine`, `Chest`, `LeftArm`...). El clip puede llamarse `mixamo.com` o de otra forma; si hay varios, se usa el primero. Las unidades (cm o m) se compensan solas. Los clips que se desplazan (caminar) mueven la cadera y el modelo puede salirse del encuadre: para el compañero conviene usar clips "en el sitio" (*In Place*).

## Pose procedural

`src/character/procedural.ts` → `proceduralPoses.poseFor(state, t, stateTime)`. Para ajustar un movimiento, edita el `case` del estado. El `Animator` suaviza las transiciones entre poses.

## Probar en desarrollo

Abre la consola de la ventana (F12, o clic derecho sobre la ventana > Inspeccionar) y escribe `mizuHelp()` para ver esta lista con los clips cargados:

```js
mizu.force("idle")                          // idle | thinking | working | waiting_permission | responding | celebrating | error
mizuStage.listClips()                       // clips cargados
mizuStage.playClip("Kawaii Kaiwai.fbx")     // reproduce un clip a mano (tal cual el nombre del archivo)
mizuStage.playClip(null)                    // detiene el clip
mizuStage.playClip()                        // vuelve al comportamiento por estado
mizuStage.setView("full")                   // "full" cuerpo completo | "upper" plano medio
mizuStage.debug.orbit(Math.PI / 2)          // cámara de perfil; orbit(0) la restaura
mizuStage.setSpeaking(true)                 // lipsync sin audio (false para parar)
mizuSay("Hola, soy Mizu")                   // voz + lipsync
```
