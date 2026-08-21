//! Local persistence for user settings.
//!
//! Settings are stored as a single JSON object in the OS app-config directory
//! (`<config>/com.sshland.app/settings.json`). The backend is intentionally
//! schema-agnostic — it reads and writes an opaque JSON blob so the frontend
//! can add new setting keys without any Rust change.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error;

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| error::code("errors.settingsFolder"))?;
    Ok(dir.join("settings.json"))
}

/// Read the saved settings object. Returns an empty object if nothing is saved
/// yet (first run), so the frontend can just merge it over its defaults.
#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = settings_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| error::code("errors.settingsRead")),
        // No file yet (or unreadable) — start from an empty object.
        Err(_) => Ok(Value::Object(serde_json::Map::new())),
    }
}

/// Persist the whole settings object, creating the config directory if needed.
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| error::code("errors.settingsFolderCreate"))?;
    }
    let text =
        serde_json::to_string_pretty(&settings).map_err(|_| error::code("errors.settingsSave"))?;
    fs::write(&path, text).map_err(|_| error::code("errors.settingsSave"))?;
    Ok(())
}
