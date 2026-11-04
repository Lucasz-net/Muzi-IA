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
- Iconos del menú: chat, carpeta de trabajo (por defecto tu carpeta personal; cambiarla inicia una conversación nueva), historial (con "Nueva conversación"), voz, **zoom** (alterna plano medio / cuerpo completo; se recuerda entre sesiones) y cerrar. Mientras hay una tarea aparece aparte un botón rojo para detenerla.
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

Se lanza el CLI con `--permission-prompt-tool stdio`: el CLI manda un `control_request` (`can_use_tool`) y la app responde con un `control_response` (allow con `updatedInput`, o deny con mensaje). No hace falta ningún servidor MCP.

### Voz

El personaje habla al terminar una tarea (si usó herramientas o tardó 6 s o más), al pedir un permiso y ante errores. Solo dice frases cortas; no lee las respuestas. Lógica en `voice/announcer.ts`.

## Agregar un adaptador (otro CLI)

1. Crea `src-tauri/src/agent/<nombre>.rs` con una struct que implemente `AgentAdapter`:
   - `spawn_spec`: ejecutable, argumentos y variables de entorno a quitar.
   - `encode_user_message` y `encode_permission_response`: líneas que se escriben en stdin.
   - `new_parser`: devuelve un `EventParser` que convierte cada línea de stdout en `AgentEvent`.
2. Declara el módulo en `agent/mod.rs` y regístralo en `adapter_for`.
3. Pon su id en `adapter` del `config.json`.

El resto (proceso, eventos, frontend) no cambia.

## Cambiar el motor de voz

Implementa `TTSProvider` (`src/voice/tts.ts`) —por ejemplo Piper, Kokoro o ElevenLabs— y devuélvelo desde `createTTS()` en `src/voice/webSpeechProvider.ts`. `onBoundary` está pensado para el lipsync.

## Agregar un modelo

Coloca tu `.vrm` en `assets/models/` (se usa el primero por orden alfabético; sin ninguno, se muestra un personaje de relleno) y reinicia `npm run tauri dev`. Detalles y requisitos en `assets/models/README.md`. Los `.vrm` no se versionan.

Qué hace la app con el modelo (`src/character/vrmCharacter.ts`):

- **Animaciones de Mixamo:** si colocas `.fbx` en `assets/animations/` y los asignas a estados en `animations.json`, se retargetean al VRM y se mezclan con la pose procedural (ver `assets/animations/README.md`).
- **Poses por estado:** una `Pose` abstracta (cuerpo, cabeza, brazos, codos) se aplica a los huesos humanoides normalizados. Los valores están en `src/character/procedural.ts`.
- **Expresiones:** `happy` al celebrar, `sad` en error, `surprised` al pedir permiso, `relaxed` en reposo.
- **Parpadeo** automático (`blink`), **mirada** con vida propia (en reposo alterna al azar entre mirar alrededor girando la cabeza, mirar de frente y seguir el cursor un rato; con actividad mira de frente) y **lipsync** (`aa/ih/ou/ee/oh`) mientras habla la voz.
- **Vista:** plano medio por defecto (de medio muslo hacia arriba, con el borde inferior difuminado) o cuerpo completo.
- **Click-through por silueta:** se lee el alfa del píxel renderizado bajo el cursor.
- **Rendimiento:** render limitado a 30 fps (`TARGET_FPS` en `scene.ts`) y bitmaps de texturas liberados tras subirlos a la GPU.

Depurar animaciones desde la consola de la ventana (solo desarrollo): escribe `mizuHelp()` para ver los comandos (`mizu.force("thinking")`, `mizuStage.playClip("Kawaii Kaiwai.fbx")`, `mizuStage.setView("upper")`...). Detalle en `assets/animations/README.md`.

## Ventana y click-through

La ventana (1040 px) es simétrica: franja de diálogo | personaje | franja de diálogo. El personaje queda siempre en el centro y el diálogo ocupa una de las franjas (`ui/layout.ts` elige el lado). `--zone` en `src/style.css` y `SIDE_ZONE` en `src-tauri/src/window.rs` deben coincidir. Por defecto la franja derecha, vacía, queda fuera de la pantalla.

La ventana es transparente, sin bordes y sin icono en la barra de tareas. Tauri solo permite ignorar el ratón para la ventana completa, así que el backend emite la posición del cursor (`cursor-moved`) y el frontend hace un hit-test (raycast al personaje + elementos con clase `.interactive`) para activar/desactivar el click-through con `set_click_through`.

Todo elemento de UI que deba recibir clics necesita la clase `interactive` y `pointer-events: auto`.
