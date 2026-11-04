/** Crea un elemento; los que deben capturar clics llevan la clase `interactive`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string; title?: string; interactive?: boolean } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const classes = [opts.class, opts.interactive ? "interactive" : ""].filter(Boolean).join(" ");
  if (classes) node.className = classes;
  if (opts.text) node.textContent = opts.text;
  if (opts.title) node.title = opts.title;
  node.append(...children);
  return node;
}
