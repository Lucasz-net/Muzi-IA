// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code lanza este mismo ejecutable como servidor MCP de control de escritorio (ver `mcp_desktop.rs`).
    if std::env::args().any(|a| a == "--mcp-desktop") {
        mizu_ia_lib::run_mcp_desktop();
        return;
    }
    // ...y con `--mcp-memory <archivo>` como servidor MCP de memoria.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--mcp-memory") {
        if let Some(path) = args.get(i + 1) {
            mizu_ia_lib::run_mcp_memory(std::path::Path::new(path));
            return;
        }
    }
    mizu_ia_lib::run()
}
