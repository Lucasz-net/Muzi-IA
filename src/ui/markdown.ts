/**
 * Markdown mínimo y seguro para el globo de diálogo: código, negrita, cursiva, listas y títulos.
 * Todo el texto se escapa antes de generar HTML y los enlaces se muestran solo como texto.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(line: string): string {
  // Los segmentos entre `backticks` son código; el resto admite negrita/cursiva.
  return esc(line)
    .split("`")
    .map((seg, i) =>
      i % 2 === 1
        ? `<code>${seg}</code>`
        : seg
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1<em>$2</em>")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    )
    .join("");
}

function block(text: string): string {
  return text
    .split("\n")
    .map((raw) => {
      const line = raw.trimEnd();
      if (!line.trim()) return '<div class="md-gap"></div>';
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) return `<div class="md-h">${inline(heading[1])}</div>`;
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bullet) return `<div class="md-li"><span class="md-mark">•</span><span>${inline(bullet[1])}</span></div>`;
      const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (numbered) {
        return `<div class="md-li"><span class="md-mark">${numbered[1]}.</span><span>${inline(numbered[2])}</span></div>`;
      }
      return `<div>${inline(line)}</div>`;
    })
    .join("");
}

export function renderMarkdown(src: string): string {
  // Partes impares = bloques de código (el último puede estar sin cerrar mientras llega en streaming).
  return src
    .split("```")
    .map((part, i) => {
      if (i % 2 === 0) return block(part);
      const nl = part.indexOf("\n");
      const hasLang = nl > -1 && /^[\w+#.-]*$/.test(part.slice(0, nl).trim());
      const code = hasLang ? part.slice(nl + 1) : part;
      return `<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`;
    })
    .join("");
}
