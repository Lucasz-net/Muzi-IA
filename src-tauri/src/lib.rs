mod agent;
mod commands;
mod mcp_desktop;
mod mcp_memory;
mod memory;
mod tray;
mod voicevox;
mod window;

use tauri::Manager;

/// Modo servidor MCP de control de escritorio (`mizu-ia --mcp-desktop`): lo lanza Claude Code, no abre ventana.
pub fn run_mcp_desktop() {
    mcp_desktop::run();
}

/// Modo servidor MCP de memoria (`mizu-ia --mcp-memory <archivo>`): también lo lanza Claude Code.
pub fn run_mcp_memory(path: &std::path::Path) {
    mcp_memory::run(path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Una sola instancia: si se lanza otra (p. ej. al hacer doble clic con Mizu oculta), se muestra la que ya corre.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::set_visible(app, true)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            tray::setup(app.handle())?;
            tray::register_shortcut(app.handle())?;
            let config_path = app.path().app_config_dir()?.join("config.json");
            app.manage(commands::AgentState::load(config_path));
            app.manage(voicevox::VoiceEngine::default());

            let win = app
                .get_webview_window("main")
                .expect("ventana 'main' no encontrada");
            window::anchor_bottom_right(&win)?;
            // La ventana nace invisible (tauri.conf.json) para que no parpadee si Mizu empieza oculta.
            tray::set_visible(app.handle(), !tray::starts_hidden(app.handle()));
            window::spawn_cursor_tracker(win);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::set_click_through,
            tray::set_window_visible,
            commands::agent_get_config,
            commands::agent_set_config,
            commands::agent_set_persona,
            commands::agent_set_desktop,
            commands::agent_send,
            commands::agent_respond_permission,
            commands::agent_stop,
            commands::agent_new_conversation,
            commands::quit_app,
            commands::memory_list,
            commands::memory_delete,
            commands::memory_clear,
            voicevox::voice_engine_status,
            voicevox::voice_engine_start,
            voicevox::voice_engine_stop,
            voicevox::voice_warmup,
            voicevox::voice_query,
            voicevox::voice_synthesis,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Al salir (botón ✕, Alt+F4...) no debe quedar el CLI huérfano.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<commands::AgentState>() {
                    state.stop_session();
                }
                if let Some(engine) = app.try_state::<voicevox::VoiceEngine>() {
                    engine.stop();
                }
            }
        });
}
