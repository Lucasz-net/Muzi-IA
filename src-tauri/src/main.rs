// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code lanza este mismo ejecutable como servidor MCP de control de escritorio (ver `mcp_desktop.rs`).
    if std::env::args().any(|a| a == "--mcp-desktop") {
        mizu_ia_lib::run_mcp_desktop();
        return;
    }
    mizu_ia_lib::run()
}
