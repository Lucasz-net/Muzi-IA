mod agent;
mod commands;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            app.manage(commands::AgentState::load(config_path));

            let win = app
                .get_webview_window("main")
                .expect("ventana 'main' no encontrada");
            window::anchor_bottom_right(&win)?;
            window::spawn_cursor_tracker(win);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::set_click_through,
            commands::agent_get_config,
            commands::agent_set_config,
            commands::agent_send,
            commands::agent_respond_permission,
            commands::agent_stop,
            commands::agent_new_conversation,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Al salir (botón ✕, Alt+F4...) no debe quedar el CLI huérfano.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<commands::AgentState>() {
                    state.stop_session();
                }
            }
        });
}
