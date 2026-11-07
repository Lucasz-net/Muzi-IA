import type { SettingsStore, Settings } from "../core/settings";
import { memory, type MemoryNote } from "../core/bridge";
import { el } from "./dom";
import { icon } from "./icons";

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

const TRANSLATION: Group<"translation"> = {
  key: "translation",
  title: "Traducción del subtítulo",
  hint: "Muestra en español, bajo las letras japonesas, lo que dice Mizu.",
  options: [
    { value: "on", label: "Mostrar" },
    { value: "off", label: "Ocultar" },
  ],
};

const CHATTER: Group<"chatter"> = {
  key: "chatter",
  title: "Charla en reposo",
  hint: "Cada cuánto dice frases sueltas en japonés cuando no hay nada que hacer. No habla mientras trabajas con el micrófono abierto ni si la voz está silenciada.",
  options: [
    { value: "off", label: "Callada" },
    { value: "poca", label: "Poca" },
    { value: "normal", label: "Normal" },
    { value: "mucha", label: "Mucha" },
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

  /** Volumen propio de Mizu: un deslizador que se guarda al moverlo. */
  const volumeValue = el("span", { class: "setting-value" });
  const volumeSlider = () => {
    const input = el("input", { class: "slider", interactive: true });
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    const fill = () => input.style.setProperty("--p", `${input.value}%`);
    input.value = String(settings.get().volume);
    fill();
    input.addEventListener("input", () => {
      fill();
      settings.set({ volume: Number(input.value) });
    });
    settings.onChange((s) => {
      volumeValue.textContent = `${s.volume} %`;
      if (Number(input.value) !== s.volume) {
        input.value = String(s.volume);
        fill();
      }
    });
    volumeValue.textContent = `${settings.get().volume} %`;
    section("Volumen de Mizu", el("div", { class: "slider-row" }, input, volumeValue), "Volumen de su voz, además del de Windows. En el mezclador de volumen de Windows también aparece como «Mizu-IA».");
  };

  /** Lo que Mizu recuerda de ti: se vuelve a pedir cada vez que se abre el panel y se borra de uno en uno. */
  const memoryList = el("div", { class: "memory-list" });
  const renderMemory = (notes: MemoryNote[]) => {
    memoryList.replaceChildren();
    if (!notes.length) {
      memoryList.append(el("div", { class: "memory-empty", text: "Aún no recuerda nada. Dile «recuerda que…» y lo guardará." }));
      return;
    }
    for (const note of notes) {
      const remove = el("button", { class: "memory-del", title: "Olvidar esto", interactive: true }, icon("close"));
      remove.addEventListener("click", () => memory.remove(note.id).then(refreshMemory).catch(console.error));
      memoryList.append(el("div", { class: "memory-item" }, el("span", { text: note.text }), remove));
    }
    const clear = el("button", { class: "link-btn", text: "Olvidar todo", interactive: true });
    clear.addEventListener("click", () => memory.clear().then(refreshMemory).catch(console.error));
    memoryList.append(clear);
  };
  const refreshMemory = () => memory.list().then(renderMemory).catch(console.error);
  section("Lo que recuerda Mizu", memoryList, "Notas que guarda sobre ti entre conversaciones. Si borras una, la olvida en la próxima conversación nueva. Nunca guarda contraseñas ni datos de pago.");
  renderMemory([]);

  if (backend) {
    backendGroup("persona", PERSONA, backend.persona);
    backendGroup("desktop", DESKTOP, backend.desktop);
  }
  group(CHATTER);
  group(TRANSLATION);
  group(READ);
  group(GESTURES);
  volumeSlider();

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
      if (!root.classList.contains("hidden")) void refreshMemory();
      return !root.classList.contains("hidden");
    },
    close() {
      root.classList.add("hidden");
    },
  };
}
