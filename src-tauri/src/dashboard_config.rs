//! Loads dashboard-widget configs, mirroring [`crate::commands_config`]: read-only
//! defaults embedded in the binary plus user-editable TOML files in the app config
//! dir, merged with the user file winning on a filename-stem collision.
//!
//! These are a separate config type from command-GUI configs: a widget is added
//! explicitly from a picker and polled on a timer, so there is no `match` field
//! (matched against typed input) — there's a fixed `command` instead. The parser
//! vocabulary (`columns`/`keyvalue`/`regex`) is shared with command configs; the
//! render set adds `gauge` for the monitoring widgets.
//!
//! Invalid TOML or a spec violation skips only that one file (logged to stderr),
//! never crashing the app or hiding the others — the same silent-skip behavior as
//! command configs. Parsing/rendering happens in the frontend; here we only parse,
//! validate the shape, and pass the strings through.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The user-editable widget folder (`<app_config_dir>/dashboard-widgets`).
fn widgets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "설정 폴더를 찾지 못했어요.".to_string())?;
    Ok(dir.join("dashboard-widgets"))
}

/// Embedded read-only defaults: (filename stem, TOML source). Add more here as
/// the bundled widget catalog grows.
const DEFAULT_WIDGETS: &[(&str, &str)] = &[
    (
        "cpu-usage",
        include_str!("../default_dashboard_widgets/cpu-usage.toml"),
    ),
    (
        "mem-usage",
        include_str!("../default_dashboard_widgets/mem-usage.toml"),
    ),
    (
        "disk-usage",
        include_str!("../default_dashboard_widgets/disk-usage.toml"),
    ),
    (
        "load-average",
        include_str!("../default_dashboard_widgets/load-average.toml"),
    ),
    (
        "network-io",
        include_str!("../default_dashboard_widgets/network-io.toml"),
    ),
    (
        "process-manager",
        include_str!("../default_dashboard_widgets/process-manager.toml"),
    ),
];

const PARSERS: &[&str] = &["columns", "keyvalue", "regex"];
const RENDERS: &[&str] = &["gauge", "table", "keyvalue-card", "list"];
const CATEGORIES: &[&str] = &["monitoring", "process-manager"];

/// Raw shape as written in a TOML file.
#[derive(Deserialize)]
struct RawWidget {
    id: String,
    label: String,
    command: String,
    parser: String,
    render: String,
    capture_pattern: Option<String>,
    highlight_column: Option<String>,
    /// For `gauge`: which parsed field holds the numeric percentage.
    value_field: Option<String>,
    /// For `gauge`: a unit suffix shown after the number (e.g. "%").
    unit: Option<String>,
    /// Emoji shown next to the widget in the picker (optional).
    icon: Option<String>,
    /// One-line description shown in the picker (optional).
    description: Option<String>,
    category: String,
    /// Suggested poll interval. Optional: when a widget omits it, the app's
    /// global default interval (a setting) is used when the widget is added.
    refresh_interval_seconds: Option<u64>,
}

/// A validated widget config sent to the frontend (camelCase JSON).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DashboardWidgetConfig {
    /// Filename stem — the override key and the settings-list label.
    name: String,
    /// "default" or "user".
    source: String,
    /// Stable widget id referenced by a persisted dashboard layout.
    id: String,
    label: String,
    command: String,
    parser: String,
    render: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    capture_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    highlight_column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_interval_seconds: Option<u64>,
}

/// Parse + validate one TOML widget. Errors carry a reason for the log.
fn parse_widget(name: &str, source: &str, text: &str) -> Result<DashboardWidgetConfig, String> {
    let raw: RawWidget = toml::from_str(text).map_err(|e| e.to_string())?;
    if raw.id.trim().is_empty() {
        return Err("widget id must not be empty".to_string());
    }
    if !PARSERS.contains(&raw.parser.as_str()) {
        return Err(format!("unknown parser '{}'", raw.parser));
    }
    if !RENDERS.contains(&raw.render.as_str()) {
        return Err(format!("unknown render '{}'", raw.render));
    }
    if !CATEGORIES.contains(&raw.category.as_str()) {
        return Err(format!("unknown category '{}'", raw.category));
    }
    if raw.parser == "regex" && raw.capture_pattern.is_none() {
        return Err("parser 'regex' requires capture_pattern".to_string());
    }
    Ok(DashboardWidgetConfig {
        name: name.to_string(),
        source: source.to_string(),
        id: raw.id,
        label: raw.label,
        command: raw.command,
        parser: raw.parser,
        render: raw.render,
        capture_pattern: raw.capture_pattern,
        highlight_column: raw.highlight_column,
        value_field: raw.value_field,
        unit: raw.unit,
        icon: raw.icon,
        description: raw.description,
        category: raw.category,
        refresh_interval_seconds: raw.refresh_interval_seconds,
    })
}

/// Load defaults then user widgets, user winning on filename-stem collisions.
#[tauri::command]
pub fn load_dashboard_widget_configs(app: AppHandle) -> Vec<DashboardWidgetConfig> {
    let mut map: BTreeMap<String, DashboardWidgetConfig> = BTreeMap::new();

    for (name, text) in DEFAULT_WIDGETS {
        match parse_widget(name, "default", text) {
            Ok(cfg) => {
                map.insert(name.to_string(), cfg);
            }
            Err(e) => eprintln!("[dashboard-widget] skipping default '{name}': {e}"),
        }
    }

    if let Ok(dir) = widgets_dir(&app) {
        // Create the folder so users have somewhere to drop their own widgets.
        let _ = fs::create_dir_all(&dir);
        if let Ok(entries) = fs::read_dir(&dir) {
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
                    Ok(text) => match parse_widget(&stem, "user", &text) {
                        Ok(cfg) => {
                            map.insert(stem, cfg);
                        }
                        Err(e) => {
                            eprintln!("[dashboard-widget] skipping user '{}': {e}", path.display())
                        }
                    },
                    Err(e) => {
                        eprintln!("[dashboard-widget] cannot read '{}': {e}", path.display())
                    }
                }
            }
        }
    }

    map.into_values().collect()
}

/// Absolute path of the user widget folder (created if missing), for display.
#[tauri::command]
pub fn dashboard_widgets_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = widgets_dir(&app)?;
    let _ = fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_cpu_usage_parses() {
        let text = include_str!("../default_dashboard_widgets/cpu-usage.toml");
        let cfg = parse_widget("cpu-usage", "default", text).expect("cpu-usage should parse");
        assert_eq!(cfg.parser, "regex");
        assert_eq!(cfg.render, "gauge");
        assert_eq!(cfg.category, "monitoring");
        assert_eq!(cfg.value_field.as_deref(), Some("usage"));
        assert!(cfg.capture_pattern.is_some());
    }

    #[test]
    fn refresh_interval_is_optional() {
        // A widget may omit refresh_interval_seconds (falls back to the app's
        // global default), or set its own (e.g. disk, which changes slowly).
        let disk = include_str!("../default_dashboard_widgets/disk-usage.toml");
        let cfg = parse_widget("disk-usage", "default", disk).expect("disk should parse");
        assert_eq!(cfg.refresh_interval_seconds, Some(30));

        let no_interval =
            "id='a'\nlabel='A'\ncommand='true'\nparser='columns'\nrender='table'\ncategory='monitoring'";
        let cfg = parse_widget("a", "user", no_interval).expect("omitting interval is allowed");
        assert_eq!(cfg.refresh_interval_seconds, None);
    }

    #[test]
    fn every_bundled_default_parses() {
        for (name, text) in DEFAULT_WIDGETS {
            parse_widget(name, "default", text)
                .unwrap_or_else(|e| panic!("bundled default '{name}' failed: {e}"));
        }
    }

    #[test]
    fn rejects_bad_shape() {
        // unknown render
        assert!(parse_widget(
            "x",
            "user",
            "id='a'\nlabel='A'\ncommand='true'\nparser='regex'\nrender='nope'\ncategory='monitoring'\nrefresh_interval_seconds=5\ncapture_pattern='(?<x>.)'"
        )
        .is_err());
        // regex without capture_pattern
        assert!(parse_widget(
            "x",
            "user",
            "id='a'\nlabel='A'\ncommand='true'\nparser='regex'\nrender='gauge'\ncategory='monitoring'\nrefresh_interval_seconds=5"
        )
        .is_err());
        // unknown category
        assert!(parse_widget(
            "x",
            "user",
            "id='a'\nlabel='A'\ncommand='true'\nparser='columns'\nrender='table'\ncategory='nope'\nrefresh_interval_seconds=5"
        )
        .is_err());
    }
}
