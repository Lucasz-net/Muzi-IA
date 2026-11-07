//! Adaptador de Claude Code (`claude -p --input-format stream-json --output-format stream-json`).
//!
//! Usa el login del propio CLI (suscripción): se quitan `ANTHROPIC_API_KEY` y
//! `ANTHROPIC_AUTH_TOKEN` del entorno del hijo para que nunca facture por API.
//! Los permisos se resuelven por stdio con `--permission-prompt-tool stdio`
//! (`control_request` / `control_response`).

use super::{
    resolve_executable, AgentAdapter, AgentConfig, AgentEvent, EventParser, SpawnSpec,
};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Personalidad de Mizu: charla casual y breve, sin tecnicismos (ver `src-tauri/persona/mizu.txt`).
const MIZU_PERSONA: &str = include_str!("../../persona/mizu.txt");

/// Escribe la configuración MCP y devuelve su ruta. Los servidores son este mismo ejecutable: `--mcp-desktop` (control del
/// PC, ver `mcp_desktop.rs`) y `--mcp-memory <archivo>` (recuerdos, ver `mcp_memory.rs`). Claude Code los lanza por stdio.
fn mcp_config(desktop: bool, memory: Option<&std::path::Path>) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.display().to_string();
    let dir = std::env::temp_dir().join("mizu-ia");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("mcp.json");
    let mut servers = serde_json::Map::new();
    if desktop {
        servers.insert("mizu-desktop".into(), json!({ "command": exe, "args": ["--mcp-desktop"] }));
    }
    if let Some(mem) = memory {
        servers.insert("mizu-memory".into(), json!({ "command": exe, "args": ["--mcp-memory", mem.display().to_string()] }));
    }
    std::fs::write(&path, json!({ "mcpServers": servers }).to_string()).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Escribe lo que se añade al prompt del sistema (personalidad y/o memoria) en un archivo temporal y devuelve su ruta. Se
/// pasa con `--append-system-prompt-file` en vez de como argumento: en Windows `claude` es un `.cmd` y un texto largo con
/// saltos de línea y símbolos se rompería.
fn system_prompt_file(mizu: bool, memory: Option<&std::path::Path>) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("mizu-ia");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("persona-mizu.txt");
    let mut text = if mizu { MIZU_PERSONA.to_string() } else { String::new() };
    if let Some(mem) = memory {
        text.push_str(&crate::memory::prompt_block(mem));
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path)
}

pub struct ClaudeCodeAdapter;

impl AgentAdapter for ClaudeCodeAdapter {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    fn spawn_spec(&self, cfg: &AgentConfig, resume: Option<&str>) -> Result<SpawnSpec, String> {
        let program = resolve_executable(cfg.command.as_deref(), "claude")?;
        let mut args: Vec<String> = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-prompt-tool",
            "stdio",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        if let Some(mode) = cfg.permission_mode.as_deref().filter(|m| !m.is_empty()) {
            args.push("--permission-mode".into());
            args.push(mode.into());
        }
        // Por defecto habla como Mizu; con `persona: "claude"` se deja el estilo normal de Claude Code. La memoria
        // (lo que Mizu sabe de la persona) se añade en ambos casos.
        let mizu = cfg.persona.as_deref().unwrap_or("mizu") != "claude";
        let memory = cfg.memory_path.as_deref();
        if mizu || memory.is_some() {
            match system_prompt_file(mizu, memory) {
                Ok(path) => {
                    args.push("--append-system-prompt-file".into());
                    args.push(path.display().to_string());
                }
                Err(e) => eprintln!("[mizu] no se pudo preparar el prompt: {e}"),
            }
        }
        // Control del PC (activado por defecto) y memoria. Cada acción sigue pasando por el flujo de permisos de la app.
        let desktop = cfg.desktop.unwrap_or(true);
        if desktop || memory.is_some() {
            match mcp_config(desktop, memory) {
                Ok(path) => {
                    args.push("--mcp-config".into());
                    args.push(path.display().to_string());
                }
                Err(e) => eprintln!("[mizu] no se pudo preparar el control del PC ni la memoria: {e}"),
            }
        }
        if let Some(id) = resume {
            args.push("--resume".into());
            args.push(id.into());
        }
        Ok(SpawnSpec {
            program,
            args,
            env_remove: vec!["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
        })
    }

    fn encode_user_message(&self, text: &str) -> String {
        json!({ "type": "user", "message": { "role": "user", "content": text } }).to_string()
    }

    fn encode_permission_response(
        &self,
        request_id: &str,
        allow: bool,
        input: &Value,
        message: Option<&str>,
    ) -> Option<String> {
        let response = if allow {
            json!({ "behavior": "allow", "updatedInput": input })
        } else {
            json!({ "behavior": "deny", "message": message.unwrap_or("El usuario rechazó la acción.") })
        };
        Some(
            json!({
                "type": "control_response",
                "response": { "subtype": "success", "request_id": request_id, "response": response }
            })
            .to_string(),
        )
    }

    fn new_parser(&self) -> Box<dyn EventParser> {
        Box::new(ClaudeParser)
    }
}

struct ClaudeParser;

impl EventParser for ClaudeParser {
    fn parse_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return vec![];
        };
        // Mensajes de subagentes: solo interesan sus herramientas, no su texto.
        let is_sub = !v["parent_tool_use_id"].is_null();

        match v["type"].as_str() {
            Some("system") if v["subtype"] == "init" => vec![AgentEvent::SessionStarted {
                session_id: v["session_id"].as_str().unwrap_or_default().into(),
                model: v["model"].as_str().map(String::from),
            }],

            Some("stream_event") if !is_sub => {
                let ev = &v["event"];
                match ev["type"].as_str() {
                    Some("message_start") => vec![AgentEvent::Thinking],
                    Some("content_block_start") if ev["content_block"]["type"] == "thinking" => {
                        vec![AgentEvent::Thinking]
                    }
                    Some("content_block_delta") if ev["delta"]["type"] == "text_delta" => {
                        vec![AgentEvent::Message {
                            text: ev["delta"]["text"].as_str().unwrap_or_default().into(),
                            is_delta: true,
                        }]
                    }
                    _ => vec![],
                }
            }

            Some("assistant") => {
                let mut out = vec![];
                for block in v["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") if !is_sub => {
                            let text = block["text"].as_str().unwrap_or_default();
                            if !text.trim().is_empty() {
                                out.push(AgentEvent::Message { text: text.into(), is_delta: false });
                            }
                        }
                        Some("tool_use") => {
                            let name = block["name"].as_str().unwrap_or("?").to_string();
                            let input = block["input"].clone();
                            out.push(AgentEvent::ToolUse {
                                tool_id: block["id"].as_str().unwrap_or_default().into(),
                                summary: summarize_tool(&name, &input),
                                name,
                                input,
                            });
                        }
                        _ => {}
                    }
                }
                out
            }

            Some("user") => {
                let mut out = vec![];
                for block in v["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_result" {
                        out.push(AgentEvent::ToolResult {
                            tool_id: block["tool_use_id"].as_str().unwrap_or_default().into(),
                            is_error: block["is_error"].as_bool().unwrap_or(false),
                            output: truncate(&tool_result_text(&block["content"]), 2000),
                        });
                    }
                }
                out
            }

            Some("control_request") if v["request"]["subtype"] == "can_use_tool" => {
                let req = &v["request"];
                vec![AgentEvent::WaitingPermission {
                    request_id: v["request_id"].as_str().unwrap_or_default().into(),
                    tool_name: req["tool_name"].as_str().unwrap_or("?").into(),
                    input: req["input"].clone(),
                    description: req["description"].as_str().map(String::from),
                }]
            }

            Some("result") => {
                let subtype = v["subtype"].as_str().unwrap_or("");
                let failed = v["is_error"].as_bool().unwrap_or(false) || subtype != "success";
                if failed {
                    let msg = v["result"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .unwrap_or_else(|| format!("La tarea terminó con error ({subtype})"));
                    vec![AgentEvent::Error { message: msg }]
                } else {
                    vec![AgentEvent::Done {
                        session_id: v["session_id"].as_str().map(String::from),
                        duration_ms: v["duration_ms"].as_u64(),
                        result: v["result"].as_str().map(String::from),
                    }]
                }
            }

            _ => vec![],
        }
    }
}

/// Texto corto y legible de lo que hace una herramienta.
fn summarize_tool(name: &str, input: &Value) -> String {
    let pick = |keys: &[&str]| {
        keys.iter()
            .find_map(|k| input[*k].as_str())
            .map(|s| truncate(s, 140))
    };
    let detail = match name {
        "Bash" | "PowerShell" => pick(&["command"]),
        "Read" | "Edit" | "Write" | "NotebookEdit" => pick(&["file_path", "notebook_path"]),
        "Grep" | "Glob" => pick(&["pattern"]),
        "WebFetch" => pick(&["url"]),
        "WebSearch" => pick(&["query"]),
        _ => pick(&["description", "prompt", "command", "file_path"]),
    };
    match detail {
        Some(d) => format!("{name}: {d}"),
        None => name.to_string(),
    }
}

fn tool_result_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|i| i["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}
