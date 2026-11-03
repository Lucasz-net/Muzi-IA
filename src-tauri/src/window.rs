//! Comportamiento de la ventana del compañero: posición inicial y click-through.
//!
//! Tauri solo permite ignorar los eventos del cursor para la ventana completa
//! (`set_ignore_cursor_events`). Para capturar clics únicamente sobre el personaje
//! y la UI, este módulo emite la posición del cursor relativa a la ventana
//! (en píxeles lógicos) y el frontend decide, con un hit-test, si activa o no
//! el click-through llamando a `set_click_through`.

use std::{thread, time::Duration};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Clone, serde::Serialize)]
struct CursorPayload {
    x: f64,
    y: f64,
}

/// Coloca la ventana abajo a la derecha del monitor principal (área de trabajo).
pub fn anchor_bottom_right(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let work = monitor.work_area();
        let size = window.outer_size()?;
        let margin = (16.0 * monitor.scale_factor()) as i32;
        let x = work.position.x + work.size.width as i32 - size.width as i32 - margin;
        let y = work.position.y + work.size.height as i32 - size.height as i32 - margin;
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

/// Hilo que sondea el cursor global y emite `cursor-moved` al frontend.
pub fn spawn_cursor_tracker(window: WebviewWindow) {
    thread::spawn(move || {
        let mut last: Option<(i64, i64)> = None;
        loop {
            thread::sleep(Duration::from_millis(33));
            let (Ok(cursor), Ok(pos), Ok(scale)) = (
                window.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let x = (cursor.x - pos.x as f64) / scale;
            let y = (cursor.y - pos.y as f64) / scale;
            let key = (x.round() as i64, y.round() as i64);
            if last == Some(key) {
                continue;
            }
            last = Some(key);
            let _ = window.app_handle().emit("cursor-moved", CursorPayload { x, y });
        }
    });
}

#[tauri::command]
pub fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}
