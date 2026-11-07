//! Traduce los errores crudos del CLI a mensajes que se entienden y dicen qué hacer.
//!
//! Los textos reales de Claude Code son en inglés y técnicos ("Invalid API key · Please run /login",
//! "5-hour limit reached ∙ resets 3pm", "API Error: Connection error"...). Aquí se reconocen los casos
//! habituales; si no se reconoce ninguno, se devuelve el mensaje original sin tocar.

/// Devuelve un mensaje claro en español para los errores conocidos, o el original si no se reconoce.
pub fn explain(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));

    if has(&["please run /login", "invalid api key", "not logged in", "oauth token has expired", "authentication_error"]) {
        return "No tengo la sesión de Claude iniciada. Abre una terminal, escribe «claude» y usa /login con tu cuenta; después vuelve a pedírmelo.".into();
    }
    if has(&["usage limit", "limit reached", "rate limit", "rate_limit", "quota", "credit balance is too low", "overloaded"]) {
        // Claude suele indicar cuándo se renueva ("resets 3pm"): se conserva ese dato.
        let reset = lower.find("resets").and_then(|i| raw.get(i..)).map(|r| r.trim().trim_end_matches('.').to_string());
        return match reset {
            Some(r) => format!("Se agotó el límite de tu plan de Claude por ahora ({r}). Podré seguir cuando se renueve."),
            None => "Claude está limitado ahora mismo (cuota del plan o servicio saturado). Prueba de nuevo en unos minutos.".into(),
        };
    }
    if has(&["connection error", "econnrefused", "enotfound", "etimedout", "econnreset", "fetch failed", "network", "socket hang up", "unable to connect"]) {
        return "No consigo conectar con Claude. Revisa tu conexión a internet y vuelve a intentarlo.".into();
    }
    if has(&["no se encontró `claude`", "is not recognized", "no se pudo lanzar"]) {
        return "No encuentro Claude Code. Instálalo con «npm install -g @anthropic-ai/claude-code» y reinicia Mizu.".into();
    }
    raw.to_string()
}

#[cfg(test)]
mod tests {
    use super::explain;

    #[test]
    fn reconoce_login() {
        assert!(explain("Invalid API key · Please run /login").contains("sesión de Claude"));
    }

    #[test]
    fn reconoce_limite_y_conserva_la_hora() {
        let msg = explain("5-hour limit reached ∙ resets 3pm");
        assert!(msg.contains("resets 3pm"), "{msg}");
    }

    #[test]
    fn reconoce_red() {
        assert!(explain("API Error: Connection error").contains("conexión"));
    }

    #[test]
    fn deja_pasar_lo_desconocido() {
        assert_eq!(explain("algo raro"), "algo raro");
    }
}
