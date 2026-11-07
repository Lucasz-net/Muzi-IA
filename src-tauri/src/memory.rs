//! Memoria de Mizu entre conversaciones: notas cortas sobre la persona (gustos, proyectos, cómo prefiere que le hablen).
//!
//! Se guardan en `memories.json` (carpeta de configuración de la app). Mizu las escribe con las herramientas
//! `remember` y `forget` de su servidor MCP (`mcp_memory.rs`, un proceso aparte), y la app las lee al lanzar el CLI
//! para incluirlas en el prompt y las lista en Ajustes, desde donde se pueden borrar.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// Máximo de caracteres de una nota y de notas guardadas: el prompt no debe crecer sin límite.
pub const MAX_NOTE_CHARS: usize = 240;
pub const MAX_NOTES: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub text: String,
    /// Segundos desde la época.
    pub created: u64,
}

/// Palabras que delatan datos que nunca deben guardarse (credenciales, datos de pago).
const SENSITIVE: &[&str] = &[
    "contraseña", "contrasena", "password", "passwd", "token", "api key", "api_key", "apikey", "secret", "clave privada",
    "tarjeta de crédito", "tarjeta de credito", "cvv", "iban", "pin del banco",
];

pub fn path_in(dir: &Path) -> PathBuf {
    dir.join("memories.json")
}

pub fn load(path: &Path) -> Vec<Note> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(path: &Path, notes: &[Note]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Guarda una nota. Devuelve un texto para el modelo con lo ocurrido (ya guardada, rechazada, etc.).
pub fn add(path: &Path, text: &str) -> Result<String, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("La nota está vacía.".into());
    }
    if text.chars().count() > MAX_NOTE_CHARS {
        return Err(format!("La nota es demasiado larga (máximo {MAX_NOTE_CHARS} caracteres). Resúmela."));
    }
    let lower = text.to_lowercase();
    if SENSITIVE.iter().any(|w| lower.contains(w)) {
        return Err("No guardo contraseñas, claves ni datos de pago. Dile a la persona que eso no lo recuerdas por seguridad.".into());
    }
    let mut notes = load(path);
    if notes.iter().any(|n| norm(&n.text) == norm(&text)) {
        return Ok("Ya lo tenía guardado.".into());
    }
    if notes.len() >= MAX_NOTES {
        return Err("La memoria está llena. Usa «forget» para olvidar algo antes de guardar más.".into());
    }
    let id = format!("{}-{}", now(), notes.len());
    notes.push(Note { id, text, created: now() });
    save(path, &notes)?;
    Ok("Guardado. Lo recordaré en futuras conversaciones.".into())
}

/// Olvida las notas que contengan `needle`. Devuelve cuántas se borraron.
pub fn forget_matching(path: &Path, needle: &str) -> Result<usize, String> {
    let needle = norm(needle);
    if needle.is_empty() {
        return Err("Indica qué olvidar.".into());
    }
    let notes = load(path);
    let kept: Vec<Note> = notes.iter().filter(|n| !norm(&n.text).contains(&needle)).cloned().collect();
    let removed = notes.len() - kept.len();
    if removed > 0 {
        save(path, &kept)?;
    }
    Ok(removed)
}

pub fn remove(path: &Path, id: &str) -> Result<(), String> {
    let mut notes = load(path);
    notes.retain(|n| n.id != id);
    save(path, &notes)
}

pub fn clear(path: &Path) -> Result<(), String> {
    save(path, &[])
}

/// Texto que se añade al prompt del sistema: cómo usar la memoria y lo que ya se sabe.
pub fn prompt_block(path: &Path) -> String {
    let notes = load(path);
    let mut out = String::from(
        "\n\nMEMORIA:\n- Tienes las herramientas «remember» y «forget» (servidor «mizu-memory») para acordarte de cosas de la persona entre conversaciones.\n- Usa «remember» cuando te pida que recuerdes algo o cuente algo duradero sobre sí (nombre, gustos, proyectos, cómo prefiere que le hables). Guarda notas cortas, en una frase. Nunca guardes contraseñas, claves ni datos de pago.\n- Usa «forget» si te pide que olvides algo. No anuncies que guardas cosas salvo que te lo pidan: di solo «vale, me acuerdo».\n- Lo de abajo es lo que ya sabes; tómalo como contexto, sin recitarlo.\n",
    );
    if notes.is_empty() {
        out.push_str("\n(Aún no sabes nada guardado de la persona.)\n");
    } else {
        out.push_str("\nLO QUE SABES DE LA PERSONA:\n");
        for n in &notes {
            out.push_str(&format!("- {}\n", n.text));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("mizu-mem-test-{name}-{}", std::process::id()));
        let _ = fs::remove_file(&p);
        p
    }

    #[test]
    fn guarda_deduplica_y_olvida() {
        let p = temp("basico");
        assert!(add(&p, "Le gusta el café").is_ok());
        assert_eq!(add(&p, "  le gusta   el CAFÉ ").unwrap(), "Ya lo tenía guardado.");
        assert_eq!(load(&p).len(), 1);
        assert_eq!(forget_matching(&p, "café").unwrap(), 1);
        assert!(load(&p).is_empty());
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn rechaza_datos_sensibles_y_notas_largas() {
        let p = temp("sensible");
        assert!(add(&p, "Mi contraseña es 1234").is_err());
        assert!(add(&p, &"a".repeat(MAX_NOTE_CHARS + 1)).is_err());
        assert!(load(&p).is_empty());
    }

    #[test]
    fn el_prompt_lista_las_notas() {
        let p = temp("prompt");
        add(&p, "Se llama Lucas").unwrap();
        assert!(prompt_block(&p).contains("- Se llama Lucas"));
        let _ = fs::remove_file(&p);
    }
}
