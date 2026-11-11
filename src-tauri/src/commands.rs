//! Comandos de Tauri para controlar el agente desde el frontend.

use crate::agent::{
    self,
    process::{self, SessionSlot},
    AgentConfig, AgentEvent,
};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AgentState {
    config: Mutex<AgentConfig>,
    config_path: PathBuf,
    session: SessionSlot,
    last_session_id: Arc<Mutex<Option<String>>>,
    next_generation: AtomicU64,
}

impl AgentState {
    pub fn load(config_path: PathBuf) -> Self {
        let config = fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            config: Mutex::new(config),
            config_path,
            session: Arc::default(),
            last_session_id: Arc::default(),
            next_generation: AtomicU64::new(1),
        }
    }

    fn save(&self, cfg: &AgentConfig) {
        if let Some(dir) = self.config_path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(cfg) {
            let _ = fs::write(&self.config_path, json);
        }
    }

    pub(crate) fn stop_session(&self) {
        if let Some(sess) = self.session.lock().unwrap().as_ref() {
            sess.kill();
        }
    }
}

/// Configuración con el cwd efectivo resuelto (para mostrar en la UI).
#[derive(serde::Serialize)]
pub struct ConfigView {
    #[serde(flatten)]
    config: AgentConfig,
    effective_cwd: String,
}

fn view(app: &AppHandle, cfg: AgentConfig) -> ConfigView {
    let effective_cwd = cfg
        .cwd
        .clone()
        .or_else(|| app.path().home_dir().ok().map(|p| p.display().to_string()))
        .unwrap_or_default();
    ConfigView { config: cfg, effective_cwd }
}

/// Archivo de recuerdos de Mizu (junto a config.json).
fn memory_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| crate::memory::path_in(&d))
}

#[tauri::command]
pub fn memory_list(app: AppHandle) -> Vec<crate::memory::Note> {
    memory_file(&app).map(|p| crate::memory::load(&p)).unwrap_or_default()
}

/// Borra un recuerdo. Se aplica a las conversaciones nuevas: la actual ya lo tiene en su contexto.
#[tauri::command]
pub fn memory_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = memory_file(&app).ok_or("No hay carpeta de configuración")?;
    crate::memory::remove(&path, &id)
}

#[tauri::command]
pub fn memory_clear(app: AppHandle) -> Result<(), String> {
    let path = memory_file(&app).ok_or("No hay carpeta de configuración")?;
    crate::memory::clear(&path)
}

#[tauri::command]
pub fn agent_get_config(app: AppHandle, state: State<AgentState>) -> ConfigView {
    view(&app, state.config.lock().unwrap().clone())
}

#[tauri::command]
pub fn agent_set_config(
    app: AppHandle,
    state: State<AgentState>,
    config: AgentConfig,
) -> Result<ConfigView, String> {
    if agent::adapter_for(&config.adapter).is_none() {
        return Err(format!("Adaptador desconocido: {}", config.adapter));
    }
    state.save(&config);
    *state.config.lock().unwrap() = config.clone();
    // Cambiar cwd/comando/modo implica una conversación nueva.
    state.stop_session();
    *state.last_session_id.lock().unwrap() = None;
    Ok(view(&app, config))
}

/// Cambia la forma de hablar (`mizu` o `claude`). El prompt se fija al lanzar el CLI, así que se reinicia el proceso, pero
/// se conserva la conversación: la siguiente petición retoma la misma sesión con `--resume`.
#[tauri::command]
pub fn agent_set_persona(
    app: AppHandle,
    state: State<AgentState>,
    persona: String,
) -> Result<ConfigView, String> {
    let config = {
        let mut cfg = state.config.lock().unwrap();
        cfg.persona = Some(persona);
        cfg.clone()
    };
    state.save(&config);
    state.stop_session();
    Ok(view(&app, config))
}

/// Activa o desactiva el control del PC (servidor MCP de escritorio). Como la forma de hablar, se fija al lanzar el CLI:
/// se reinicia el proceso pero se conserva la conversación (`--resume`).
#[tauri::command]
pub fn agent_set_desktop(
    app: AppHandle,
    state: State<AgentState>,
    enabled: bool,
) -> Result<ConfigView, String> {
    let config = {
        let mut cfg = state.config.lock().unwrap();
        cfg.desktop = Some(enabled);
        cfg.clone()
    };
    state.save(&config);
    state.stop_session();
    Ok(view(&app, config))
}

#[tauri::command]
pub fn agent_send(app: AppHandle, state: State<AgentState>, text: String) -> Result<(), String> {
    let mut slot = state.session.lock().unwrap();
    // Dos intentos: si la sesión existente tiene la tubería rota (el CLI murió sin que nos enteráramos),
    // se descarta y se relanza una vez retomando la conversación, sin que el usuario tenga que repetir nada.
    let mut last_err = String::new();
    for _ in 0..2 {
        if slot.is_none() {
            let mut cfg = state.config.lock().unwrap().clone();
            cfg.memory_path = memory_file(&app);
            let adapter = agent::adapter_for(&cfg.adapter)
                .ok_or_else(|| format!("Adaptador desconocido: {}", cfg.adapter))?;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let generation = state.next_generation.fetch_add(1, Ordering::SeqCst);
            let resume = state.last_session_id.lock().unwrap().clone();
            let session = process::spawn(
                &app,
                adapter,
                &cfg,
                home,
                resume,
                generation,
                state.session.clone(),
                state.last_session_id.clone(),
            )
            .map_err(|e| agent::errors::explain(&e))?;
            *slot = Some(session);
        }
        match slot.as_mut().unwrap().send_user_message(&text) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = e;
                if let Some(s) = slot.take() {
                    s.kill();
                }
            }
        }
    }
    Err(agent::errors::explain(&last_err))
}

#[tauri::command]
pub fn agent_respond_permission(
    state: State<AgentState>,
    request_id: String,
    allow: bool,
    message: Option<String>,
    updated_input: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut slot = state.session.lock().unwrap();
    let session = slot.as_mut().ok_or("No hay una sesión activa")?;
    session.respond_permission(&request_id, allow, message.as_deref(), updated_input)
}

/// Interrumpe el turno actual. La siguiente petición retoma la misma conversación.
#[tauri::command]
pub fn agent_stop(state: State<AgentState>) {
    state.stop_session();
}

/// Cierra la aplicación. El hook `RunEvent::Exit` (lib.rs) termina el proceso del CLI.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Descarta la conversación actual y empieza una nueva.
#[tauri::command]
pub fn agent_new_conversation(app: AppHandle, state: State<AgentState>) {
    state.stop_session();
    *state.last_session_id.lock().unwrap() = None;
    let _ = app.emit(process::EVENT_CHANNEL, &AgentEvent::Idle);
}
