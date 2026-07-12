//! Converts low-level SSH/IO errors into short, friendly Korean messages.
//!
//! Beginners should never see raw technical strings like "Connection refused".
//! Every error surfaced to the frontend goes through here first.

use std::io;

/// Turn a TCP/connect IO error into a human sentence.
pub fn friendly_io(err: &io::Error) -> String {
    match err.kind() {
        io::ErrorKind::ConnectionRefused => {
            "서버에 연결할 수 없어요. 주소와 포트가 맞는지 확인해주세요.".into()
        }
        io::ErrorKind::TimedOut => {
            "서버가 응답하지 않아요. 주소·포트·방화벽 설정을 확인해주세요.".into()
        }
        io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted => {
            "서버와의 연결이 끊어졌어요. 다시 시도해주세요.".into()
        }
        io::ErrorKind::PermissionDenied => {
            "접근 권한이 없어요.".into()
        }
        _ => "서버에 연결하는 중 문제가 발생했어요. 주소와 포트를 확인해주세요.".into(),
    }
}

/// Message shown when a hostname cannot be resolved.
pub fn dns_error() -> String {
    "서버 주소를 찾을 수 없어요. 호스트 이름의 철자를 확인해주세요.".into()
}

/// Message shown when the username/password/key is rejected.
pub fn auth_error() -> String {
    "로그인에 실패했어요. 사용자명과 비밀번호(또는 개인키)를 확인해주세요.".into()
}

/// Message shown when a private key file cannot be read or parsed.
pub fn key_error() -> String {
    "개인키 파일을 읽을 수 없어요. 파일 경로와 형식(그리고 암호)이 맞는지 확인해주세요.".into()
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

/// Generic SFTP failure message with an operation-specific prefix.
pub fn sftp_error(action: &str) -> String {
    format!("{action} 중 문제가 발생했어요. 권한이 있는지, 경로가 맞는지 확인해주세요.")
}

/// Shown when the underlying connection has dropped.
pub fn disconnected_error() -> String {
    "서버와의 연결이 끊어졌어요. 다시 접속해주세요.".into()
}

/// Shown when a file is too large to open in the editor.
pub fn file_too_large() -> String {
    "파일이 너무 커서 편집기로 열 수 없어요. 대신 다운로드해주세요.".into()
}

/// Shown when a file isn't text (binary) and can't be edited.
pub fn binary_file() -> String {
    "이 파일은 편집기로 열 수 없어요. 텍스트 파일이 아니에요.".into()
}
