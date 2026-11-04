# Mizu-IA

Compañero de escritorio estilo VTuber: un personaje 3D (VRM) que vive en tu pantalla y es la interfaz gráfica de una IA de terminal (Claude Code primero; Codex, Gemini CLI, etc. después).

Funciona con tu **suscripción** (p. ej. Claude Pro): la app lanza el CLI oficial ya autenticado y le quita `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` del entorno para que nunca facture por API.

> Estado: fases 1–3 y 5 hechas (ventana, conexión con Claude Code, estados y animaciones procedurales, voz y permisos). **Pendiente: fase 4** (carga de VRM, parpadeo, mirada, lipsync), a la espera del modelo.

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

- Escribe en la caja y pulsa Enter (Shift+Enter = salto de línea). El ➤ pasa a ■ mientras trabaja: púlsalo para detener.
- 📁 elige la carpeta de trabajo de Claude (por defecto, tu carpeta personal). Cambiarla inicia una conversación nueva.
- 🕘 abre el historial con los pasos de las herramientas y "Nueva conversación".
- 🔊/🔇 activa o silencia la voz.
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

Pendiente de la fase 4. Por ahora: coloca tu `.vrm` en `assets/models/` (los `.vrm` no se versionan). Las animaciones por estado se describen en `assets/animations/README.md`.

## Ventana y click-through

La ventana es transparente, sin bordes y sin icono en la barra de tareas. Tauri solo permite ignorar el ratón para la ventana completa, así que el backend emite la posición del cursor (`cursor-moved`) y el frontend hace un hit-test (raycast al personaje + elementos con clase `.interactive`) para activar/desactivar el click-through con `set_click_through`.

Todo elemento de UI que deba recibir clics necesita la clase `interactive` y `pointer-events: auto`.
