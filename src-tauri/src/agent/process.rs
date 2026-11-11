//! Ciclo de vida del proceso hijo del CLI: spawn, stdin/stdout, eventos y cierre.

use super::{AgentAdapter, AgentConfig, AgentEvent};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter};

/// Canal de eventos hacia el frontend.
pub const EVENT_CHANNEL: &str = "agent-event";

pub type SessionSlot = Arc<Mutex<Option<AgentSession>>>;

/// Segundos sin ninguna salida del CLI, con un turno en marcha y sin permisos pendientes, tras los cuales
/// se da por colgado. Es generoso a propósito: una compilación o unos tests largos pueden callar mucho rato.
const HANG_SECS: u64 = 15 * 60;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub struct AgentSession {
    pub generation: u64,
    pid: u32,
    stdin: ChildStdin,
    /// `request_id` -> `input` original de las solicitudes de permiso pendientes.
    pending: Arc<Mutex<HashMap<String, Value>>>,
    stopped: Arc<AtomicBool>,
    adapter: Arc<dyn AgentAdapter>,
    /// Hay un turno en marcha (se envió un mensaje y aún no llegó Done/Error/Idle).
    turn_active: Arc<AtomicBool>,
    /// Última vez (segundos desde la época) que el CLI escribió algo.
    last_activity: Arc<AtomicU64>,
}

impl AgentSession {
    pub fn send_user_message(&mut self, text: &str) -> Result<(), String> {
        let line = self.adapter.encode_user_message(text);
        self.last_activity.store(now_secs(), Ordering::SeqCst);
        self.turn_active.store(true, Ordering::SeqCst);
        self.write_line(&line)
    }

    pub fn respond_permission(
        &mut self,
        request_id: &str,
        allow: bool,
        message: Option<&str>,
        updated_input: Option<Value>,
    ) -> Result<(), String> {
        let original = self
            .pending
            .lock()
            .unwrap()
            .remove(request_id)
            .ok_or_else(|| format!("Solicitud de permiso desconocida: {request_id}"))?;
        // Las preguntas al usuario (AskUserQuestion) se contestan devolviendo la entrada con las respuestas añadidas.
        let input = updated_input.unwrap_or(original);
        match self.adapter.encode_permission_response(request_id, allow, &input, message) {
            Some(line) => self.write_line(&line),
            None => Ok(()),
        }
    }

    /// Termina el proceso (y sus hijos). El hilo lector emitirá `Idle`.
    pub fn kill(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        kill_tree(self.pid);
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("No se pudo escribir en el CLI: {e}"))
    }
}

pub fn spawn(
    app: &AppHandle,
    adapter: Arc<dyn AgentAdapter>,
    cfg: &AgentConfig,
    default_cwd: PathBuf,
    resume: Option<String>,
    generation: u64,
    slot: SessionSlot,
    last_session_id: Arc<Mutex<Option<String>>>,
) -> Result<AgentSession, String> {
    let spec = adapter.spawn_spec(cfg, resume.as_deref())?;
    let cwd = cfg.cwd.as_deref().map(PathBuf::from).unwrap_or(default_cwd);
    if !cwd.is_dir() {
        return Err(format!("La carpeta de trabajo no existe: {}", cwd.display()));
    }

    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for var in &spec.env_remove {
        cmd.env_remove(var);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo lanzar {}: {e}", spec.program.display()))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("stdin no disponible")?;
    let stdout = child.stdout.take().ok_or("stdout no disponible")?;
    let stderr = child.stderr.take().ok_or("stderr no disponible")?;

    let pending: Arc<Mutex<HashMap<String, Value>>> = Arc::default();
    let stopped = Arc::new(AtomicBool::new(false));
    let stderr_tail: Arc<Mutex<String>> = Arc::default();
    let turn_active = Arc::new(AtomicBool::new(false));
    let last_activity = Arc::new(AtomicU64::new(now_secs()));
    // Si el vigilante mata el CLI, aquí deja el motivo para que el lector lo cuente en vez de un "se cerró".
    let exit_reason: Arc<Mutex<Option<String>>> = Arc::default();
    let finished = Arc::new(AtomicBool::new(false));

    // Vigilante: un CLI que no escribe nada durante mucho rato en pleno turno está colgado.
    {
        let (turn_active, last_activity, pending, exit_reason, finished) =
            (turn_active.clone(), last_activity.clone(), pending.clone(), exit_reason.clone(), finished.clone());
        thread::spawn(move || {
            while !finished.load(Ordering::SeqCst) {
                thread::sleep(std::time::Duration::from_secs(30));
                let silent = now_secs().saturating_sub(last_activity.load(Ordering::SeqCst));
                let waiting_user = !pending.lock().unwrap().is_empty();
                if turn_active.load(Ordering::SeqCst) && !waiting_user && silent >= HANG_SECS {
                    *exit_reason.lock().unwrap() = Some(format!(
                        "Claude lleva {} minutos sin dar señales, así que lo he reiniciado. Pídemelo otra vez y sigo con la conversación.",
                        silent / 60
                    ));
                    kill_tree(pid);
                    return;
                }
            }
        });
    }

    // stderr: se guarda la cola para dar contexto si el proceso muere.
    {
        let tail = stderr_tail.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).split(b'\n').map_while(Result::ok) {
                let line = String::from_utf8_lossy(&line);
                eprintln!("[agent stderr] {line}");
                let mut t = tail.lock().unwrap();
                t.push_str(&line);
                t.push('\n');
                if t.len() > 2000 {
                    let cut = t.len() - 2000;
                    let cut = (cut..t.len()).find(|i| t.is_char_boundary(*i)).unwrap_or(0);
                    t.drain(..cut);
                }
            }
        });
    }

    // stdout: parsea cada línea y emite eventos; al terminar, limpia la sesión.
    {
        let app = app.clone();
        let adapter = adapter.clone();
        let pending = pending.clone();
        let stopped = stopped.clone();
        let (turn_active, last_activity, exit_reason, finished) =
            (turn_active.clone(), last_activity.clone(), exit_reason.clone(), finished.clone());
        thread::spawn(move || {
            let mut parser = adapter.new_parser();
            for raw in BufReader::new(stdout).split(b'\n').map_while(Result::ok) {
                let line = String::from_utf8_lossy(&raw);
                if line.trim().is_empty() {
                    continue;
                }
                last_activity.store(now_secs(), Ordering::SeqCst);
                for mut ev in parser.parse_line(&line) {
                    if let AgentEvent::Error { message } = &mut ev {
                        eprintln!("[agent error] {message}");
                        *message = super::errors::explain(message);
                    }
                    if matches!(ev, AgentEvent::Done { .. } | AgentEvent::Error { .. } | AgentEvent::Idle) {
                        turn_active.store(false, Ordering::SeqCst);
                    }
                    match &ev {
                        AgentEvent::WaitingPermission { request_id, input, .. } => {
                            pending.lock().unwrap().insert(request_id.clone(), input.clone());
                        }
                        AgentEvent::SessionStarted { session_id, .. } if !session_id.is_empty() => {
                            *last_session_id.lock().unwrap() = Some(session_id.clone());
                        }
                        _ => {}
                    }
                    let _ = app.emit(EVENT_CHANNEL, &ev);
                }
            }

            let status = child.wait();
            finished.store(true, Ordering::SeqCst);
            turn_active.store(false, Ordering::SeqCst);
            {
                let mut s = slot.lock().unwrap();
                if s.as_ref().is_some_and(|sess| sess.generation == generation) {
                    *s = None;
                }
            }
            let ev = if stopped.load(Ordering::SeqCst) {
                AgentEvent::Idle
            } else if let Some(message) = exit_reason.lock().unwrap().take() {
                AgentEvent::Error { message }
            } else {
                let tail = stderr_tail.lock().unwrap().trim().to_string();
                let code = status.ok().and_then(|s| s.code());
                let message = match (code, tail.is_empty()) {
                    (_, false) => {
                        let explained = super::errors::explain(&tail);
                        if explained == tail {
                            format!("Claude se cerró de golpe: {tail}. Escríbeme otra vez y retomo la conversación.")
                        } else {
                            explained
                        }
                    }
                    (Some(c), true) => format!("Claude se cerró de golpe (código {c}). Escríbeme otra vez y retomo la conversación."),
                    (None, true) => "Claude se cerró de golpe. Escríbeme otra vez y retomo la conversación.".to_string(),
                };
                AgentEvent::Error { message }
            };
            let _ = app.emit(EVENT_CHANNEL, &ev);
        });
    }

    Ok(AgentSession { generation, pid, stdin, pending, stopped, adapter, turn_active, last_activity })
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    // `claude.cmd` lanza node como nieto: hay que matar todo el árbol.
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
}
