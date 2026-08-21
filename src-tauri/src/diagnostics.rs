//! Small, dependency-free diagnostic log for connection lifecycle events.
//!
//! The log intentionally excludes hosts, usernames, credentials, commands, and
//! file paths. It is meant to explain *why* the SSH worker stopped without
//! turning the log file into a record of the user's remote activity.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

const LOG_FILE_NAME: &str = "sshland.log";
const PREVIOUS_LOG_FILE_NAME: &str = "sshland.previous.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;

static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Append one structured line to the persistent app log and mirror it to the
/// development terminal. Logging is best-effort and must never break SSH work.
pub fn record(app: &AppHandle, level: &str, event: &str, fields: &[(&str, String)]) {
    let line = format_line(level, event, fields);
    eprintln!("[sshland] {line}");

    if let Err(error) = append_line(app, &line) {
        eprintln!("[sshland] diagnostic_log_write_failed error={error}");
    }
}

fn format_line(level: &str, event: &str, fields: &[(&str, String)]) -> String {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut line = format!(
        "ts_unix_ms={timestamp_ms} level={} component=ssh event={}",
        quote(level),
        quote(event)
    );
    for (key, value) in fields {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(&quote(value));
    }
    line
}

fn quote(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "\\r")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

fn append_line(app: &AppHandle, line: &str) -> Result<(), String> {
    let _guard = LOG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

    let path = directory.join(LOG_FILE_NAME);
    rotate_if_needed(&path, &directory.join(PREVIOUS_LOG_FILE_NAME))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

fn rotate_if_needed(path: &Path, previous_path: &PathBuf) -> Result<(), String> {
    let size = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if size < MAX_LOG_BYTES {
        return Ok(());
    }

    match fs::remove_file(previous_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    fs::rename(path, previous_path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::quote;

    #[test]
    fn quoted_fields_stay_on_one_log_line() {
        assert_eq!(quote("a\r\nb\"c\\d"), "\"a\\r\\nb\\\"c\\\\d\"");
    }
}
