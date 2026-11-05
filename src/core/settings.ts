import type { GestureLevel } from "../character/types";

/**
 * Ajustes del usuario que se pueden cambiar desde el panel del menú. Se guardan en `localStorage` y avisan a
 * quien los escucha cuando cambian.
 */
export type ReadMode = "off" | "resumen" | "completa";

export interface Settings {
  /** Qué lee Mizu en voz alta de sus respuestas: nada (solo avisos), un resumen o todo. */
  read: ReadMode;
  /** Cuántos gestos lanza sola en reposo. */
  gestures: GestureLevel;
}

const STORAGE_KEY = "mizu.settings";
export const DEFAULT_SETTINGS: Settings = { read: "resumen", gestures: "normal" };

const READ_MODES: ReadMode[] = ["off", "resumen", "completa"];
const GESTURE_LEVELS: GestureLevel[] = ["off", "pocos", "normal", "muchos"];

export function createSettings() {
  let current: Settings = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
    if (saved.read && READ_MODES.includes(saved.read)) current.read = saved.read;
    if (saved.gestures && GESTURE_LEVELS.includes(saved.gestures)) current.gestures = saved.gestures;
  } catch {
    /* sin almacenamiento o datos rotos: valores por defecto */
  }
  const listeners = new Set<(s: Settings) => void>();

  return {
    get: (): Readonly<Settings> => current,
    set(patch: Partial<Settings>) {
      current = { ...current, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch {
        /* solo vale para esta sesión */
      }
      listeners.forEach((cb) => cb(current));
    },
    onChange(cb: (s: Settings) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettings>;
