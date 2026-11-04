//! Capa de adaptadores: traduce la salida de cada CLI de IA a eventos normalizados.
//!
//! Para soportar otro CLI (Codex, Gemini CLI, ...):
//!   1. Crea `agent/<nombre>.rs` con una struct que implemente [`AgentAdapter`]
//!      (y un [`EventParser`] que convierta cada línea de salida en [`AgentEvent`]).
//!   2. Regístralo en [`adapter_for`].
//! El resto de la app (proceso hijo, eventos de Tauri, frontend) no cambia.

pub mod claude_code;
pub mod process;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};

/// Eventos normalizados que el frontend recibe (canal `agent-event`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// El CLI arrancó una sesión.
    SessionStarted { session_id: String, model: Option<String> },
    /// Sin actividad.
    Idle,
    /// El modelo está razonando / generando.
    Thinking,
    /// El agente va a usar una herramienta.
    ToolUse { tool_id: String, name: String, input: Value, summary: String },
    /// Resultado de una herramienta (para el historial).
    ToolResult { tool_id: String, is_error: bool, output: String },
    /// El agente necesita aprobación del usuario.
    WaitingPermission {
        request_id: String,
        tool_name: String,
        input: Value,
        description: Option<String>,
    },
    /// Texto del agente. `is_delta` = fragmento en streaming; si es false, bloque completo.
    Message { text: String, is_delta: bool },
    /// El turno terminó correctamente.
    Done { session_id: Option<String>, duration_ms: Option<u64>, result: Option<String> },
    /// Error del CLI o del turno.
    Error { message: String },
}

/// Configuración del agente (persistida en el directorio de configuración de la app).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    /// Id del adaptador (ver [`adapter_for`]).
    pub adapter: String,
    /// Directorio de trabajo del CLI. `None` = carpeta personal del usuario.
    pub cwd: Option<String>,
    /// Ruta explícita al ejecutable. `None` = buscarlo en el PATH.
    pub command: Option<String>,
    /// Modo de permisos del CLI (`default`, `acceptEdits`, `plan`...). `None` = el del CLI.
    pub permission_mode: Option<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            adapter: "claude-code".into(),
            cwd: None,
            command: None,
            permission_mode: None,
        }
    }
}

/// Cómo lanzar el proceso hijo.
pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Variables de entorno a quitar (p. ej. claves de API para forzar el login de suscripción).
    pub env_remove: Vec<&'static str>,
}

/// Convierte líneas de salida de un CLI en eventos normalizados. Tiene estado por sesión.
pub trait EventParser: Send {
    fn parse_line(&mut self, line: &str) -> Vec<AgentEvent>;
}

/// Contrato que implementa cada CLI soportado.
#[allow(dead_code)] // id/display_name se usarán al listar adaptadores en la UI
pub trait AgentAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    /// Construye el comando. `resume` = id de sesión previa para continuar la conversación.
    fn spawn_spec(&self, cfg: &AgentConfig, resume: Option<&str>) -> Result<SpawnSpec, String>;
    /// Línea (sin salto final) que se escribe en stdin para enviar un mensaje del usuario.
    fn encode_user_message(&self, text: &str) -> String;
    /// Línea para responder a una solicitud de permiso. `input` es el original de la solicitud.
    fn encode_permission_response(
        &self,
        request_id: &str,
        allow: bool,
        input: &Value,
        message: Option<&str>,
    ) -> Option<String>;
    fn new_parser(&self) -> Box<dyn EventParser>;
}

/// Registro de adaptadores disponibles.
pub fn adapter_for(id: &str) -> Option<Arc<dyn AgentAdapter>> {
    match id {
        "claude-code" => Some(Arc::new(claude_code::ClaudeCodeAdapter)),
        _ => None,
    }
}

/// Busca un ejecutable en el PATH (en Windows respeta PATHEXT, así que encuentra `claude.cmd`).
pub fn resolve_executable(explicit: Option<&str>, name: &str) -> Result<PathBuf, String> {
    if let Some(p) = explicit.filter(|p| !p.trim().is_empty()) {
        let path = PathBuf::from(p);
        return if path.exists() {
            Ok(path)
        } else {
            Err(format!("No existe el ejecutable configurado: {p}"))
        };
    }
    which::which(name).map_err(|_| format!("No se encontró `{name}` en el PATH. ¿Está instalado?"))
}
