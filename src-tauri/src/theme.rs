//! Imports a user-selected theme background into the app-owned config folder.
//!
//! The webview asset protocol is scoped to this fixed filename family, so the
//! UI never receives broad read access to an arbitrary user-selected folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error;

pub(crate) const MAX_BACKGROUND_BYTES: u64 = 30 * 1024 * 1024;
pub(crate) const ALLOWED_EXTENSIONS: &[&str] =
    &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
const FILE_STEM: &str = "theme-background";

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|_| error::code("errors.themeBackgroundFolder"))
}

pub(crate) fn allowed_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| ALLOWED_EXTENSIONS.contains(&value.as_str()))
}

/// Validate a prospective background before it is copied into app-owned
/// storage. Theme preset import/export reuses the exact same boundary.
pub(crate) fn validate_background_source(source: &Path) -> Result<String, String> {
    let metadata = fs::metadata(source).map_err(|_| error::code("errors.themeBackgroundRead"))?;
    if !metadata.is_file() || metadata.len() > MAX_BACKGROUND_BYTES {
        return Err(error::code("errors.themeBackgroundSize"));
    }
    allowed_extension(source).ok_or_else(|| error::code("errors.themeBackgroundFormat"))
}

fn remove_known_backgrounds(dir: &Path) -> Result<(), String> {
    for extension in ALLOWED_EXTENSIONS {
        let path = dir.join(format!("{FILE_STEM}.{extension}"));
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(error::code("errors.themeBackgroundRemove")),
        }
    }
    Ok(())
}

/// Copy a validated image into the app config directory and return its path.
#[tauri::command]
pub fn import_theme_background(app: AppHandle, source_path: String) -> Result<String, String> {
    let source = Path::new(&source_path);
    let extension = validate_background_source(source)?;

    let dir = config_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| error::code("errors.themeBackgroundFolder"))?;
    let temporary = dir.join(format!("{FILE_STEM}.importing"));
    let target = dir.join(format!("{FILE_STEM}.{extension}"));
    let _ = fs::remove_file(&temporary);

    fs::copy(source, &temporary).map_err(|_| error::code("errors.themeBackgroundCopy"))?;
    if let Err(message) = remove_known_backgrounds(&dir) {
        let _ = fs::remove_file(&temporary);
        return Err(message);
    }
    fs::rename(&temporary, &target).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        error::code("errors.themeBackgroundCopy")
    })?;

    Ok(target.to_string_lossy().into_owned())
}

/// Remove the app-owned background copy. Missing files are already clear.
#[tauri::command]
pub fn clear_theme_background(app: AppHandle) -> Result<(), String> {
    let dir = config_dir(&app)?;
    remove_known_backgrounds(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_image_extensions_case_insensitively() {
        assert_eq!(
            allowed_extension(Path::new("wallpaper.PNG")).as_deref(),
            Some("png")
        );
        assert_eq!(
            allowed_extension(Path::new("wallpaper.avif")).as_deref(),
            Some("avif")
        );
    }

    #[test]
    fn rejects_non_image_and_missing_extensions() {
        assert!(allowed_extension(Path::new("wallpaper.svg")).is_none());
        assert!(allowed_extension(Path::new("wallpaper")).is_none());
    }
}
