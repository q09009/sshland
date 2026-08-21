//! Converts low-level SSH/IO errors into stable, language-independent codes.
//!
//! The frontend translates these codes into the currently selected language.

use std::io;

const ERROR_PREFIX: &str = "sshland:error:";

pub fn code(key: &str) -> String {
    format!("{ERROR_PREFIX}{key}")
}

pub fn with_detail(key: &str, detail: impl AsRef<str>) -> String {
    format!("{ERROR_PREFIX}{key}|{}", detail.as_ref())
}

/// Turn a TCP/connect IO error into a stable frontend translation key.
pub fn friendly_io(err: &io::Error) -> String {
    match err.kind() {
        io::ErrorKind::ConnectionRefused => code("errors.connectionRefused"),
        io::ErrorKind::TimedOut => code("errors.timedOut"),
        io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted => {
            code("errors.connectionReset")
        }
        io::ErrorKind::PermissionDenied => code("errors.permissionDenied"),
        _ => code("errors.connect"),
    }
}

/// Message shown when a hostname cannot be resolved.
pub fn dns_error() -> String {
    code("errors.dns")
}

/// Message shown when the username/password/key is rejected.
pub fn auth_error() -> String {
    code("errors.auth")
}

/// Message shown when a private key file cannot be read or parsed.
pub fn key_error() -> String {
    code("errors.key")
}

/// Turn an ssh2 library error into a friendly sentence.
///
/// libssh2 reports auth failures and many transport problems with generic
/// codes, so we lean on the surrounding context (what we were doing) via the
/// `fallback` argument rather than exposing the raw message.
pub fn friendly_ssh(err: &ssh2::Error, fallback: &str) -> String {
    use ssh2::ErrorCode;
    match err.code() {
        ErrorCode::Session(-18) => auth_error(), // LIBSSH2_ERROR_AUTHENTICATION_FAILED
        ErrorCode::Session(-16) => auth_error(), // LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED
        _ => fallback.to_string(),
    }
}

/// Generic SFTP failure code with an operation-specific suffix.
pub fn sftp_error(action: &str) -> String {
    code(&format!("errors.sftp.{action}"))
}

/// Shown when the underlying connection has dropped.
pub fn disconnected_error() -> String {
    code("errors.disconnected")
}

/// Shown when a file is too large to open in the editor.
pub fn file_too_large() -> String {
    code("errors.fileTooLarge")
}

/// Shown when a file isn't text (binary) and can't be edited.
pub fn binary_file() -> String {
    code("errors.binaryFile")
}

/// Shown when creating a file/folder whose name is already taken.
pub fn already_exists() -> String {
    code("errors.alreadyExists")
}

/// Shown when a dashboard widget's command (or a process kill) fails to run.
pub fn command_failed() -> String {
    code("errors.commandFailed")
}

/// Shown when a macro can't be saved to the macros folder.
pub fn macro_save_failed() -> String {
    code("errors.macroSave")
}

/// Shown when a macro file can't be deleted.
pub fn macro_delete_failed() -> String {
    code("errors.macroDelete")
}

/// Shown when the macros folder can't be located or created.
pub fn macro_folder_failed() -> String {
    code("errors.macroFolder")
}

/// Shown when a macro can't be run (its exec channel failed to open).
pub fn macro_run_failed() -> String {
    code("errors.macroRun")
}
