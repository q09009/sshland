//! Loads command-GUI configs from two places and merges them: read-only
//! defaults embedded in the binary, and user-editable TOML files in the app
//! config dir. A user file overrides a default with the same filename stem.
//!
//! Invalid TOML or spec violations skip only that file (logged to stderr) so a
//! bad config never crashes the app or hides the others. Matching/rendering is
//! done in the frontend; here we only parse, validate the shape, and pass the
//! strings through.

use std::collections::BTreeMap;
use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Embedded read-only defaults: (filename stem, TOML source). Add more here as
/// the bundled command set grows.
const DEFAULT_COMMANDS: &[(&str, &str)] = &[
    ("ps-aux", include_str!("../default_commands/ps-aux.toml")),
    (
        "systemctl-status",
        include_str!("../default_commands/systemctl-status.toml"),
    ),
];

const PARSERS: &[&str] = &["columns", "keyvalue", "regex"];
const RENDERS: &[&str] = &["table", "keyvalue-card", "list"];

/// Raw shape as written in a TOML file.
#[derive(Deserialize)]
struct RawConfig {
    #[serde(rename = "match")]
    match_pattern: String,
    parser: String,
    render: String,
    capture_pattern: Option<String>,
    highlight_column: Option<String>,
}

/// A validated config sent to the frontend (camelCase JSON).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandConfig {
    /// Filename stem — used both for override precedence and the settings list.
    name: String,
    /// "default" or "user".
    source: String,
    #[serde(rename = "match")]
    match_pattern: String,
    parser: String,
    render: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    capture_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    highlight_column: Option<String>,
}

/// Parse + validate one TOML config. Errors carry a reason for the log.
fn parse_config(name: &str, source: &str, text: &str) -> Result<CommandConfig, String> {
    let raw: RawConfig = toml::from_str(text).map_err(|e| e.to_string())?;
    if !PARSERS.contains(&raw.parser.as_str()) {
        return Err(format!("unknown parser '{}'", raw.parser));
    }
    if !RENDERS.contains(&raw.render.as_str()) {
        return Err(format!("unknown render '{}'", raw.render));
    }
    if raw.parser == "regex" && raw.capture_pattern.is_none() {
        return Err("parser 'regex' requires capture_pattern".to_string());
    }
    Ok(CommandConfig {
        name: name.to_string(),
        source: source.to_string(),
        match_pattern: raw.match_pattern,
        parser: raw.parser,
        render: raw.render,
        capture_pattern: raw.capture_pattern,
        highlight_column: raw.highlight_column,
    })
}

/// Load defaults then user configs, user winning on filename-stem collisions.
#[tauri::command]
pub fn load_command_configs(app: AppHandle) -> Vec<CommandConfig> {
    let mut map: BTreeMap<String, CommandConfig> = BTreeMap::new();

    for (name, text) in DEFAULT_COMMANDS {
        match parse_config(name, "default", text) {
            Ok(cfg) => {
                map.insert(name.to_string(), cfg);
            }
            Err(e) => eprintln!("[command-config] skipping default '{name}': {e}"),
        }
    }

    if let Ok(dir) = app.path().app_config_dir() {
        let cmd_dir = dir.join("commands");
        // Create the folder so users have somewhere to drop their own configs.
        let _ = fs::create_dir_all(&cmd_dir);
        if let Ok(entries) = fs::read_dir(&cmd_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("toml") {
                    continue;
                }
                let stem = match path.file_stem().and_then(|s| s.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                match fs::read_to_string(&path) {
                    Ok(text) => match parse_config(&stem, "user", &text) {
                        Ok(cfg) => {
                            map.insert(stem, cfg);
                        }
                        Err(e) => {
                            eprintln!("[command-config] skipping user '{}': {e}", path.display())
                        }
                    },
                    Err(e) => {
                        eprintln!("[command-config] cannot read '{}': {e}", path.display())
                    }
                }
            }
        }
    }

    map.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_ps_aux_parses() {
        let text = include_str!("../default_commands/ps-aux.toml");
        let cfg = parse_config("ps-aux", "default", text).expect("ps-aux should parse");
        assert_eq!(cfg.parser, "columns");
        assert_eq!(cfg.render, "table");
        assert_eq!(cfg.highlight_column.as_deref(), Some("%CPU"));
        assert!(!cfg.match_pattern.is_empty());
    }

    #[test]
    fn bundled_systemctl_status_parses() {
        let text = include_str!("../default_commands/systemctl-status.toml");
        let cfg = parse_config("systemctl-status", "default", text).expect("should parse");
        assert_eq!(cfg.parser, "keyvalue");
        assert_eq!(cfg.render, "keyvalue-card");
    }

    #[test]
    fn rejects_unknown_parser_and_missing_capture() {
        assert!(parse_config("x", "user", "match='a'\nparser='nope'\nrender='list'").is_err());
        assert!(
            parse_config("x", "user", "match='a'\nparser='regex'\nrender='list'").is_err(),
            "regex parser without capture_pattern must fail"
        );
    }
}
