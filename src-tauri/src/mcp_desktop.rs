//! Servidor MCP (Model Context Protocol, JSON-RPC por stdio) de control de escritorio.
//!
//! Es el mismo ejecutable de la app con `--mcp-desktop`: Claude Code lo lanza como servidor MCP (ver
//! `agent/claude_code.rs`) para que Mizu pueda ver la pantalla y manejar el ratón y el teclado. Se hace en Rust y no como
//! script de PowerShell porque Windows Defender bloquea como "malintencionado" cualquier script que inyecte teclas y
//! ratón; un programa compilado, con crates conocidos (`enigo` para la entrada y `xcap` para las capturas), no tiene ese
//! problema y además arranca al instante.
//!
//! Cada herramienta pasa por el flujo de permisos de la app (Aceptar / Rechazar): ninguna se ejecuta sin aprobarse.
//! Las coordenadas del ratón son las de la imagen de `screenshot` (la última tomada); el servidor las convierte a
//! píxeles reales de la pantalla.

use base64::Engine as _;
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ExtendedColorType};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::thread::sleep;
use std::time::Duration;

/// Ancho máximo (px) de las capturas: más pequeñas pesan menos y a Claude le basta.
const MAX_SHOT_WIDTH: u32 = 1568;

fn ms(n: u64) {
    sleep(Duration::from_millis(n));
}

struct Desktop {
    enigo: Enigo,
    /// Píxeles reales por píxel de la última captura.
    scale: f64,
    /// Esquina superior izquierda (px reales) de la pantalla de la última captura.
    origin: (i32, i32),
}

type ToolResult = Result<Value, String>;

fn text(t: impl Into<String>) -> Value {
    json!({ "type": "text", "text": t.into() })
}
fn ok(t: impl Into<String>) -> ToolResult {
    Ok(json!({ "content": [text(t)] }))
}
fn arg_f(a: &Value, k: &str) -> Result<f64, String> {
    a.get(k).and_then(Value::as_f64).ok_or_else(|| format!("Falta el parámetro numérico '{k}'."))
}
fn arg_s<'a>(a: &'a Value, k: &str) -> Result<&'a str, String> {
    a.get(k).and_then(Value::as_str).ok_or_else(|| format!("Falta el parámetro de texto '{k}'."))
}
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Nombre de tecla -> tecla de `enigo`. Las letras y los números van como códigos virtuales para que valgan en atajos
/// (Ctrl+C); `Key::Unicode` enviaría el carácter suelto y no activaría el atajo.
fn parse_key(name: &str) -> Result<Key, String> {
    let n = name.trim().to_lowercase();
    let k = match n.as_str() {
        "ctrl" | "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" => Key::Alt,
        "win" | "windows" | "meta" | "super" => Key::Meta,
        "enter" | "return" | "intro" => Key::Return,
        "esc" | "escape" => Key::Escape,
        "tab" => Key::Tab,
        "space" | "espacio" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" | "supr" => Key::Delete,
        "insert" => Key::Insert,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "printscreen" => Key::PrintScr,
        "volumeup" => Key::VolumeUp,
        "volumedown" => Key::VolumeDown,
        "mute" | "volumemute" => Key::VolumeMute,
        "playpause" => Key::MediaPlayPause,
        "nexttrack" => Key::MediaNextTrack,
        "prevtrack" => Key::MediaPrevTrack,
        "plus" => Key::Add,
        "minus" => Key::Subtract,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        s if s.len() == 1 && s.chars().all(|c| c.is_ascii_alphanumeric()) => {
            // En Windows el código virtual de A-Z y 0-9 es su ASCII en mayúscula.
            Key::Other(s.to_ascii_uppercase().as_bytes()[0] as u32)
        }
        _ => {
            return Err(format!(
                "Tecla desconocida: '{name}'. Usa nombres como ctrl, shift, alt, win, enter, esc, tab, space, backspace, delete, up, down, left, right, f1..f12, una letra o un número."
            ))
        }
    };
    Ok(k)
}

impl Desktop {
    fn new() -> Result<Self, String> {
        let enigo = Enigo::new(&Settings::default()).map_err(err)?;
        Ok(Self { enigo, scale: 1.0, origin: (0, 0) })
    }

    fn real(&self, x: f64, y: f64) -> (i32, i32) {
        (self.origin.0 + (x * self.scale).round() as i32, self.origin.1 + (y * self.scale).round() as i32)
    }

    fn move_to(&mut self, x: f64, y: f64) -> Result<(), String> {
        let (rx, ry) = self.real(x, y);
        self.enigo.move_mouse(rx, ry, Coordinate::Abs).map_err(err)
    }

    /// Las pantallas, con la principal siempre en el índice 0.
    fn monitors() -> Result<Vec<xcap::Monitor>, String> {
        let mut all = xcap::Monitor::all().map_err(err)?;
        all.sort_by_key(|m| !m.is_primary().unwrap_or(false));
        Ok(all)
    }

    fn screenshot(&mut self, index: usize) -> ToolResult {
        let monitors = Self::monitors()?;
        let m = monitors.get(index).ok_or_else(|| format!("No existe la pantalla {index} (hay {}).", monitors.len()))?;
        let (x, y, w, h) = (m.x().map_err(err)?, m.y().map_err(err)?, m.width().map_err(err)?, m.height().map_err(err)?);
        let rgb = DynamicImage::ImageRgba8(m.capture_image().map_err(err)?).to_rgb8();
        let out_w = w.min(MAX_SHOT_WIDTH);
        let out_h = ((h as f64) * (out_w as f64) / (w as f64)).round().max(1.0) as u32;
        let small = if out_w == w { rgb } else { image::imageops::resize(&rgb, out_w, out_h, FilterType::Triangle) };
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 75)
            .encode(small.as_raw(), small.width(), small.height(), ExtendedColorType::Rgb8)
            .map_err(err)?;
        self.scale = w as f64 / small.width() as f64;
        self.origin = (x, y);
        Ok(json!({ "content": [
            { "type": "image", "data": base64::engine::general_purpose::STANDARD.encode(&jpeg), "mimeType": "image/jpeg" },
            text(format!(
                "Pantalla {index}: {w}x{h} píxeles reales; imagen de {}x{}. Las coordenadas de las herramientas de ratón son de esta imagen.",
                small.width(), small.height()
            )),
        ] }))
    }

    fn screen_info(&self) -> ToolResult {
        let lines: Vec<String> = Self::monitors()?
            .iter()
            .enumerate()
            .map(|(i, m)| {
                format!(
                    "Pantalla {i}: {}x{} en ({}, {}){}",
                    m.width().unwrap_or(0),
                    m.height().unwrap_or(0),
                    m.x().unwrap_or(0),
                    m.y().unwrap_or(0),
                    if m.is_primary().unwrap_or(false) { " (principal)" } else { "" }
                )
            })
            .collect();
        ok(lines.join("\n"))
    }

    fn cursor_position(&self) -> ToolResult {
        let (rx, ry) = self.enigo.location().map_err(err)?;
        let x = ((rx - self.origin.0) as f64 / self.scale).round() as i32;
        let y = ((ry - self.origin.1) as f64 / self.scale).round() as i32;
        ok(format!("Ratón en ({x}, {y}) de la última captura (píxeles reales: {rx}, {ry})."))
    }

    fn click(&mut self, a: &Value) -> ToolResult {
        let (x, y) = (arg_f(a, "x")?, arg_f(a, "y")?);
        let button = match a.get("button").and_then(Value::as_str).unwrap_or("left") {
            "left" => Button::Left,
            "right" => Button::Right,
            "middle" => Button::Middle,
            other => return Err(format!("Botón desconocido: '{other}' (usa left, right o middle).")),
        };
        let double = a.get("double").and_then(Value::as_bool).unwrap_or(false);
        self.move_to(x, y)?;
        ms(50);
        self.enigo.button(button, Direction::Click).map_err(err)?;
        if double {
            ms(80);
            self.enigo.button(button, Direction::Click).map_err(err)?;
        }
        ok(format!("Clic{} en ({x}, {y}).", if double { " doble" } else { "" }))
    }

    fn drag(&mut self, a: &Value) -> ToolResult {
        let (x1, y1, x2, y2) = (arg_f(a, "from_x")?, arg_f(a, "from_y")?, arg_f(a, "to_x")?, arg_f(a, "to_y")?);
        self.move_to(x1, y1)?;
        ms(80);
        self.enigo.button(Button::Left, Direction::Press).map_err(err)?;
        ms(80);
        let steps = 12;
        for s in 1..=steps {
            let t = s as f64 / steps as f64;
            self.move_to(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)?;
            ms(15);
        }
        ms(80);
        self.enigo.button(Button::Left, Direction::Release).map_err(err)?;
        ok(format!("Arrastrado de ({x1}, {y1}) a ({x2}, {y2})."))
    }

    fn scroll(&mut self, a: &Value) -> ToolResult {
        let (x, y) = (arg_f(a, "x")?, arg_f(a, "y")?);
        let amount = (arg_f(a, "amount")? as i32).clamp(-50, 50);
        self.move_to(x, y)?;
        ms(40);
        // Positivo = hacia abajo.
        self.enigo.scroll(amount, Axis::Vertical).map_err(err)?;
        ok(format!("Rueda {amount} en ({x}, {y})."))
    }

    fn type_text(&mut self, a: &Value) -> ToolResult {
        let t = arg_s(a, "text")?;
        if t.chars().count() > 2000 {
            return Err("El texto es demasiado largo (máximo 2000 caracteres).".into());
        }
        // El salto de línea es Intro; el resto se escribe como texto Unicode (tildes, ñ, símbolos).
        for (i, line) in t.replace('\r', "").split('\n').enumerate() {
            if i > 0 {
                self.enigo.key(Key::Return, Direction::Click).map_err(err)?;
            }
            if !line.is_empty() {
                self.enigo.text(line).map_err(err)?;
            }
        }
        ok(format!("Escritos {} caracteres.", t.chars().count()))
    }

    fn press_keys(&mut self, a: &Value) -> ToolResult {
        let combo = arg_s(a, "keys")?;
        let keys: Vec<Key> = combo.split('+').filter(|s| !s.trim().is_empty()).map(parse_key).collect::<Result<_, _>>()?;
        if keys.is_empty() {
            return Err("No se indicó ninguna tecla.".into());
        }
        for k in &keys {
            self.enigo.key(*k, Direction::Press).map_err(err)?;
            ms(15);
        }
        ms(40);
        for k in keys.iter().rev() {
            self.enigo.key(*k, Direction::Release).map_err(err)?;
            ms(15);
        }
        ok(format!("Pulsado: {combo}."))
    }

    fn list_windows(&self) -> ToolResult {
        let titles: Vec<String> = windows::list().into_iter().map(|(_, t)| t).collect();
        ok(if titles.is_empty() { "No hay ventanas abiertas con título.".to_string() } else { titles.join("\n") })
    }

    fn focus_window(&mut self, a: &Value) -> ToolResult {
        let query = arg_s(a, "title")?.to_lowercase();
        let (hwnd, title) = windows::list()
            .into_iter()
            .find(|(_, t)| t.to_lowercase().contains(&query))
            .ok_or_else(|| format!("No encuentro ninguna ventana con '{query}' en el título."))?;
        // Pulsar Alt un instante evita que Windows bloquee el cambio de foco.
        let _ = self.enigo.key(Key::Alt, Direction::Click);
        windows::focus(hwnd);
        ok(format!("Ventana al frente: {title}"))
    }

    fn call(&mut self, name: &str, a: &Value) -> ToolResult {
        match name {
            "screenshot" => self.screenshot(a.get("screen").and_then(Value::as_u64).unwrap_or(0) as usize),
            "screen_info" => self.screen_info(),
            "cursor_position" => self.cursor_position(),
            "move" => {
                let (x, y) = (arg_f(a, "x")?, arg_f(a, "y")?);
                self.move_to(x, y)?;
                ok(format!("Ratón movido a ({x}, {y})."))
            }
            "click" => self.click(a),
            "drag" => self.drag(a),
            "scroll" => self.scroll(a),
            "type_text" => self.type_text(a),
            "key" => self.press_keys(a),
            "list_windows" => self.list_windows(),
            "focus_window" => self.focus_window(a),
            "wait" => {
                let n = (arg_f(a, "ms")? as u64).min(10_000);
                ms(n);
                ok(format!("Esperados {n} ms."))
            }
            other => Err(format!("Herramienta desconocida: {other}")),
        }
    }
}

/// Ventanas de Windows con título (para `list_windows` y `focus_window`).
#[cfg(windows)]
mod windows {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
        // SAFETY: `lparam` es el puntero al `Vec` que `list` pasó a `EnumWindows` y vive durante toda la llamada.
        unsafe {
            let out = &mut *(lparam as *mut Vec<(isize, String)>);
            if IsWindowVisible(hwnd) != 0 {
                let len = GetWindowTextLengthW(hwnd);
                if len > 0 {
                    let mut buf = vec![0u16; len as usize + 1];
                    let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
                    let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
                    if !title.is_empty() && title != "Program Manager" {
                        out.push((hwnd as isize, title));
                    }
                }
            }
        }
        1 // seguir enumerando
    }

    pub fn list() -> Vec<(isize, String)> {
        let mut out: Vec<(isize, String)> = Vec::new();
        // SAFETY: el callback solo usa el puntero mientras dura `EnumWindows`.
        unsafe {
            EnumWindows(Some(collect), &mut out as *mut _ as LPARAM);
        }
        out
    }

    pub fn focus(hwnd: isize) {
        let h = hwnd as HWND;
        // SAFETY: llamadas simples a la API de ventanas con un identificador obtenido de `list`.
        unsafe {
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_RESTORE);
            }
            SetForegroundWindow(h);
        }
    }
}

#[cfg(not(windows))]
mod windows {
    pub fn list() -> Vec<(isize, String)> {
        Vec::new()
    }
    pub fn focus(_hwnd: isize) {}
}

const TOOLS: &str = r#"[
 {"name":"screenshot","description":"Hace una captura de la pantalla y la devuelve como imagen. Hay que llamarla antes de usar el ratón: las coordenadas de click, move, drag y scroll son de la última captura.","inputSchema":{"type":"object","properties":{"screen":{"type":"integer","description":"Número de pantalla (0 = la principal)."}}}},
 {"name":"screen_info","description":"Tamaño y posición de cada pantalla conectada.","inputSchema":{"type":"object","properties":{}}},
 {"name":"cursor_position","description":"Posición actual del ratón, en las coordenadas de la última captura.","inputSchema":{"type":"object","properties":{}}},
 {"name":"move","description":"Mueve el ratón a (x, y) de la última captura.","inputSchema":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"}},"required":["x","y"]}},
 {"name":"click","description":"Hace clic en (x, y) de la última captura. Con double=true, doble clic.","inputSchema":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"button":{"type":"string","enum":["left","right","middle"]},"double":{"type":"boolean"}},"required":["x","y"]}},
 {"name":"drag","description":"Arrastra con el botón izquierdo desde (from_x, from_y) hasta (to_x, to_y).","inputSchema":{"type":"object","properties":{"from_x":{"type":"number"},"from_y":{"type":"number"},"to_x":{"type":"number"},"to_y":{"type":"number"}},"required":["from_x","from_y","to_x","to_y"]}},
 {"name":"scroll","description":"Gira la rueda del ratón sobre (x, y). amount positivo = hacia abajo, negativo = hacia arriba (cada unidad es una muesca).","inputSchema":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"amount":{"type":"integer"}},"required":["x","y","amount"]}},
 {"name":"type_text","description":"Escribe texto en la ventana que tenga el foco (admite tildes, ñ y símbolos; \\n es Intro). Máximo 2000 caracteres.","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}},
 {"name":"key","description":"Pulsa una tecla o combinación, por ejemplo 'enter', 'ctrl+c', 'alt+tab', 'win+d', 'ctrl+shift+esc', 'volumeup'.","inputSchema":{"type":"object","properties":{"keys":{"type":"string"}},"required":["keys"]}},
 {"name":"list_windows","description":"Lista los títulos de las ventanas abiertas.","inputSchema":{"type":"object","properties":{}}},
 {"name":"focus_window","description":"Trae al frente la primera ventana cuyo título contenga el texto dado.","inputSchema":{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}},
 {"name":"wait","description":"Espera unos milisegundos (máximo 10000), por ejemplo mientras abre un programa.","inputSchema":{"type":"object","properties":{"ms":{"type":"integer"}},"required":["ms"]}}
]"#;

fn reply(out: &mut impl Write, id: &Value, result: Value) {
    let _ = writeln!(out, "{}", json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    let _ = out.flush();
}
fn reply_error(out: &mut impl Write, id: &Value, code: i32, message: &str) {
    let _ = writeln!(out, "{}", json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }));
    let _ = out.flush();
}

/// Bucle del servidor: un mensaje JSON-RPC por línea de stdin; respuestas por stdout (nada más debe escribirse ahí).
pub fn run() {
    let tools: Value = serde_json::from_str(TOOLS).expect("TOOLS es JSON válido");
    let mut desktop = Desktop::new();
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
                    json!({ "protocolVersion": version, "capabilities": { "tools": {} }, "serverInfo": { "name": "mizu-desktop", "version": "0.1.0" } }),
                );
            }
            ("ping", Some(id)) => reply(&mut out, id, json!({})),
            ("tools/list", Some(id)) => reply(&mut out, id, json!({ "tools": tools })),
            ("tools/call", Some(id)) => {
                let name = msg["params"]["name"].as_str().unwrap_or("");
                let args = msg["params"]["arguments"].clone();
                let args = if args.is_null() { json!({}) } else { args };
                let result = match &mut desktop {
                    Ok(d) => d.call(name, &args),
                    Err(e) => Err(format!("No se pudo preparar el control del escritorio: {e}")),
                };
                match result {
                    Ok(r) => reply(&mut out, id, r),
                    Err(e) => reply(&mut out, id, json!({ "content": [text(format!("Error: {e}"))], "isError": true })),
                }
            }
            (_, Some(id)) => reply_error(&mut out, id, -32601, &format!("Método no soportado: {method}")),
            _ => {} // notificaciones (p. ej. notifications/initialized): no se responden
        }
    }
}
