# Mizu-IA

Compañero de escritorio estilo VTuber: un personaje 3D (VRM) que vive en tu pantalla y es la interfaz gráfica de una IA de terminal (Claude Code primero; Codex, Gemini CLI, etc. después).

Funciona con tu **suscripción** (p. ej. Claude Pro): la app lanza el CLI oficial ya autenticado y le quita `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` del entorno para que nunca facture por API.

> Estado: fases 1–5 hechas (ventana, conexión con Claude Code, estados y animaciones, modelo VRM con parpadeo/mirada/lipsync, voz y permisos).

## Requisitos (Windows)

- Node.js 20+ y npm
- Rust (toolchain `stable-x86_64-pc-windows-msvc`)
- Visual Studio Build Tools con "Desktop development with C++"
- WebView2 Runtime (incluido en Windows 11)
- Claude Code CLI instalado y con sesión iniciada (`claude` en el PATH)
- Para la voz: una voz en español instalada en Windows (Configuración → Hora e idioma → Voz)

## Desarrollo

```bash
npm install
npm run tauri dev
```

La primera compilación de Rust tarda unos minutos. Si `tauri dev` dice que el puerto 1420 está ocupado, queda una instancia anterior: ciérrala (`mizu-ia.exe` y el `node` de Vite).

Herramientas de desarrollo: clic derecho en la ventana → Inspeccionar. En la consola:

```js
mizu.force("celebrating")   // idle, thinking, working, waiting_permission, responding, celebrating, error
mizuSay("Hola")             // prueba la voz
```

## Uso

- El menú está plegado: solo se ve un punto discreto (⋮) junto al personaje. Púlsalo para desplegar los iconos (se pliega solo a los 5 s) o arrástralo para mover la ventana. También puedes arrastrar desde el personaje.
- Iconos del menú: chat, carpeta de trabajo (por defecto tu carpeta personal; cambiarla inicia una conversación nueva), historial (con "Nueva conversación"), **micrófono**, voz, **zoom** (alterna plano medio / cuerpo completo; se recuerda entre sesiones) y cerrar. Mientras hay una tarea aparece aparte un botón rojo para detenerla.
- El chat está oculto: ábrelo con el icono de chat. Enter envía (Shift+Enter = salto de línea), Escape lo cierra.
- La respuesta sale en un globo junto al personaje, con formato (negrita, código, listas). Siempre aparece hacia el centro de la pantalla: si arrastras el personaje al borde izquierdo, el globo pasa a la derecha, y viceversa.
- Cuando Claude necesita permiso aparece una tarjeta con **Aceptar / Rechazar**.
- Configuración persistida en la carpeta de configuración de la app (`config.json`: `adapter`, `cwd`, `command`, `permission_mode`).

## Arquitectura

```
src-tauri/src/
  window.rs            Posición, click-through (emite cursor-moved, comando set_click_through)
  commands.rs          Comandos de Tauri (agent_send, agent_respond_permission, ...)
  agent/mod.rs         Eventos normalizados + traits AgentAdapter / EventParser
  agent/claude_code.rs Adaptador de Claude Code (stream-json)
  agent/process.rs     Proceso hijo: spawn, hilos stdout/stderr, cierre
src/
  core/                events.ts, bridge.ts, stateMachine.ts, clickThrough.ts
  character/           scene, animator, procedural (poses), placeholder, types
  ui/                  chatInput, speechBubble, historyPanel, permissionPrompt
  voice/               tts.ts (TTSProvider), webSpeechProvider.ts, announcer.ts
assets/models/         Tu modelo .vrm
assets/animations/     Clips por estado (ver su README)
```

Flujo: el CLI emite JSON por stdout → el adaptador lo convierte en `AgentEvent` → evento de Tauri `agent-event` → `stateMachine` (animación), `announcer` (voz), bubble, historial y permisos.

### Eventos normalizados

`session_started`, `idle`, `thinking`, `tool_use`, `tool_result`, `waiting_permission`, `message` (con `is_delta`), `done`, `error`.

### Permisos

Cada petición muestra una tarjeta con **Rechazar / Siempre / Aceptar**. «Siempre» acepta y recuerda una regla **estrecha** para no volver a preguntar lo mismo (`core/permissionRules.ts`):

- Comandos: el comienzo del comando, el programa y su primer argumento (`git status`, `npm test`, `Start-Process steam://rungameid/730`). Solo vale para comandos **simples**: si encadenan algo (`;`, `&&`, `||`, `|`, redirecciones, subcomandos) se pregunta siempre, así que la regla de `git status` no aprueba `git status && rm -rf …`.
- Edit/Write: archivos dentro de esa carpeta. WebFetch: ese dominio. WebSearch: cualquiera.
- **Nunca ofrece «Siempre»** para comandos destructivos o de sistema (`rm`, `del`, `Remove-Item`, `format`, `shutdown`, `sudo`, `reg`, `git push --force`, `git reset --hard`, `iex`, `Set-ExecutionPolicy`...), ni para rutas del sistema (Windows, Program Files, `.ssh`...). Esos se preguntan cada vez.
- Un permiso recordado se aprueba solo, sin tarjeta, gesto ni aviso. Se guardan en `localStorage["mizu.permRules"]`.
- El icono del **escudo** del menú lista lo recordado: se puede olvidar uno a uno o todo («Olvidar todos»).

Se lanza el CLI con `--permission-prompt-tool stdio`: el CLI manda un `control_request` (`can_use_tool`) y la app responde con un `control_response` (allow con `updatedInput`, o deny con mensaje). No hace falta ningún servidor MCP.

### Micrófono (voz a texto)

El icono del micrófono del menú **escucha**: lo pulsas, hablas y, cuando dejas de hablar (~1 s de silencio), transcribe y envía el mensaje al agente como si lo hubieras escrito. Pulsarlo de nuevo mientras escucha corta la grabación en el acto. Mientras escucha, el icono pulsa en rojo y el globo dice "Escuchando…".

- Motor: **Whisper base** (multilingüe) ejecutándose dentro de la propia app con transformers.js (`src/voice/whisperProvider.ts`, interfaz en `stt.ts`). Sin servidor y sin mandar tu audio a nadie. La primera vez descarga el modelo (~139 MB con WebGPU, ~73 MB en CPU; el globo muestra el avance) y queda en la caché de la ventana.
- Corre en la **tarjeta gráfica (WebGPU)**, unas 3 veces más rápido que la CPU: la transcripción de una frase es casi instantánea y la orden sale justo al terminar el silencio. Esa variante (fp16) pesa ~139 MB y se descarga la primera vez; se calienta al cargar. Si no hay WebGPU o falla, vuelve sola a la CPU (variante q8 de ~73 MB, con varios hilos gracias al aislamiento de origen cruzado: cabeceras COOP/COEP en `vite.config.ts` y `tauri.conf.json`). En desarrollo, `mizuStt.backend` dice cuál se está usando.
- El micrófono se ignora si hay una tarea en curso, y corta la voz del personaje para que no se oiga a sí misma.
- Whisper inventa frases ("Subtítulos por…") cuando solo oye ruido; se filtran.
- Si Windows pide permiso para el micrófono, hay que concederlo.
- El runtime de onnxruntime que usa Whisper va **empaquetado** en la app (no se pide a ninguna CDN): una vez descargado el modelo, la escucha funciona sin internet.

#### Escucha continua: di «Mizu»

El icono de la **oreja** deja el micrófono abierto y atento. Solo se hace caso a lo que **empieza por "Mizu"**; el resto (la tele, una llamada, una charla) se transcribe en local, se descarta y no sale de la app.

- "Mizu, abre Steam y ejecuta CS2" → se envía "abre Steam y ejecuta CS2" al agente.
- Solo "Mizu" → ladea la cabeza y se queda atenta ~8 s: la frase siguiente se acepta sin repetir el nombre. Pulsar el micrófono del menú equivale a decir "Mizu".
- Tras hablar ella, la conversación queda abierta ~8 s para que contestes sin decir el nombre.
- "Mizu, para" (también "detente", "cancela", "basta"...) detiene la tarea en curso. Con una tarea en marcha, lo demás espera.
- Mientras habla no escucha, para no oírse a sí misma.
- El estado se recuerda: si estaba encendida al cerrar, se retoma al arrancar.
- "Mizu, para" funciona aunque Whisper lo escriba pegado ("Mezupara").
- Whisper escribe el nombre de muchas formas (Misu, Mizo, Mezmo...): `WAKE_WORD` en `whisperProvider.ts` acepta una familia de grafías, y una frase de una sola palabra parecida a "Mizu" también cuenta. En desarrollo, `mizuStt.heard` lista lo último que oyó y si lo aceptó.
- Las órdenes que abren programas pasan por el flujo de permisos de siempre (Aceptar / Rechazar).
- Retardo: ~1 s entre que terminas de hablar y que empieza a trabajar (0,9 s de silencio + transcripción en la GPU).

### Reacciones al trabajo real

`core/reactions.ts` interpreta lo que hace el agente y el personaje reacciona con un gesto y, a veces, una frase corta (como máximo una cada 8 s):

| Qué pasa | Reacción |
|---|---|
| Tests que pasan (`npm test`, `pytest`, `cargo test`...) | Pulgar arriba, corazón coreano o sonrisa + "Pasaron los N tests" |
| Tests que fallan | Sorpresa o suspiro + "Fallaron N pruebas" |
| Compila / no compila (`build`, `tsc`, `cargo build`...) | Asentir o sonrisa / suspiro + "Hay errores de compilación" |
| `git commit` / `git push` | Asentir / pulgar arriba + "Subido al repositorio" |
| Un comando o edición falla | Sorpresa (solo las dos primeras veces por turno) |
| Pide un permiso | Ladea la cabeza |
| Piensa más de 10 s | Mira hacia arriba |
| Termina la tarea | Gesto alegre (o tímido/suspiro si hubo tropiezos); si fue larga, a veces se estira; si acaba con una pregunta, ladea la cabeza |

El clasificador (`classifyToolResult`) mira el comando y la salida de las herramientas Bash/PowerShell. En desarrollo: `mizuReact.handle({...evento})` para probarlo.

### Voz

El personaje habla al terminar una tarea (si usó herramientas o tardó 6 s o más), al pedir un permiso, ante errores y al reaccionar al trabajo (tests, compilación, git). Solo dice frases cortas; no lee las respuestas. Lógica en `voice/announcer.ts`.

La voz es **Piper** con **Daniela** (`es_AR-daniela-high`, femenina, calidad "high", español latinoamericano), neuronal y local: `voice/piperProvider.ts`. La primera vez descarga el modelo (~109 MB desde Hugging Face, en segundo plano al arrancar) y queda en la caché de la ventana; mientras no esté listo (o si el navegador bloquea el audio) habla la voz de Windows. Trocea por frases y la inferencia corre en un worker, así que la ventana y el personaje no se congelan: la primera frase suena en menos de 1 s. La boca se mueve con una pulsación por palabra.

#### Lectura de respuestas

Mizu no solo da avisos: **lee sus respuestas en voz alta** (`voice/narrator.ts`). El ajuste está en el panel de **Ajustes** (icono de los deslizadores del menú):

| Ajuste | Qué hace |
|---|---|
| **Solo avisos** | Como antes: "terminé", permisos y errores |
| **Resumen** (por defecto) | Al terminar el turno dice las primeras frases de la respuesta final (hasta ~3 frases) y avisa de que el resto está en pantalla |
| **Completa** | Va diciendo cada frase según llega la respuesta, sin esperar al final |

- Antes de hablar se limpia el markdown (`voice/speakable.ts`): no se leen los bloques de código, las tablas ni las URLs ("un enlace"); las rutas pasan a ser el nombre del archivo ("main.ts" → "main punto te ese"); se quitan emojis, viñetas y símbolos. Si se dejó algo fuera añade "El resto está en pantalla."
- Las frases se encolan (`TTSProvider.enqueue`): suenan seguidas, sin cortes ni huecos, mientras la respuesta aún llega. Un permiso, en cambio, interrumpe lo que esté leyendo.
- Si el turno tuvo tropiezos la lectura es serena (`calma`); y el "terminé" se omite cuando ya está contando el resultado.
- Escribir un mensaje, hablarle o pulsar detener corta la lectura.
- El **botón del altavoz del globo** (aparece al pasar el ratón por el globo) lee la respuesta que se ve, entera y sea cual sea el ajuste; pulsarlo mientras habla la corta.

#### Ajustes

El panel de ajustes (`ui/settingsPanel.ts`, valores en `core/settings.ts`, guardados en `localStorage["mizu.settings"]`) tiene:
- **Lectura de respuestas:** solo avisos / resumen / completa.
- **Gestos en reposo:** ninguno / pocos (cada ~30-80 s) / normal (14-38 s) / muchos (5-17 s). Controla con qué frecuencia hace guiños, estiramientos o el corazón coreano cuando no hay nada que hacer.

Los tres paneles laterales (historial, permisos recordados y ajustes) comparten sitio: abrir uno cierra los otros.

#### Ánimo automático

Cada frase se dice con un ánimo que se elige solo según lo que pasa (`Mood` en `tts.ts`); Piper lo traduce a variación, ritmo y estabilidad (`MOOD_SCALES` en `piperProvider.ts`):

| Ánimo | Cuándo | Cómo suena |
|---|---|---|
| `alegre` | Tests que pasan, `git push`, "terminé" sin tropiezos | Entonación marcada y algo más rápida |
| `calma` | Tests o compilación que fallan, errores, "terminé" tras tropiezos | Serena, regular y más lenta |
| `atenta` | Al pedir un permiso | Un punto más expresiva, sin prisa |
| `neutral` | El resto | La voz de siempre |

Con tropiezos en el turno, el aviso de "terminé" también cambia de frase ("Terminé, pero hubo problemas por el camino…"). Para ajustar un ánimo, edita `MOOD_SCALES` (valores [variación, ritmo, estabilidad]; ritmo < 1 = más rápido). En desarrollo: `mizuTts.speak("texto", { mood: "alegre" })`.

#### Pronunciación

`voice/pronunciation.ts` reescribe antes de hablar las palabras en inglés, marcas y siglas como las diría un hispanohablante: "Steam" → "Estím", "GitHub" → "Guithab", "API" → "a pe i", "CS2" → "ce ese 2", "16 GB" → "16 gigas". Las siglas desconocidas (2-4 mayúsculas) se deletrean. Solo afecta a lo que se dice; el texto de pantalla no cambia. Para añadir una palabra, agrégala a `WORDS`.

## Estilo de la interfaz

Toda la interfaz está en `src/style.css`, con un estilo discreto y moderno: superficies violeta grafito, acento lila (a juego con el pelo y la chaqueta del personaje), bordes finos, sombras suaves, botones "fantasma" y animaciones cortas. Los colores son variables al principio del archivo (`:root`: `--surface`, `--accent`, `--ok`, `--danger`...): cambiar la paleta entera es cambiar esas líneas.

**El globo sigue a la cabeza.** `character/scene.ts` proyecta la cabeza del personaje a píxeles de la ventana en cada fotograma y publica `--head-x`, `--head-y` y `--head-r` (posición y radio) en `<html>`. El globo de diálogo, las tarjetas de permiso y la barra de chat se anclan con ellas: su borde interior queda a `--dock-gap` del centro de la cabeza, así que siempre están pegados al personaje, en plano medio o en cuerpo completo, y la colita del globo apunta a la cara. El globo se ajusta a su contenido (hasta `--bubble-w`) y deja libre en la base el hueco que necesitan el chat y los permisos (`--reserve`).

Los indicadores flotantes (puntos al pensar, "!" al pedir permiso) son pequeños y de colores suaves (`character/indicators.ts`, constante `K` para su tamaño).

## Agregar un adaptador (otro CLI)

1. Crea `src-tauri/src/agent/<nombre>.rs` con una struct que implemente `AgentAdapter`:
   - `spawn_spec`: ejecutable, argumentos y variables de entorno a quitar.
   - `encode_user_message` y `encode_permission_response`: líneas que se escriben en stdin.
   - `new_parser`: devuelve un `EventParser` que convierte cada línea de stdout en `AgentEvent`.
2. Declara el módulo en `agent/mod.rs` y regístralo en `adapter_for`.
3. Pon su id en `adapter` del `config.json`.

El resto (proceso, eventos, frontend) no cambia.

## Cambiar el motor de voz

Implementa `TTSProvider` (`src/voice/tts.ts`) —por ejemplo Kokoro o ElevenLabs— y úsalo en `main.ts` en lugar de `createPiperTTS(createTTS())`. `onBoundary` está pensado para el lipsync. Hoy: Piper (Daniela) con la voz de Windows (`webSpeechProvider.ts`) como respaldo. Probadas y descartadas por ahora: `es_ES-sharvard-medium` (suena peor que Daniela) y Kokoro `ef_dora` (la única voz femenina española de Kokoro; en CPU tarda más que la duración del audio).

## Agregar un modelo

Coloca tu `.vrm` en `assets/models/` (se usa el primero por orden alfabético; sin ninguno, se muestra un personaje de relleno) y reinicia `npm run tauri dev`. Detalles y requisitos en `assets/models/README.md`. Los `.vrm` no se versionan.

Qué hace la app con el modelo (`src/character/vrmCharacter.ts`):

- **Animaciones de Mixamo:** si colocas `.fbx` en `assets/animations/` y los asignas a estados en `animations.json`, se retargetean al VRM y se mezclan con la pose procedural (ver `assets/animations/README.md`). Todos los comandos de prueba están en `COMANDOS_ANIMACIONES.txt`.
- **Gestos con código:** guiño, sonrisa, risa, sorpresa, sueño, puchero, suspiro, bostezo, estirarse, **corazón coreano**, paz, pulgar arriba, zarpitas de gato... Se lanzan solos en reposo, muy espaciados, y se prueban con `mizuStage.gesture("fingerHeart")` (ver `assets/animations/README.md`).
- **Reposo vivo:** la pose procedural respira, cambia el peso de pierna con los pies plantados y mantiene brazos y dedos relajados; entre clips descansa un rato al azar.
- **Poses por estado:** una `Pose` abstracta (cuerpo, cabeza, brazos, codos) se aplica a los huesos humanoides normalizados. Los valores están en `src/character/procedural.ts`.
- **Expresiones:** `happy` al celebrar, `sad` en error, `surprised` al pedir permiso, `relaxed` en reposo.
- **Parpadeo** automático (`blink`), **mirada** con vida propia (en reposo alterna al azar entre mirar alrededor girando la cabeza, mirar de frente y seguir el cursor un rato; con actividad mira de frente) y **lipsync** (`aa/ih/ou/ee/oh`) mientras habla la voz.
- **Vista:** plano medio por defecto (de medio muslo hacia arriba, con el borde inferior difuminado) o cuerpo completo.
- **Click-through por silueta:** se lee el alfa del píxel renderizado bajo el cursor.
- **Rendimiento:** render limitado a 30 fps (`TARGET_FPS` en `scene.ts`) y bitmaps de texturas liberados tras subirlos a la GPU.

Depurar animaciones desde la consola de la ventana (solo desarrollo): escribe `mizuHelp()` para ver los comandos (`mizu.force("thinking")`, `mizuStage.playClip("Kawaii Kaiwai.fbx")`, `mizuStage.setView("upper")`...). Detalle en `assets/animations/README.md`.

## Ventana y click-through

La ventana (1180 px) es simétrica: franja de diálogo | personaje | franja de diálogo. El personaje queda siempre en el centro y el diálogo ocupa una de las franjas (`ui/layout.ts` elige el lado). `--zone` en `src/style.css` y `SIDE_ZONE` en `src-tauri/src/window.rs` deben coincidir. Por defecto la franja derecha, vacía, queda fuera de la pantalla.

La ventana es transparente, sin bordes y sin icono en la barra de tareas. Tauri solo permite ignorar el ratón para la ventana completa, así que el backend emite la posición del cursor (`cursor-moved`) y el frontend hace un hit-test (raycast al personaje + elementos con clase `.interactive`) para activar/desactivar el click-through con `set_click_through`.

Todo elemento de UI que deba recibir clics necesita la clase `interactive` y `pointer-events: auto`.
