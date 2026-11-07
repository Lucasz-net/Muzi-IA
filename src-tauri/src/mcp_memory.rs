//! Servidor MCP de memoria de Mizu (`mizu-ia --mcp-memory <archivo>`): herramientas `remember` y `forget`.
//!
//! Claude Code lo lanza como proceso hijo por stdio, igual que el de escritorio (`mcp_desktop.rs`, de donde se
//! reutilizan los ayudantes de JSON-RPC). Escribe en el mismo `memories.json` que lee la app.

use crate::{
    mcp_desktop::{reply, reply_error, text},
    memory,
};
use serde_json::{json, Value};
use std::{io::BufRead, path::Path};

const TOOLS: &str = r#"[
 {"name":"remember","description":"Guarda una nota corta y duradera sobre la persona (nombre, gustos, proyectos, cómo prefiere que le hables) para acordarte en futuras conversaciones. Una sola frase. Nunca contraseñas, claves ni datos de pago.","inputSchema":{"type":"object","properties":{"text":{"type":"string","description":"La nota, en una frase."}},"required":["text"]}},
 {"name":"forget","description":"Olvida las notas guardadas que contengan el texto dado.","inputSchema":{"type":"object","properties":{"text":{"type":"string","description":"Texto (o parte) de lo que hay que olvidar."}},"required":["text"]}}
]"#;

fn call(path: &Path, name: &str, args: &Value) -> Result<Value, String> {
    let arg = args["text"].as_str().unwrap_or("");
    match name {
        "remember" => memory::add(path, arg).map(|m| json!({ "content": [text(m)] })),
        "forget" => memory::forget_matching(path, arg).map(|n| {
            let msg = if n == 0 { "No tenía nada guardado sobre eso.".to_string() } else { format!("Olvidado ({n}).") };
            json!({ "content": [text(msg)] })
        }),
        other => Err(format!("Herramienta desconocida: {other}")),
    }
}

pub fn run(path: &Path) {
    let tools: Value = serde_json::from_str(TOOLS).expect("TOOLS es JSON válido");
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        match (method, &id) {
            ("initialize", Some(id)) => {
                let version = msg["params"]["protocolVersion"].as_str().unwrap_or("2024-11-05");
                reply(
                    &mut out,
                    id,
                    json!({ "protocolVersion": version, "capabilities": { "tools": {} }, "serverInfo": { "name": "mizu-memory", "version": "0.1.0" } }),
                );
            }
            ("ping", Some(id)) => reply(&mut out, id, json!({})),
            ("tools/list", Some(id)) => reply(&mut out, id, json!({ "tools": tools })),
            ("tools/call", Some(id)) => {
                let name = msg["params"]["name"].as_str().unwrap_or("");
                let args = msg["params"]["arguments"].clone();
                let args = if args.is_null() { json!({}) } else { args };
                match call(path, name, &args) {
                    Ok(r) => reply(&mut out, id, r),
                    Err(e) => reply(&mut out, id, json!({ "content": [text(e)], "isError": true })),
                }
            }
            (_, Some(id)) => reply_error(&mut out, id, -32601, &format!("Método no soportado: {method}")),
            _ => {}
        }
    }
}
