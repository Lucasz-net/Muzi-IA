# Mizu-IA

Compañero de escritorio estilo VTuber: un personaje 3D (VRM) que vive en tu pantalla y es la interfaz gráfica de una IA de terminal (Claude Code primero; Codex, Gemini CLI, etc. después).

Funciona con tu **suscripción** (p. ej. Claude Pro): la app lanza el CLI oficial ya autenticado, no usa claves de API.

> Estado: **Fase 1** (ventana transparente, siempre encima, click-through, placeholder).

## Requisitos (Windows)

- Node.js 20+ y npm
- Rust (toolchain `stable-x86_64-pc-windows-msvc`)
- Visual Studio Build Tools con "Desktop development with C++"
- WebView2 Runtime (incluido en Windows 11)
- Claude Code CLI instalado y con sesión iniciada (`claude` en el PATH)

## Desarrollo

```bash
npm install
npm run tauri dev
```

La primera compilación de Rust tarda unos minutos.

## Estructura

```
src-tauri/src/   Backend Rust (ventana, procesos del CLI, adaptadores, permisos)
src/             Frontend TypeScript (escena 3D, máquina de estados, UI, voz)
assets/models/   Pon aquí tu modelo .vrm
assets/animations/  Clips de animación por estado (Mixamo/VRMA)
```

## Ventana y click-through

La ventana es transparente, sin bordes y sin icono en la barra de tareas. Tauri solo permite ignorar el ratón para la ventana completa, así que el backend emite la posición del cursor (`cursor-moved`) y el frontend hace un hit-test (raycast al personaje + elementos con clase `.interactive`) para activar/desactivar el click-through con el comando `set_click_through`.

Cualquier elemento de UI que deba recibir clics debe llevar la clase `interactive` y `pointer-events: auto`.
