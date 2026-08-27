//! Local storage for user-authored macros.
//!
//! A macro is an ordered list of shell steps the user deliberately writes to run
//! on their own connected server (the same trust level as typing into a terminal
//! pane — see the note in the "Macros" section of CLAUDE.md). Each macro is one
//! JSON file in `<app_config_dir>/macros/`, so a macro is trivially portable
//! (copy one file) rather than a blob inside settings.json. Unlike the Command
//! GUI configs there are no bundled defaults — this folder is entirely
//! user-authored, read/write.
//!
//! A single unreadable/invalid file is skipped (never crashes the list), the
//! same silent-skip behavior as the other config loaders.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error;

/// One step of a macro: a short label plus the shell command to run.
#[derive(Serialize, Deserialize, Clone)]
pub struct MacroStep {
    pub id: String,
    pub label: String,
    pub command: String,
}

/// A user-authored macro: a named, ordered list of steps.
#[derive(Serialize, Deserialize, Clone)]
pub struct Macro {
    pub id: String,
    pub name: String,
    pub steps: Vec<MacroStep>,
}

/// The user macro folder (`<app_config_dir>/macros`).
fn macros_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| error::macro_folder_failed())?;
    Ok(dir.join("macros"))
}

/// A macro id is used as a filename, so it must be a safe slug (no path
/// separators or `..`). Frontend ids are UUIDs, so this only rejects tampering.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Load every saved macro. A file that can't be read or parsed is skipped.
#[tauri::command]
pub fn list_macros(app: AppHandle) -> Vec<Macro> {
    let mut out = Vec::new();
    let dir = match macros_dir(&app) {
        Ok(d) => d,
        Err(_) => return out,
    };
    // Create the folder so users have somewhere to drop macro files.
    let _ = fs::create_dir_all(&dir);
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(text) => match serde_json::from_str::<Macro>(&text) {
                    Ok(m) => out.push(m),
                    Err(e) => eprintln!("[macros] skipping '{}': {e}", path.display()),
                },
                Err(e) => eprintln!("[macros] cannot read '{}': {e}", path.display()),
            }
        }
    }
    // Stable order by name so the picker list doesn't jump around.
    out.sort_by_key(|item| item.name.to_lowercase());
    out
}

/// Save (create or overwrite) one macro as `<id>.json`.
#[tauri::command]
pub fn save_macro(app: AppHandle, mac: Macro) -> Result<(), String> {
    if !valid_id(&mac.id) {
        return Err(error::macro_save_failed());
    }
    let dir = macros_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| error::macro_folder_failed())?;
    let text = serde_json::to_string_pretty(&mac).map_err(|_| error::macro_save_failed())?;
    fs::write(dir.join(format!("{}.json", mac.id)), text)
        .map_err(|_| error::macro_save_failed())?;
    Ok(())
}

/// Delete one macro file by id. A missing file is treated as already deleted.
#[tauri::command]
pub fn delete_macro(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(error::macro_delete_failed());
    }
    let path = macros_dir(&app)?.join(format!("{id}.json"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(error::macro_delete_failed()),
    }
}

/// Absolute path of the user macro folder (created if missing), for display.
#[tauri::command]
pub fn macros_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = macros_dir(&app)?;
    let _ = fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_validation_blocks_traversal() {
        assert!(valid_id("abc-123_DEF"));
        assert!(!valid_id(""));
        assert!(!valid_id("../evil"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a.b"));
    }

    #[test]
    fn macro_round_trips_through_json() {
        let m = Macro {
            id: "m1".into(),
            name: "backup".into(),
            steps: vec![MacroStep {
                id: "s1".into(),
                label: "go home".into(),
                command: "cd ~".into(),
            }],
        };
        let text = serde_json::to_string(&m).unwrap();
        let back: Macro = serde_json::from_str(&text).unwrap();
        assert_eq!(back.name, "backup");
        assert_eq!(back.steps.len(), 1);
        assert_eq!(back.steps[0].command, "cd ~");
    }
}
