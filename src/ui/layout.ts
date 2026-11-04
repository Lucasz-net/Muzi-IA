/**
 * Decide en qué lado del personaje va el diálogo: siempre hacia el centro de la pantalla,
 * para que no quede fuera de la vista cuando se arrastra el personaje hasta un borde.
 *
 * La ventana es simétrica (franja de diálogo | personaje | franja de diálogo), así que el
 * personaje no se mueve al cambiar de lado. Se expone en `<html data-dialog="left|right">`.
 */
const HYSTERESIS_PX = 40; // evita parpadeos al cruzar justo la mitad de la pantalla
const POLL_MS = 150;

export function watchDialogSide(stage: HTMLElement) {
  const root = document.documentElement;
  let side: "left" | "right" = "left";
  root.dataset.dialog = side;

  const set = (next: "left" | "right") => {
    side = next;
    root.dataset.dialog = next;
  };

  const tick = () => {
    const rect = stage.getBoundingClientRect();
    // Coordenadas de pantalla (px CSS) del centro del personaje y del monitor actual.
    const charX = window.screenX + rect.left + rect.width / 2;
    const availLeft = (screen as Screen & { availLeft?: number }).availLeft ?? 0;
    const mid = availLeft + screen.availWidth / 2;

    if (side === "left" && charX < mid - HYSTERESIS_PX) set("right"); // personaje a la izquierda
    else if (side === "right" && charX > mid + HYSTERESIS_PX) set("left"); // personaje a la derecha
  };

  tick();
  setInterval(tick, POLL_MS);
}
