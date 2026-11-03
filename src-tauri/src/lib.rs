mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let win = app
                .get_webview_window("main")
                .expect("ventana 'main' no encontrada");
            window::anchor_bottom_right(&win)?;
            window::spawn_cursor_tracker(win);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![window::set_click_through])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
