import { getCurrentWindow } from "@tauri-apps/api/window";
import { setupClickThrough } from "./core/clickThrough";
import { createScene } from "./character/scene";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const stage = createScene(canvas);

// Arrastrar la ventana desde el personaje.
window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (stage.hitTest(e.clientX, e.clientY)) {
    getCurrentWindow().startDragging().catch(console.error);
  }
});

setupClickThrough([stage.hitTest]).catch(console.error);
