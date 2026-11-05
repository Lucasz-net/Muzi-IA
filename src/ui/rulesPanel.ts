import type { RuleStore } from "../core/permissionRules";
import { el } from "./dom";
import { icon } from "./icons";

/** Panel con los permisos que marcaste como "Siempre", para ver qué recuerda Mizu y olvidarlos. */
export function createRulesPanel(parent: HTMLElement, rules: RuleStore) {
  const list = el("div", { class: "history-list rules-list" });
  const clearBtn = el("button", { class: "link-btn", text: "Olvidar todos", interactive: true });
  const header = el("div", { class: "history-header" }, el("span", { text: "Permisos recordados" }), clearBtn);
  const root = el("div", { class: "history rules-panel hidden", interactive: true }, header, list);
  parent.append(root);

  const render = () => {
    list.replaceChildren();
    const all = rules.list();
    clearBtn.classList.toggle("hidden", all.length === 0);
    if (!all.length) {
      list.append(el("div", { class: "entry rule-empty", text: "Aún no has marcado nada como «Siempre». Cuando Mizu te pida un permiso, el botón «Siempre» hará que no vuelva a preguntar lo mismo." }));
      return;
    }
    for (const r of all) {
      const del = el("button", { class: "icon-btn rule-del", title: "Olvidar este permiso", interactive: true }, icon("close"));
      del.addEventListener("click", () => rules.remove(r.id));
      list.append(el("div", { class: "rule-item" }, el("span", { class: "rule-label", text: r.label, title: r.label }), del));
    }
  };
  clearBtn.addEventListener("click", () => rules.clear());
  rules.onChange(render);
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
