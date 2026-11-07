import type { JaLine } from "../voice/jaVoice";
import { el } from "./dom";

/** Tiempo que el subtítulo se queda visible tras terminar la frase (ms). */
const LINGER_MS = 2200;

/**
 * Subtítulo sobre la cabeza del personaje: el texto japonés de lo que dice va apareciendo letra a letra siguiendo la voz,
 * y debajo, más pequeña, su traducción al español (si el ajuste está activado). La posición sale de `--head-x/--head-y`.
 */
export function createCaption(parent: HTMLElement, { translation }: { translation: () => boolean }) {
  const jp = el("div", { class: "cap-ja" });
  const es = el("div", { class: "cap-es" });
  const root = el("div", { class: "caption" }, jp, es);
  root.setAttribute("aria-live", "polite");
  parent.append(root);

  let currentId = "";
  let spans: HTMLElement[] = [];
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const build = (line: JaLine) => {
    currentId = line.id;
    jp.replaceChildren();
    spans = [...line.ja].map((ch) => {
      const s = el("span", { class: "cap-ch", text: ch });
      jp.append(s);
      return s;
    });
    es.textContent = line.es;
    es.classList.toggle("off", !translation());
  };

  return {
    /** Muestra la frase con `shown` letras visibles; `null` cuando la voz termina (el subtítulo se desvanece solo). */
    update(line: JaLine | null, shown: number) {
      clearTimeout(hideTimer);
      if (!line) {
        spans.forEach((s) => s.classList.add("on"));
        hideTimer = setTimeout(() => root.classList.remove("show"), LINGER_MS);
        return;
      }
      if (line.id !== currentId || !root.classList.contains("show")) {
        build(line);
        void root.offsetWidth;
        root.classList.add("show");
      }
      spans.forEach((s, i) => s.classList.toggle("on", i < shown));
    },
    /** El ajuste de traducción cambió. */
    refresh() {
      es.classList.toggle("off", !translation());
    },
  };
}
