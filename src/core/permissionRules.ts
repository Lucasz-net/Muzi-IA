/**
 * "Aceptar siempre": reglas de permiso que recuerda la app para no volver a preguntar lo mismo.
 *
 * Las reglas son deliberadamente estrechas:
 *  - Comandos (Bash/PowerShell): el comienzo del comando (el programa y su primer argumento, p. ej.
 *    `git status` o `Start-Process steam://rungameid/730`). Solo se aplican a comandos SIMPLES: si el
 *    comando encadena otro (`;`, `&&`, `||`, `|`, redirecciones, subcomandos) siempre se pregunta, así
 *    que una regla de `git status` jamás aprueba `git status && rm -rf …`.
 *  - Edit/Write: archivos dentro de una carpeta concreta.
 *  - WebFetch: un dominio concreto.
 * Los comandos destructivos y las rutas del sistema nunca ofrecen "siempre".
 * Se guardan en `localStorage` y se pueden olvidar una a una desde el menú.
 */
export type RuleKind = "command" | "dir" | "host" | "tool";

export interface PermissionRule {
  id: string;
  tool: string;
  kind: RuleKind;
  /** Comando: las primeras palabras en minúsculas; carpeta: ruta con `/` y en minúsculas; dominio: host. */
  value: string;
  /** Texto legible para la tarjeta y el panel. */
  label: string;
  createdAt: number;
}

const STORAGE_KEY = "mizu.permRules";
/** Herramientas de control del PC que solo observan (no tocan nada): las únicas que pueden recordarse con «Siempre». */
const DESKTOP_READ_ONLY: Record<string, string> = {
  "mcp__mizu-desktop__screenshot": "Ver la pantalla (capturas)",
  "mcp__mizu-desktop__list_windows": "Ver qué ventanas hay abiertas",
  "mcp__mizu-desktop__screen_info": "Ver el tamaño de las pantallas",
  "mcp__mizu-desktop__cursor_position": "Ver dónde está el ratón",
};
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

type Input = Record<string, unknown>;
const asInput = (raw: unknown): Input => (raw && typeof raw === "object" ? (raw as Input) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ------------------------------------------------------------------ comandos

/** Encadenados, redirecciones y sustituciones: con cualquiera de estos el comando ya no es "simple". */
const CHAINING = /&&|\|\||[;|<>`\n\r]|\$\(|\$\{/;
/** Comandos que nunca se recuerdan: destructivos, de seguridad o que ejecutan texto arbitrario. */
const DANGEROUS =
  /\b(?:rm|del|erase|rd|rmdir|remove-item|ri|format|mkfs|dd|diskpart|shutdown|restart-computer|stop-computer|sudo|su|runas|chmod|chown|takeown|icacls|reg|regedit|set-executionpolicy|invoke-expression|iex|invoke-command|start-job|schtasks|sc|net|netsh|bcdedit|cipher)\b|git\s+(?:push\b.*(?:--force|-f\b)|reset\s+--hard|clean\b|branch\s+-D)|-enc(?:odedcommand)?\b|\bpowershell(?:\.exe)?\b.*-c\b|\bcmd(?:\.exe)?\s+\/c\b/i;

/** Parte un comando en palabras respetando comillas. */
export function tokenize(command: string): string[] {
  return command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

const normToken = (t: string) => t.replace(/^["']|["']$/g, "").toLowerCase();

/** Palabras que forman el comienzo de la regla: el operador de llamada (`&`) cuenta aparte. */
function commandHead(command: string): string[] {
  const tokens = tokenize(command);
  const take = tokens[0] === "&" || tokens[0] === "." ? 3 : 2;
  return tokens.slice(0, take).map(normToken);
}

export function isSimpleCommand(command: string): boolean {
  return command.trim().length > 0 && !CHAINING.test(command);
}

// ------------------------------------------------------------------ rutas y dominios

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const dirname = (p: string) => {
  const n = normPath(p);
  const i = n.lastIndexOf("/");
  return i > 0 ? n.slice(0, i) : "";
};
const SYSTEM_PATH = /(?:^|\/)(?:windows|program files(?: \(x86\))?|programdata|system32|\.ssh|\.gnupg|startup)(?:\/|$)|appdata\/roaming\/microsoft\/windows/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------ API

/** Regla que se ofrecería para esta petición, o `null` si no merece "siempre" (peligrosa o poco concreta). */
export function suggestRule(tool: string, raw: unknown): Omit<PermissionRule, "id" | "createdAt"> | null {
  const input = asInput(raw);
  if (SHELL_TOOLS.has(tool)) {
    const command = str(input.command);
    if (!isSimpleCommand(command) || DANGEROUS.test(command)) return null;
    const head = commandHead(command);
    if (!head.length) return null;
    const value = head.join(" ");
    const shown = tokenize(command).slice(0, head.length).join(" "); // con las mayúsculas originales
    return { tool, kind: "command", value, label: `${tool}: ${shown} …` };
  }
  if (FILE_TOOLS.has(tool)) {
    const path = str(input.file_path || input.notebook_path);
    const dir = dirname(path);
    if (!dir || SYSTEM_PATH.test(dir)) return null;
    const shown = path.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
    return { tool, kind: "dir", value: dir, label: `${tool} en ${shown}/` };
  }
  if (tool === "WebFetch") {
    const host = hostOf(str(input.url));
    return host ? { tool, kind: "host", value: host, label: `WebFetch a ${host}` } : null;
  }
  if (tool === "WebSearch") return { tool, kind: "tool", value: "*", label: "Búsquedas en internet" };
  // Control del PC: solo se ofrece «Siempre» para lo que solo MIRA. Hacer clic, escribir o pulsar teclas se pregunta siempre.
  const look = DESKTOP_READ_ONLY[tool];
  if (look) return { tool, kind: "tool", value: "*", label: look };
  return null;
}

/** ¿Esta regla ya cubre la petición? */
export function ruleMatches(rule: PermissionRule, tool: string, raw: unknown): boolean {
  if (rule.tool !== tool) return false;
  const input = asInput(raw);
  switch (rule.kind) {
    case "command": {
      const command = str(input.command);
      if (!isSimpleCommand(command) || DANGEROUS.test(command)) return false;
      const head = commandHead(command).join(" ");
      return head === rule.value;
    }
    case "dir": {
      const path = normPath(str(input.file_path || input.notebook_path));
      return !!path && path.startsWith(rule.value + "/") && !SYSTEM_PATH.test(dirname(path));
    }
    case "host":
      return hostOf(str(input.url)) === rule.value;
    case "tool":
      return true;
  }
}

/** Almacén de reglas persistido en `localStorage` (si no hay, solo vive en memoria). */
export function createRuleStore() {
  let rules: PermissionRule[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(parsed)) rules = parsed.filter((r) => r && typeof r.tool === "string" && typeof r.value === "string");
  } catch {
    /* sin almacenamiento o datos rotos: se empieza sin reglas */
  }
  const listeners = new Set<() => void>();
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {
      /* solo vale para esta sesión */
    }
    listeners.forEach((cb) => cb());
  };

  return {
    list: (): readonly PermissionRule[] => rules,
    find: (tool: string, input: unknown) => rules.find((r) => ruleMatches(r, tool, input)),
    add(rule: Omit<PermissionRule, "id" | "createdAt">) {
      if (rules.some((r) => r.tool === rule.tool && r.kind === rule.kind && r.value === rule.value)) return;
      rules = [...rules, { ...rule, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() }];
      save();
    },
    remove(id: string) {
      rules = rules.filter((r) => r.id !== id);
      save();
    },
    clear() {
      rules = [];
      save();
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export type RuleStore = ReturnType<typeof createRuleStore>;
