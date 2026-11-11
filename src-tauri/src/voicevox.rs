//! Voz en vivo de Mizu: puente con el motor VOICEVOX local (HTTP en 127.0.0.1:50021).
//!
//! La app lo arranca sola si lo encuentra instalado (sin ventana) y lo cierra al salir; si ya estaba abierto (por
//! ejemplo, con la aplicación de VOICEVOX), lo usa tal cual y no lo toca. Las peticiones se hacen desde aquí y no
//! desde el WebView para no depender de la política CORS del motor. Sin motor, la app sigue con las frases grabadas.

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 50021;

/// Proceso del motor, solo si lo lanzó esta app.
#[derive(Default)]
pub struct VoiceEngine {
    child: Mutex<Option<Child>>,
}

impl VoiceEngine {
    /// Cierra el motor si lo lanzamos nosotros.
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(serde::Serialize)]
pub struct EngineStatus {
    /// El motor responde en su puerto.
    running: bool,
    /// Se encontró el ejecutable del motor en el disco.
    installed: bool,
    /// Lo lanzó esta app y aún está arrancando o en marcha.
    launched: bool,
    path: Option<String>,
}

/// Dónde puede estar `run.exe`: variable `MIZU_VOICEVOX`, la carpeta propia de Mizu y la instalación normal de VOICEVOX.
fn find_engine() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "run.exe" } else { "run" };
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(p) = std::env::var("MIZU_VOICEVOX") {
        let p = PathBuf::from(p);
        candidates.push(if p.is_dir() { p.join(exe) } else { p });
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        let own = local.join("Mizu-IA").join("voicevox-engine");
        candidates.push(own.join(exe));
        // El paquete puede traer una carpeta dentro (`windows-cpu/run.exe`...).
        if let Ok(entries) = std::fs::read_dir(&own) {
            for e in entries.flatten() {
                candidates.push(e.path().join(exe));
            }
        }
        candidates.push(local.join("Programs").join("VOICEVOX").join("vv-engine").join(exe));
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(pf).join("VOICEVOX").join("vv-engine").join(exe));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn port_open() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Petición HTTP/1.1 mínima contra el motor local. Devuelve (código, cuerpo).
fn http(method: &str, path: &str, body: Option<&[u8]>, timeout: Duration) -> Result<(u16, Vec<u8>), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(800))
        .map_err(|_| "El motor de voz no está en marcha".to_string())?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
    let body = body.unwrap_or(&[]);
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nAccept: */*\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(body).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| format!("El motor de voz no respondió: {e}"))?;

    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("Respuesta del motor de voz incompleta")?;
    let header = String::from_utf8_lossy(&raw[..split]).to_string();
    let payload = raw[split + 4..].to_vec();
    let status: u16 = header.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let chunked = header.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    Ok((status, if chunked { dechunk(&payload) } else { payload }))
}

/// Deshace la codificación por trozos (`Transfer-Encoding: chunked`).
fn dechunk(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        let Some(end) = data[i..].windows(2).position(|w| w == b"\r\n") else { break };
        let line = String::from_utf8_lossy(&data[i..i + end]);
        let size = usize::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16).unwrap_or(0);
        i += end + 2;
        if size == 0 || i + size > data.len() {
            break;
        }
        out.extend_from_slice(&data[i..i + size]);
        i += size + 2;
    }
    out
}

fn encode_query(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn status_of(engine: &VoiceEngine) -> EngineStatus {
    let path = find_engine();
    let launched = {
        let mut child = engine.child.lock().unwrap();
        // Si el proceso que lanzamos murió, se olvida para poder relanzarlo.
        if child.as_mut().is_some_and(|c| !matches!(c.try_wait(), Ok(None))) {
            *child = None;
        }
        child.is_some()
    };
    EngineStatus { running: port_open(), installed: path.is_some(), launched, path: path.map(|p| p.display().to_string()) }
}

#[tauri::command(async)]
pub fn voice_engine_status(engine: tauri::State<VoiceEngine>) -> EngineStatus {
    status_of(&engine)
}

/// Arranca el motor si está instalado y no hay ninguno en marcha. No espera a que esté listo (tarda unos segundos):
/// el frontend consulta `voice_engine_status` hasta que responde.
#[tauri::command(async)]
pub fn voice_engine_start(engine: tauri::State<VoiceEngine>) -> Result<EngineStatus, String> {
    let now = status_of(&engine);
    if now.running || now.launched {
        return Ok(now);
    }
    let Some(path) = find_engine() else { return Ok(now) };
    let mut cmd = Command::new(&path);
    cmd.args(["--host", HOST, "--port", &PORT.to_string()])
        .current_dir(path.parent().unwrap_or(std::path::Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = cmd.spawn().map_err(|e| format!("No se pudo arrancar el motor de voz: {e}"))?;
    *engine.child.lock().unwrap() = Some(child);
    Ok(status_of(&engine))
}

/// Apaga el motor (solo si lo lanzó esta app): libera su memoria cuando se desactiva la voz en vivo.
#[tauri::command(async)]
pub fn voice_engine_stop(engine: tauri::State<VoiceEngine>) {
    engine.stop();
}

/// Prepara la voz para que la primera frase no tarde (carga el modelo del hablante).
#[tauri::command(async)]
pub fn voice_warmup(speaker: u32) -> Result<(), String> {
    let (status, _) = http("POST", &format!("/initialize_speaker?speaker={speaker}&skip_reinit=true"), None, Duration::from_secs(90))?;
    if status >= 400 { Err(format!("El motor de voz respondió {status}")) } else { Ok(()) }
}

/// Paso 1 de la síntesis: la «consulta de audio» (JSON con la entonación y la duración de cada sílaba).
#[tauri::command(async)]
pub fn voice_query(text: String, speaker: u32) -> Result<String, String> {
    let (status, body) = http("POST", &format!("/audio_query?speaker={speaker}&text={}", encode_query(&text)), None, Duration::from_secs(30))?;
    let body = String::from_utf8_lossy(&body).to_string();
    if status != 200 { Err(format!("El motor de voz respondió {status}: {body}")) } else { Ok(body) }
}

/// Paso 2: el audio (WAV) de una consulta, quizá retocada por el frontend (velocidad, entonación).
#[tauri::command(async)]
pub fn voice_synthesis(query: String, speaker: u32) -> Result<tauri::ipc::Response, String> {
    let (status, body) = http("POST", &format!("/synthesis?speaker={speaker}"), Some(query.as_bytes()), Duration::from_secs(120))?;
    if status != 200 {
        return Err(format!("El motor de voz respondió {status}: {}", String::from_utf8_lossy(&body)));
    }
    Ok(tauri::ipc::Response::new(body))
}
