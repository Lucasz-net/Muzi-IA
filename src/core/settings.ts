import type { GestureLevel } from "../character/types";

/**
 * Ajustes del usuario que se pueden cambiar desde el panel del menú. Se guardan en `localStorage` y avisan a
 * quien los escucha cuando cambian.
 */
export type ReadMode = "off" | "resumen" | "completa";

export type Toggle = "on" | "off";
/** Cuánto charla Mizu sola cuando no hay nada que hacer. */
export type ChatterLevel = "off" | "poca" | "normal" | "mucha";

/** Cuánto se transparenta el cristal de la interfaz. */
export type GlassLevel = "claro" | "medio" | "denso";

export interface Settings {
  /** Voz en vivo: Mizu dice con su propia voz (japonés, sintetizado al momento) lo que quiere contarte. */
  liveVoice: Toggle;
  /** Opacidad del cristal de la interfaz. */
  glass: GlassLevel;
  /** Traducción al español bajo el subtítulo japonés. */
  translation: Toggle;
  /** Frases sueltas en reposo (voz y subtítulo). */
  chatter: ChatterLevel;
  /** Qué lee Mizu en voz alta de sus respuestas: nada (solo avisos), un resumen o todo. */
  read: ReadMode;
  /** Cuántos gestos lanza sola en reposo. */
  gestures: GestureLevel;
  /** Volumen de la voz de Mizu, de 0 a 100 (además del volumen de Windows). */
  volume: number;
  /** Permisos de herramientas: `on` = Mizu hace todo sin preguntar (solo te consulta decisiones y planes); `off` = tarjeta por cada acción. */
  autoApprove: Toggle;
}

const STORAGE_KEY = "mizu.settings";
export const DEFAULT_SETTINGS: Settings = { liveVoice: "on", glass: "medio", translation: "on", chatter: "normal", read: "off", gestures: "normal", volume: 100, autoApprove: "on" };

const GLASS_LEVELS: GlassLevel[] = ["claro", "medio", "denso"];
const CHATTER_LEVELS: ChatterLevel[] = ["off", "poca", "normal", "mucha"];
const READ_MODES: ReadMode[] = ["off", "resumen", "completa"];
const GESTURE_LEVELS: GestureLevel[] = ["off", "pocos", "normal", "muchos"];

export function createSettings() {
  let current: Settings = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
    if (saved.translation === "on" || saved.translation === "off") current.translation = saved.translation;
    if (saved.liveVoice === "on" || saved.liveVoice === "off") current.liveVoice = saved.liveVoice;
    if (saved.glass && GLASS_LEVELS.includes(saved.glass)) current.glass = saved.glass;
    if (saved.autoApprove === "on" || saved.autoApprove === "off") current.autoApprove = saved.autoApprove;
    if (saved.chatter && CHATTER_LEVELS.includes(saved.chatter)) current.chatter = saved.chatter;
    if (saved.read && READ_MODES.includes(saved.read)) current.read = saved.read;
    if (saved.gestures && GESTURE_LEVELS.includes(saved.gestures)) current.gestures = saved.gestures;
    if (typeof saved.volume === "number" && Number.isFinite(saved.volume)) current.volume = Math.min(100, Math.max(0, Math.round(saved.volume)));
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
