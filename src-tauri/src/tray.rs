//! Icono de la bandeja del sistema: mostrar/ocultar a Mizu, arrancar con el sistema y salir.
//!
//! Ocultar solo esconde la ventana (y con ella el modelo 3D): el proceso, el micrófono, la voz y
//! Claude Code siguen funcionando, así que Mizu puede trabajar sin estar a la vista.

use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt;

const TOGGLE_ID: &str = "toggle";
const AUTOSTART_ID: &str = "autostart";
const HIDDEN_ID: &str = "start_hidden";
const QUIT_ID: &str = "quit";

/// Atajo global para mostrar/ocultar a Mizu desde cualquier aplicación.
const SHORTCUT_LABEL: &str = "Ctrl+Alt+M";

/// Entrada del menú que cambia de texto según la ventana esté visible u oculta.
struct ToggleItem(MenuItem<Wry>);

/// Preferencias de la bandeja (se guardan junto a la configuración del agente).
#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct Prefs {
    /// Al arrancar, Mizu empieza oculta en la bandeja (trabaja sin que se vea el modelo).
    start_hidden: bool,
}

fn prefs_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("tray.json"))
}

fn load_prefs(app: &AppHandle) -> Prefs {
    prefs_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle, prefs: &Prefs) {
    let Some(path) = prefs_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(prefs) {
        let _ = std::fs::write(path, json);
    }
}

/// ¿Debe empezar oculta? Lo decide `lib.rs` al arrancar (la ventana nace invisible para que no parpadee).
pub fn starts_hidden(app: &AppHandle) -> bool {
    load_prefs(app).start_hidden
}

/// Registra el atajo global (`Ctrl+Alt+M`). Si otra aplicación ya lo usa, solo se avisa por consola.
pub fn register_shortcut(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM);
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, sc, event| {
                if sc == &shortcut && event.state() == ShortcutState::Pressed {
                    toggle(app);
                }
            })
            .build(),
    )?;
    if let Err(e) = app.global_shortcut().register(shortcut) {
        eprintln!("[tray] no se pudo registrar {SHORTCUT_LABEL} (¿lo usa otra aplicación?): {e}");
    }
    Ok(())
}

/// Muestra u oculta la ventana de Mizu y sincroniza el menú de la bandeja y el frontend.
pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(win) = app.get_webview_window("main") else { return };
    let _ = if visible { win.show() } else { win.hide() };
    if let Some(item) = app.try_state::<ToggleItem>() {
        let _ = item.0.set_text(toggle_label(visible));
    }
    let _ = app.emit("mizu-visibility", visible);
}

fn toggle_label(visible: bool) -> String {
    format!("{} a Mizu ({SHORTCUT_LABEL})", if visible { "Ocultar" } else { "Mostrar" })
}

fn toggle(app: &AppHandle) {
    let visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true);
    set_visible(app, !visible);
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let starts_hidden = load_prefs(app).start_hidden;
    let toggle_item = MenuItem::with_id(app, TOGGLE_ID, toggle_label(!starts_hidden), true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart_item = CheckMenuItem::with_id(app, AUTOSTART_ID, "Iniciar con Windows", true, autostart_on, None::<&str>)?;
    let hidden_item = CheckMenuItem::with_id(app, HIDDEN_ID, "Empezar oculta", true, starts_hidden, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, QUIT_ID, "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle_item, &autostart_item, &hidden_item, &PredefinedMenuItem::separator(app)?, &quit_item],
    )?;
    app.manage(ToggleItem(toggle_item));

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Mizu-IA")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            TOGGLE_ID => toggle(app),
            AUTOSTART_ID => {
                let launch = app.autolaunch();
                let result = if launch.is_enabled().unwrap_or(false) { launch.disable() } else { launch.enable() };
                if let Err(e) = result {
                    eprintln!("[tray] no se pudo cambiar el autoarranque: {e}");
                }
                // El check refleja el estado real, no lo que se pidió.
                let _ = autostart_item.set_checked(launch.is_enabled().unwrap_or(false));
            }
            HIDDEN_ID => {
                let mut prefs = load_prefs(app);
                prefs.start_hidden = !prefs.start_hidden;
                save_prefs(app, &prefs);
                let _ = hidden_item.set_checked(prefs.start_hidden);
            }
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// El frontend pide mostrar u ocultar a Mizu (p. ej. al necesitar un permiso estando oculta).
#[tauri::command]
pub fn set_window_visible(app: AppHandle, visible: bool) {
    set_visible(&app, visible);
}
