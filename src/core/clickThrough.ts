import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Función que dice si hay algo "sólido" (personaje) bajo el punto dado (px lógicos de la ventana). */
export type HitTester = (x: number, y: number) => boolean;

/**
 * Activa/desactiva el click-through de la ventana según la posición del cursor.
 * Rust emite `cursor-moved` aunque la ventana ignore el ratón, así que este
 * bucle funciona también cuando los eventos DOM no llegan.
 */
export async function setupClickThrough(hitTesters: HitTester[]): Promise<void> {
  let ignoring = false;

  const apply = (ignore: boolean) => {
    if (ignore === ignoring) return;
    ignoring = ignore;
    invoke("set_click_through", { ignore }).catch(console.error);
  };

  const overUi = (x: number, y: number): boolean => {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest(".interactive");
  };

  await listen<{ x: number; y: number }>("cursor-moved", ({ payload }) => {
    const { x, y } = payload;
    const inside = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
    const solid = inside && (overUi(x, y) || hitTesters.some((t) => t(x, y)));
    apply(!solid);
  });

  // Ventana empieza capturando; al primer evento de cursor se ajusta.
}
