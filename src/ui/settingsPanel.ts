import type { SettingsStore, Settings } from "../core/settings";
import { el } from "./dom";

interface Option<K extends keyof Settings> {
  value: Settings[K];
  label: string;
}

interface Group<K extends keyof Settings> {
  key: K;
  title: string;
  hint: string;
  options: Option<K>[];
}

const READ: Group<"read"> = {
  key: "read",
  title: "Lectura de respuestas",
  hint: "Qué dice Mizu en voz alta de lo que te responde. «Resumen» cuenta lo esencial al terminar; «Completa» la va leyendo según llega. El código y las tablas nunca se leen.",
  options: [
    { value: "off", label: "Solo avisos" },
    { value: "resumen", label: "Resumen" },
    { value: "completa", label: "Completa" },
  ],
};

const GESTURES: Group<"gestures"> = {
  key: "gestures",
  title: "Gestos en reposo",
  hint: "Con qué frecuencia hace guiños, estiramientos o el corazón coreano por su cuenta cuando no hay nada que hacer.",
  options: [
    { value: "off", label: "Ninguno" },
    { value: "pocos", label: "Pocos" },
    { value: "normal", label: "Normal" },
    { value: "muchos", label: "Muchos" },
  ],
};

/** Ajustes que viven en el backend (config.json), no en `localStorage`: se leen y se guardan con estas funciones. */
export interface BackendControl {
  load(): Promise<string>;
  /** Devuelve false si ahora no se puede cambiar (por ejemplo, hay una tarea en marcha). */
  save(value: string): Promise<boolean>;
}

export interface BackendControls {
  /** Forma de hablar: `mizu` (casual) o `claude` (estilo normal de Claude Code). */
  persona: BackendControl;
  /** Control del PC: `on` u `off`. */
  desktop: BackendControl;
}

const PERSONA = {
  title: "Forma de hablar",
  hint: "«Casual» es Mizu: charla natural, respuestas cortas y sin tecnicismos. «Detallada» vuelve al estilo normal de Claude Code, con explicaciones y formato. Al cambiarlo se sigue con la misma conversación.",
  options: [
    { value: "mizu", label: "Casual" },
    { value: "claude", label: "Detallada" },
  ],
  initial: "mizu",
};

const DESKTOP = {
  title: "Control del PC",
  hint: "Permite que Mizu vea la pantalla (solo cuando lo necesita para una tarea que le pides) y maneje el ratón y el teclado. Cada acción te pide permiso antes de hacerse.",
  options: [
    { value: "on", label: "Activado" },
    { value: "off", label: "Desactivado" },
  ],
  initial: "on",
};

/** Panel de ajustes: cada ajuste es un grupo de botones; el elegido queda resaltado y se guarda al momento. */
export function createSettingsPanel(parent: HTMLElement, settings: SettingsStore, backend?: BackendControls) {
  const list = el("div", { class: "history-list settings-list" });
  const header = el("div", { class: "history-header" }, el("span", { text: "Ajustes" }));
  const root = el("div", { class: "history settings-panel hidden", interactive: true }, header, list);
  parent.append(root);

  const buttons: { key: keyof Settings; value: string; node: HTMLElement }[] = [];
  const section = (title: string, row: HTMLElement, hint: string) =>
    list.append(el("div", { class: "setting" }, el("div", { class: "setting-title", text: title }), row, el("div", { class: "setting-hint", text: hint })));

  /** Ajustes locales (`localStorage`). */
  const group = <K extends keyof Settings>(g: Group<K>) => {
    const row = el("div", { class: "seg" });
    for (const opt of g.options) {
      const node = el("button", { class: "seg-btn", text: opt.label, interactive: true });
      node.addEventListener("click", () => settings.set({ [g.key]: opt.value } as Partial<Settings>));
      buttons.push({ key: g.key, value: opt.value as string, node });
      row.append(node);
    }
    section(g.title, row, g.hint);
  };

  /** Ajustes del backend: se pide el valor al abrir y cada cambio se confirma antes de marcarlo. */
  const remote: { name: string; value: string }[] = [];
  const backendGroup = (name: string, def: typeof PERSONA, control: BackendControl) => {
    const state = { name, value: def.initial };
    remote.push(state);
    const row = el("div", { class: "seg" });
    for (const opt of def.options) {
      const node = el("button", { class: "seg-btn", text: opt.label, interactive: true });
      node.dataset.backend = name;
      node.dataset.value = opt.value;
      node.addEventListener("click", async () => {
        if (opt.value === state.value) return;
        if (await control.save(opt.value).catch(() => false)) {
          state.value = opt.value;
          render();
        }
      });
      row.append(node);
    }
    section(def.title, row, def.hint);
    control
      .load()
      .then((v) => {
        state.value = v;
        render();
      })
      .catch(console.error);
  };

  if (backend) {
    backendGroup("persona", PERSONA, backend.persona);
    backendGroup("desktop", DESKTOP, backend.desktop);
  }
  group(READ);
  group(GESTURES);

  const render = () => {
    const now = settings.get();
    for (const b of buttons) b.node.classList.toggle("active", now[b.key] === b.value);
    list.querySelectorAll<HTMLElement>("[data-backend]").forEach((n) => {
      const state = remote.find((r) => r.name === n.dataset.backend);
      n.classList.toggle("active", !!state && state.value === n.dataset.value);
    });
  };
  settings.onChange(render);
  render();

  return {
    get open() {
      return !root.classList.contains("hidden");
    },
    toggle() {
      root.classList.toggle("hidden");
      return !root.classList.contains("hidden");
    },
    close() {
      root.classList.add("hidden");
    },
  };
}
