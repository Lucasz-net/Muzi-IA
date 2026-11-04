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
