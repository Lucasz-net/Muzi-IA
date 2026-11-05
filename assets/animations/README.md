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
- **Variantes:** un estado puede tener una lista de clips. Cada uno suena una vez; al acabar, la figura vuelve a su pose procedural (que respira y cambia el peso de pierna) y **descansa** antes del siguiente. Por clip:
  - `weight` (por defecto 1): probabilidad relativa frente a las demás variantes.
  - `cooldown` (segundos, por defecto 90): tiempo mínimo antes de que ese mismo clip pueda volver a salir. En la práctica vuelve a los ~1,2-1,5 × ese valor.
  - `gap` (`[mín, máx]` en segundos, por defecto `[12, 30]`): descanso tras acabar ese clip. Al entrar en el reposo también hay un respiro de 3-8 s.

  El selector (`src/character/variantPicker.ts`) evita repetir el mismo clip, evita los patrones A-B-A y refuerza a los que llevan mucho sin salir, de modo que **ninguno se queda sin aparecer**. Los bailes llevan un `cooldown` largo para que salgan de tarde en tarde:

```json
"idle": [
  { "file": "Idle.fbx", "weight": 3, "cooldown": 68, "gap": [8, 20] },
  { "file": "Kawaii Kaiwai.fbx", "weight": 1, "cooldown": 450, "gap": [25, 50] },
  { "file": "bailetiktok.fbx", "weight": 1, "cooldown": 4500, "gap": [60, 120] }
]
```

  Con estos valores `Kawaii` sale cada ~8 min y cada baile cada ~1 h, pero en una sesión de 1 h de reposo todos aparecen. Para calibrar sin esperar horas: `npm run simulate-idle` (ver `COMANDOS_ANIMACIONES.txt`).
- Los `.fbx` no asignados también se cargan, para probarlos a mano.
- Reinicia `npm run tauri dev` tras añadir archivos.
- Los `.fbx` **no se versionan** (ver `.gitignore`): la licencia de Mixamo no permite redistribuir las animaciones como archivos sueltos. Sí se versiona `animations.json`.

Qué hace la app: retargetea cada clip a los huesos humanoides del VRM (`src/character/mixamo.ts`) y lo mezcla con la pose procedural con una transición suave de 0,55 s, tanto de pose a clip como de clip a clip (`src/character/clipLayer.ts`). La cabeza sigue acompañando a la mirada aunque haya un clip.

**Los clips solo mueven el cuerpo y la cabeza** (rotaciones de huesos y la posición de las caderas): ninguno toca la cara, así que el parpadeo, las expresiones, el lipsync y la mirada de los ojos siguen siendo cosa de la app. Algunos clips traen pistas de los huesos de los ojos (`LeftEye`/`RightEye`); se ignoran a propósito para que no peleen con la mirada.

Requisitos del clip: un esqueleto humanoide con T-pose mirando a +Z y huesos `mixamorig*` (lo que exporta Mixamo) o con los mismos nombres sin prefijo (`Hips`, `Spine`, `Chest`, `LeftArm`...). El clip puede llamarse `mixamo.com` o de otra forma; si hay varios, se usa el primero. Las unidades (cm o m) se compensan solas. Los clips que se desplazan (caminar) mueven la cadera y el modelo puede salirse del encuadre: para el compañero conviene usar clips "en el sitio" (*In Place*).

## Pose procedural

`src/character/procedural.ts` → `proceduralPoses.poseFor(state, t, stateTime)`. Para ajustar un movimiento, edita el `case` del estado. El `Animator` suaviza las transiciones entre poses.

## Probar en desarrollo

La lista completa de comandos está en **`COMANDOS_ANIMACIONES.txt`** (raíz del proyecto).

Abre la consola de la ventana (F12, o clic derecho sobre la ventana > Inspeccionar) y escribe `mizuHelp()` para ver esta lista con los clips cargados:

```js
mizu.force("idle")                          // idle | thinking | working | waiting_permission | responding | celebrating | error
mizuStage.listClips()                       // clips cargados
mizuStage.playClip("Kawaii Kaiwai.fbx")     // reproduce un clip a mano (tal cual el nombre del archivo)
mizuStage.playClip(null)                    // detiene el clip y desactiva los clips por estado hasta llamar playClip()
mizuStage.playClip()                        // vuelve al comportamiento por estado
mizuStage.setView("full")                   // "full" cuerpo completo | "upper" plano medio
mizuStage.debug.orbit(Math.PI / 2)          // cámara de perfil; orbit(0) la restaura
mizuStage.setSpeaking(true)                 // lipsync sin audio (false para parar)
mizuSay("Hola, soy Mizu")                   // voz + lipsync
mizuStage.gesture("wink")                  // gesto hecho con código (ver abajo)
```

## Gestos hechos con código

`src/character/gestures.ts` define gestos que no usan ningún clip. Combinan expresiones faciales del VRM, movimientos de cabeza, hombros y torso, hacia dónde mira y, para los de mano, brazo, muñeca y **cada falange de los dedos**. Se suman a lo que ya hagan el estado, la mirada y los clips. Se lanzan a mano con `mizuStage.gesture("nombre")` y, en reposo, también solos (ver más abajo).

| Gesto | Qué hace |
|---|---|
| `wink` / `winkLeft` / `winkRight` | Guiño (al azar, o de un ojo concreto) con media sonrisa |
| `smile` / `laugh` | Sonrisa suave / risa completa |
| `surprised` | Ojos muy abiertos y la cabeza hacia atrás |
| `sleepy` | Cara de sueño: los ojos se cierran despacio |
| `shy` | Sonrisita con la cabeza baja y ladeada |
| `pout` | Puchero: boca fruncida, ceño suave y mira hacia otro lado |
| `lookUp` | Pensativa: mira hacia arriba y a un lado |
| `sigh` | Suspiro: los hombros suben y caen, mirada baja |
| `yawn` | Bostezo: boca muy abierta, ojos cerrándose, cabeza atrás |
| `tilt` / `nod` / `shake` | Ladear la cabeza / asentir / negar |
| `stretch` | Estirarse: cada brazo con su propia curva (el segundo va un poco por detrás), codos sin bloquear, torso arqueado, bostezo y exhalación al soltar |
| `fingerHeart` | **Corazón coreano** junto a la mejilla (índice y pulgar cruzados en X) con un guiño y un **corazón rojo** que flota sobre la mano (`heart.ts`) |
| `peace` | Signo de la paz junto a la cara |
| `thumbsUp` | Pulgar arriba |
| `catPaws` | Zarpitas de gato: puños sueltos junto a las mejillas que "amasan" a contratiempo |

Los gestos de un solo brazo usan el derecho o el izquierdo al azar: se definen una vez para el derecho y se reflejan.

### Cara durante los clips

Los clips no mueven la cara, así que se le suma por código. En `animations.json`, cada clip puede llevar un campo `face`:

```json
{ "file": "Kawaii Kaiwai.fbx", "face": {
    "mood": { "happy": 0.5 },
    "cues": [ { "name": "wink", "every": [6, 11] }, { "name": "laugh", "at": [20.5] } ] } }
```

- `mood`: expresiones VRM de fondo mientras suena el clip (entran y salen con él).
- `cues`: gestos de **cara y cabeza** de la tabla anterior (`wink`, `smile`, `laugh`, `shy`, `surprised`...; no uses los de brazos). `every: [mín, máx]` los lanza al azar cada tantos segundos de clip y `at: [s, ...]` en instantes fijos, para sincronizarlos con un paso concreto.

Ya lo llevan los cinco bailes, con los guiños y risas **sincronizados con la coreografía**: los instantes (`at`) se hallaron analizando el movimiento de cada clip (energía angular de cabeza, torso y brazos) y buscando las pausas y poses marcadas, que es donde queda bien un guiño. Por ejemplo, en `Kawaii Kaiwai` guiña a los 5,4 s y a los 12,7 s y ríe en el remate (18,8 s). Para sincronizar un clip nuevo, reproduce el clip y anota en qué segundo cae cada paso (`mizuStage.debug.character().clips.playTime` da el segundo actual). Código: `VrmCharacter.clipFace`.

### Gestos automáticos en reposo

Mientras el personaje está en `idle` **y no suena ningún clip**, lanza un gesto al azar cada 14-38 s de reposo procedural (el reloj solo corre en esos ratos, así que quedan muy espaciados). Las probabilidades están en `IDLE_GESTURES` (`gestures.ts`): los vistosos, como el corazón coreano, salen menos que una sonrisa. Para ajustarlos o apagarlos: panel de **Ajustes** del menú (ninguno / pocos / normal / muchos). En desarrollo también `mizuStage.setGestureLevel("pocos")` o `mizuStage.debug.character().autoGestures = false`.

Al hablar, la cabeza también acompaña al habla con pequeños cabeceos.

### Añadir o ajustar un gesto de mano

Agrega una entrada a `DEFS` con su duración y una función que, dado el tiempo `t`, devuelva el peso de cada expresión, el giro de cabeza, el torso, hacia dónde mira y, si lleva brazo, un `ArmGesture` (`pitch`, `roll`, `elbow`, `twist` del antebrazo, `wrist` y `fingers`, la rotación de cada falange).

Las poses de mano son difíciles de acertar a ojo. Para ajustarlas en vivo, en la consola de la ventana:

```js
// Fija el brazo derecho a una pose (peso 1) hasta que lo sueltes:
mizuStage.debug.character().holdBody({ right: { pitch: 0.85, roll: 0.4, elbow: 2.05, twist: -0.35,
  fingers: { IndexProximal: [0, 0, 0.4], ThumbProximal: [0.35, 0, 0.2] } } })
mizuStage.debug.character().holdBody(null)   // suelta la pose
// Acerca la cámara a la mano para verla (mizuStage.setView("full") la restaura):
const c = mizuStage.debug.camera(); c.position.set(0.1, 1.3, 0.6); c.lookAt(0.1, 1.3, 0)
```

Cada falange es `[x, y, z]` en radianes; `z` positivo la dobla hacia la palma. El corazón coreano se resolvió así: se fijó el brazo y se buscó numéricamente el pulgar y el índice con las puntas a 0,03 cm. Con otro modelo VRM habrá que reajustar los ángulos.


## Encuadre y espacio

La franja central de la ventana (540 px) está dimensionada midiendo hasta dónde llegan manos, cabeza y pies en todos los clips: en **cuerpo completo** el más ancho usa el 87 % del lienzo. En **plano medio** la cámara está más cerca y los clips con gestos muy amplios (bailes, `Kawaii Kaiwai`) pueden recortarse por los lados.
