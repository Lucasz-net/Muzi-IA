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

/** Panel de ajustes: cada ajuste es un grupo de botones; el elegido queda resaltado y se guarda al momento. */
export function createSettingsPanel(parent: HTMLElement, settings: SettingsStore) {
  const list = el("div", { class: "history-list settings-list" });
  const header = el("div", { class: "history-header" }, el("span", { text: "Ajustes" }));
  const root = el("div", { class: "history settings-panel hidden", interactive: true }, header, list);
  parent.append(root);

  const buttons: { key: keyof Settings; value: string; node: HTMLElement }[] = [];

  const group = <K extends keyof Settings>(g: Group<K>) => {
    const row = el("div", { class: "seg" });
    for (const opt of g.options) {
      const node = el("button", { class: "seg-btn", text: opt.label, interactive: true });
      node.addEventListener("click", () => settings.set({ [g.key]: opt.value } as Partial<Settings>));
      buttons.push({ key: g.key, value: opt.value as string, node });
      row.append(node);
    }
    list.append(el("div", { class: "setting" }, el("div", { class: "setting-title", text: g.title }), row, el("div", { class: "setting-hint", text: g.hint })));
  };
  group(READ);
  group(GESTURES);

  const render = () => {
    const now = settings.get();
    for (const b of buttons) b.node.classList.toggle("active", now[b.key] === b.value);
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
