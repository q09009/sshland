//! Shareable, declarative theme presets.
//!
//! App settings remain private in `settings.json`; only visual theme values are
//! represented here. User presets live as TOML files in
//! `<app_config_dir>/themes/`. An optional background image is referenced by a
//! filename next to the TOML file, never by an absolute or parent path.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{error, theme};

const SCHEMA_VERSION: u32 = 1;
const MAX_PRESET_BYTES: u64 = 256 * 1024;
const MOTION_VALUES: &[&str] = &["normal", "reduced", "none"];
const UI_FONT_VALUES: &[&str] = &["default", "system", "segoe"];
const TERMINAL_FONT_VALUES: &[&str] = &["default", "cascadia", "d2coding", "consolas", "system"];

const COLOR_TOKENS: &[&str] = &[
    "color-ink-900",
    "color-ink-800",
    "color-ink-700",
    "color-ink-600",
    "color-slate-100",
    "color-slate-200",
    "color-slate-300",
    "color-slate-400",
    "color-slate-500",
    "color-slate-600",
    "color-sky-200",
    "color-sky-300",
    "color-sky-400",
    "color-sky-500",
    "color-sky-600",
    "color-sky-950",
    "color-emerald-300",
    "color-emerald-400",
    "color-emerald-500",
    "color-amber-400",
    "color-amber-500",
    "color-red-200",
    "color-red-300",
    "color-red-400",
    "color-red-500",
    "color-red-600",
    "color-red-950",
    "color-overlay",
    "color-on-accent",
    "color-control-knob",
    "color-symlink",
    "color-surface-pane",
    "color-surface-card",
    "color-surface-popover",
    "color-surface-dialog",
    "color-border-default",
    "color-text-primary",
    "color-text-secondary",
    "color-text-muted",
];
const FONT_TOKENS: &[&str] = &["font-sans", "font-mono", "font-terminal"];
const LENGTH_TOKENS: &[&str] = &[
    "text-editor",
    "text-terminal",
    "text-2xs",
    "text-xs",
    "text-sm",
    "text-base",
    "text-lg",
    "text-xl",
    "text-2xl",
    "text-3xl",
    "leading-xs",
    "leading-sm",
    "leading-base",
    "leading-lg",
    "leading-xl",
    "leading-2xl",
    "leading-3xl",
    "distance-spatial",
    "radius-sm",
    "radius",
    "radius-md",
    "radius-lg",
    "radius-xl",
    "radius-2xl",
    "radius-full",
    "radius-editor-tooltip",
    "blur-surface-pane",
    "space-pane-gap",
    "space-pane-half-gap",
    "space-pane-edge",
    "radius-pane",
    "space-dashboard-inset",
    "space-dashboard-gap",
    "radius-dashboard-card",
];
const NUMBER_TOKENS: &[&str] = &["leading-editor", "scale-spatial-enter"];
const DURATION_TOKENS: &[&str] = &[
    "duration-instant",
    "duration-fast",
    "duration-normal",
    "duration-slow",
];
const EASING_TOKENS: &[&str] = &["ease-standard", "ease-spatial"];
const OPACITY_TOKENS: &[&str] = &[
    "opacity-surface-pane",
    "opacity-pane-divider-hover",
    "opacity-pane-divider-active",
];
const SHADOW_TOKENS: &[&str] = &[
    "shadow-control",
    "shadow-popover",
    "shadow-dialog",
    "shadow-pane-rest",
    "shadow-pane-focus",
    "shadow-dashboard-card",
];

#[derive(Clone, Copy)]
enum TokenKind {
    Color,
    Font,
    Length,
    Number,
    Duration,
    Easing,
    Opacity,
    Shadow,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ThemeFile {
    schema_version: u32,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    theme: ThemeFileValues,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    tokens: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ThemeFileValues {
    background_color: String,
    accent_color: String,
    background_overlay: u8,
    motion: String,
    ui_font: String,
    terminal_font: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    background_image: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeExportValues {
    background_color: String,
    background_image_path: Option<String>,
    background_overlay: u8,
    accent_color: String,
    motion: String,
    ui_font: String,
    terminal_font: String,
    #[serde(default)]
    tokens: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreset {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    background_color: String,
    accent_color: String,
    background_overlay: u8,
    motion: String,
    ui_font: String,
    terminal_font: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    background_image_path: Option<String>,
    tokens: BTreeMap<String, String>,
}

fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("themes"))
        .map_err(|_| error::code("errors.themePresetFolder"))
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn token_kind(name: &str) -> Option<TokenKind> {
    if COLOR_TOKENS.contains(&name) {
        Some(TokenKind::Color)
    } else if FONT_TOKENS.contains(&name) {
        Some(TokenKind::Font)
    } else if LENGTH_TOKENS.contains(&name) {
        Some(TokenKind::Length)
    } else if NUMBER_TOKENS.contains(&name) {
        Some(TokenKind::Number)
    } else if DURATION_TOKENS.contains(&name) {
        Some(TokenKind::Duration)
    } else if EASING_TOKENS.contains(&name) {
        Some(TokenKind::Easing)
    } else if OPACITY_TOKENS.contains(&name) {
        Some(TokenKind::Opacity)
    } else if SHADOW_TOKENS.contains(&name) {
        Some(TokenKind::Shadow)
    } else {
        None
    }
}

fn number_with_suffix(value: &str, suffixes: &[&str]) -> Option<f64> {
    suffixes.iter().find_map(|suffix| {
        value
            .strip_suffix(suffix)
            .and_then(|number| number.parse::<f64>().ok())
            .filter(|number| number.is_finite())
    })
}

fn safe_css_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    !value.is_empty()
        && value.len() <= 320
        && !value.chars().any(char::is_control)
        && !value.contains([';', '{', '}', '<', '>'])
        && !lower.contains("url(")
        && !lower.contains("@import")
        && !lower.contains("expression(")
}

fn valid_easing(value: &str) -> bool {
    if ["linear", "ease", "ease-in", "ease-out", "ease-in-out"].contains(&value) {
        return true;
    }
    let Some(points) = value
        .strip_prefix("cubic-bezier(")
        .and_then(|value| value.strip_suffix(')'))
    else {
        return false;
    };
    let parsed = points
        .split(',')
        .map(|point| point.trim().parse::<f64>())
        .collect::<Result<Vec<_>, _>>();
    let Ok(points) = parsed else {
        return false;
    };
    points.len() == 4
        && points
            .iter()
            .all(|point| point.is_finite() && point.abs() <= 10.0)
        && (0.0..=1.0).contains(&points[0])
        && (0.0..=1.0).contains(&points[2])
}

fn valid_token_value(kind: TokenKind, value: &str) -> bool {
    let value = value.trim();
    match kind {
        TokenKind::Color => is_hex_color(value),
        TokenKind::Font | TokenKind::Shadow => safe_css_value(value),
        TokenKind::Length => number_with_suffix(value, &["rem", "px", "em", "%"])
            .is_some_and(|number| (0.0..=10_000.0).contains(&number)),
        TokenKind::Number => value
            .parse::<f64>()
            .is_ok_and(|number| number.is_finite() && (0.0..=10.0).contains(&number)),
        TokenKind::Duration => {
            let milliseconds = value
                .strip_suffix("ms")
                .and_then(|number| number.parse::<f64>().ok())
                .or_else(|| {
                    value
                        .strip_suffix('s')
                        .and_then(|number| number.parse::<f64>().ok())
                        .map(|seconds| seconds * 1_000.0)
                });
            milliseconds
                .is_some_and(|number| number.is_finite() && (0.0..=60_000.0).contains(&number))
        }
        TokenKind::Easing => valid_easing(value),
        TokenKind::Opacity => value
            .parse::<f64>()
            .is_ok_and(|number| number.is_finite() && (0.0..=1.0).contains(&number)),
    }
}

fn validate_tokens(tokens: &BTreeMap<String, String>) -> Result<(), String> {
    if tokens.len() > 128 {
        return Err("too many design tokens".to_string());
    }
    for (name, value) in tokens {
        let Some(kind) = token_kind(name) else {
            return Err(format!("unknown design token {name}"));
        };
        if !valid_token_value(kind, value) {
            return Err(format!("invalid value for design token {name}"));
        }
    }
    Ok(())
}

fn normalized_tokens(tokens: BTreeMap<String, String>) -> BTreeMap<String, String> {
    tokens
        .into_iter()
        .map(|(name, value)| {
            let value = if matches!(token_kind(&name), Some(TokenKind::Color)) {
                value.trim().to_ascii_lowercase()
            } else {
                value.trim().to_string()
            };
            (name, value)
        })
        .collect()
}

fn valid_optional_text(value: &Option<String>, max_chars: usize) -> bool {
    value
        .as_ref()
        .is_none_or(|text| !text.trim().is_empty() && text.chars().count() <= max_chars)
}

fn relative_background(base: &Path, value: &str) -> Result<PathBuf, String> {
    let relative = Path::new(value);
    let mut components = relative.components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err("background_image must be one filename next to the preset".to_string());
    }
    let path = base.join(relative);
    theme::validate_background_source(&path).map_err(|_| "invalid background image".to_string())?;
    Ok(path)
}

fn validate_file(file: &ThemeFile, base: &Path) -> Result<Option<PathBuf>, String> {
    if file.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported schema_version {}",
            file.schema_version
        ));
    }
    if file.name.trim().is_empty() || file.name.chars().count() > 80 {
        return Err("name must contain 1-80 characters".to_string());
    }
    if !valid_optional_text(&file.author, 80) || !valid_optional_text(&file.description, 240) {
        return Err("author or description is too long".to_string());
    }
    if !is_hex_color(&file.theme.background_color) || !is_hex_color(&file.theme.accent_color) {
        return Err("colors must use #rrggbb".to_string());
    }
    if file.theme.background_overlay > 90 {
        return Err("background_overlay must be between 0 and 90".to_string());
    }
    if !MOTION_VALUES.contains(&file.theme.motion.as_str()) {
        return Err("unknown motion value".to_string());
    }
    if !UI_FONT_VALUES.contains(&file.theme.ui_font.as_str()) {
        return Err("unknown ui_font value".to_string());
    }
    if !TERMINAL_FONT_VALUES.contains(&file.theme.terminal_font.as_str()) {
        return Err("unknown terminal_font value".to_string());
    }
    validate_tokens(&file.tokens)?;
    file.theme
        .background_image
        .as_deref()
        .map(|value| relative_background(base, value))
        .transpose()
}

fn read_theme_file(path: &Path) -> Result<(ThemeFile, Option<PathBuf>), String> {
    let metadata = fs::metadata(path).map_err(|_| "cannot read preset".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_PRESET_BYTES {
        return Err("preset must be a TOML file no larger than 256 KiB".to_string());
    }
    let text = fs::read_to_string(path).map_err(|_| "cannot read preset".to_string())?;
    let file: ThemeFile = toml::from_str(&text).map_err(|err| err.to_string())?;
    let base = path.parent().unwrap_or_else(|| Path::new("."));
    let background = validate_file(&file, base)?;
    Ok((file, background))
}

fn to_preset(id: String, file: ThemeFile, background: Option<PathBuf>) -> ThemePreset {
    let tokens = normalized_tokens(file.tokens);
    ThemePreset {
        id,
        name: file.name.trim().to_string(),
        author: file.author.map(|value| value.trim().to_string()),
        description: file.description.map(|value| value.trim().to_string()),
        background_color: file.theme.background_color.to_ascii_lowercase(),
        accent_color: file.theme.accent_color.to_ascii_lowercase(),
        background_overlay: file.theme.background_overlay,
        motion: file.theme.motion,
        ui_font: file.theme.ui_font,
        terminal_font: file.theme.terminal_font,
        background_image_path: background.map(|path| path.to_string_lossy().into_owned()),
        tokens,
    }
}

fn file_stem(path: &Path) -> Result<String, String> {
    path.file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| error::code("errors.themePresetInvalid"))
}

fn has_toml_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("toml"))
}

fn safe_stem(value: &str) -> String {
    let mut result = String::new();
    let mut previous_dash = false;
    for ch in value.chars().take(64) {
        let mapped = if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if previous_dash {
                continue;
            }
            previous_dash = true;
        } else {
            previous_dash = false;
        }
        result.push(mapped);
    }
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "theme".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_stem(dir: &Path, requested: &str) -> String {
    let base = safe_stem(requested);
    if !dir.join(format!("{base}.toml")).exists() {
        return base;
    }
    for index in 2..10_000 {
        let candidate = format!("{base}-{index}");
        if !dir.join(format!("{candidate}.toml")).exists() {
            return candidate;
        }
    }
    format!("{base}-imported")
}

fn humanize_stem(stem: &str) -> String {
    let value = stem.replace(['-', '_'], " ");
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() {
        "sshland theme".to_string()
    } else {
        value
    }
}

fn write_theme_file(path: &Path, file: &ThemeFile) -> Result<(), String> {
    let text = toml::to_string_pretty(file).map_err(|_| error::code("errors.themePresetWrite"))?;
    fs::write(path, text).map_err(|_| error::code("errors.themePresetWrite"))
}

#[tauri::command]
pub fn load_theme_presets(app: AppHandle) -> Vec<ThemePreset> {
    let Ok(dir) = themes_dir(&app) else {
        return Vec::new();
    };
    let _ = fs::create_dir_all(&dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut presets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !has_toml_extension(&path) {
            continue;
        }
        let Ok(id) = file_stem(&path) else {
            continue;
        };
        match read_theme_file(&path) {
            Ok((file, background)) => presets.push(to_preset(id, file, background)),
            Err(reason) => eprintln!("[theme-preset] skipping '{}': {reason}", path.display()),
        }
    }
    presets.sort_by_key(|preset| preset.name.to_lowercase());
    presets
}

#[tauri::command]
pub fn themes_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = themes_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| error::code("errors.themePresetFolder"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_themes_dir(app: AppHandle) -> Result<(), String> {
    let dir = themes_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| error::code("errors.themePresetFolder"))?;

    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    std::process::Command::new(program)
        .arg(dir)
        .spawn()
        .map_err(|_| error::code("errors.folderOpen"))?;
    Ok(())
}

#[tauri::command]
pub fn import_theme_preset(app: AppHandle, source_path: String) -> Result<ThemePreset, String> {
    let source = Path::new(&source_path);
    if !has_toml_extension(source) {
        return Err(error::code("errors.themePresetInvalid"));
    }
    let (mut file, background) =
        read_theme_file(source).map_err(|_| error::code("errors.themePresetInvalid"))?;
    let dir = themes_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| error::code("errors.themePresetFolder"))?;
    let requested = file_stem(source)?;
    let id = unique_stem(&dir, &requested);

    let copied_background = if let Some(background) = background {
        let extension = theme::validate_background_source(&background)?;
        let filename = format!("{id}-background.{extension}");
        let target = dir.join(&filename);
        fs::copy(&background, &target).map_err(|_| error::code("errors.themePresetWrite"))?;
        file.theme.background_image = Some(filename);
        Some(target)
    } else {
        file.theme.background_image = None;
        None
    };

    let target = dir.join(format!("{id}.toml"));
    if let Err(message) = write_theme_file(&target, &file) {
        if let Some(background) = &copied_background {
            let _ = fs::remove_file(background);
        }
        return Err(message);
    }
    Ok(to_preset(id, file, copied_background))
}

#[tauri::command]
pub fn export_theme_preset(
    target_path: String,
    theme_values: ThemeExportValues,
) -> Result<String, String> {
    let mut target = PathBuf::from(target_path);
    if !has_toml_extension(&target) {
        target.set_extension("toml");
    }
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = file_stem(&target)?;

    let mut file = ThemeFile {
        schema_version: SCHEMA_VERSION,
        name: humanize_stem(&stem),
        author: None,
        description: None,
        theme: ThemeFileValues {
            background_color: theme_values.background_color,
            accent_color: theme_values.accent_color,
            background_overlay: theme_values.background_overlay,
            motion: theme_values.motion,
            ui_font: theme_values.ui_font,
            terminal_font: theme_values.terminal_font,
            background_image: None,
        },
        tokens: theme_values.tokens,
    };
    validate_file(&file, parent).map_err(|_| error::code("errors.themePresetInvalid"))?;

    if let Some(source_path) = theme_values.background_image_path {
        let source = Path::new(&source_path);
        let extension = theme::validate_background_source(source)?;
        let filename = format!("{}-background.{extension}", safe_stem(&stem));
        let background_target = parent.join(&filename);
        if source != background_target {
            fs::copy(source, &background_target)
                .map_err(|_| error::code("errors.themePresetWrite"))?;
        }
        file.theme.background_image = Some(filename);
    }

    write_theme_file(&target, &file)?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_file() -> ThemeFile {
        ThemeFile {
            schema_version: 1,
            name: "Nocturne".to_string(),
            author: Some("sshland".to_string()),
            description: None,
            theme: ThemeFileValues {
                background_color: "#161826".to_string(),
                accent_color: "#9184d9".to_string(),
                background_overlay: 55,
                motion: "normal".to_string(),
                ui_font: "default".to_string(),
                terminal_font: "default".to_string(),
                background_image: None,
            },
            tokens: BTreeMap::new(),
        }
    }

    #[test]
    fn valid_preset_round_trips_through_toml() {
        let source = toml::to_string_pretty(&valid_file()).expect("serialize preset");
        let parsed: ThemeFile = toml::from_str(&source).expect("parse preset");
        assert!(validate_file(&parsed, Path::new(".")).is_ok());
        assert_eq!(parsed.name, "Nocturne");
    }

    #[test]
    fn documented_example_stays_valid() {
        let parsed: ThemeFile = toml::from_str(include_str!("../../docs/theme-example.toml"))
            .expect("parse documented theme example");
        assert!(validate_file(&parsed, Path::new(".")).is_ok());
    }

    #[test]
    fn rejects_unsafe_or_unknown_values() {
        let mut file = valid_file();
        file.theme.background_color = "red".to_string();
        assert!(validate_file(&file, Path::new(".")).is_err());

        let mut file = valid_file();
        file.theme.motion = "lots".to_string();
        assert!(validate_file(&file, Path::new(".")).is_err());

        let mut file = valid_file();
        file.theme.background_image = Some("../secret.png".to_string());
        assert!(validate_file(&file, Path::new(".")).is_err());

        let unknown_field = r##"
            schema_version = 1
            name = "Unsafe"
            command = "rm -rf /"

            [theme]
            background_color = "#161826"
            accent_color = "#9184d9"
            background_overlay = 55
            motion = "normal"
            ui_font = "default"
            terminal_font = "default"
        "##;
        assert!(toml::from_str::<ThemeFile>(unknown_field).is_err());

        let mut file = valid_file();
        file.tokens
            .insert("color-ink-900".to_string(), "not-a-color".to_string());
        assert!(validate_file(&file, Path::new(".")).is_err());

        let mut file = valid_file();
        file.tokens.insert(
            "shadow-pane-focus".to_string(),
            "url(https://example.com/tracker.png)".to_string(),
        );
        assert!(validate_file(&file, Path::new(".")).is_err());

        let mut file = valid_file();
        file.tokens
            .insert("unknown-future-token".to_string(), "1rem".to_string());
        assert!(validate_file(&file, Path::new(".")).is_err());
    }

    #[test]
    fn makes_portable_safe_filename_stems() {
        assert_eq!(safe_stem("Catppuccin Mocha"), "catppuccin-mocha");
        assert_eq!(safe_stem("../../"), "theme");
    }
}
