//! SSH/SFTP session management.
//!
//! `ssh2` is a blocking library, so every session is owned by a dedicated
//! worker thread. Tauri commands (async) send [`Req`] messages to that thread
//! over a channel and await the reply on a oneshot channel. This keeps all
//! blocking network work off the UI thread and sidesteps `ssh2`'s borrow/`Send`
//! constraints (the `Session` and `Sftp` handles never leave the worker).

use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ssh2::{Session, Sftp};
use tauri::State;
use tokio::sync::{mpsc, oneshot};

use crate::error;

/// How the user proves their identity to the server.
///
/// No `Debug` derive: this carries secrets that must never be logged.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthMethod {
    /// Plain password authentication.
    Password { password: String },
    /// Private-key file, optionally protected by a passphrase.
    Key {
        path: String,
        passphrase: Option<String>,
    },
}

/// Everything needed to open a connection. No `Debug`: contains secrets.
#[derive(Deserialize)]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
}

/// Returned to the frontend after a successful connection.
#[derive(Serialize)]
pub struct ConnectResult {
    /// Absolute path of the user's starting (home) directory.
    pub home: String,
}

/// One file or folder in a directory listing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// Absolute path on the server.
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    /// Last-modified time as a Unix timestamp (seconds), if known.
    pub modified: Option<u64>,
    /// Unix permission string, e.g. "drwxr-xr-x".
    pub permissions: String,
}

/// A unit of work for the SSH worker thread.
pub enum Req {
    /// Resolve a path to its absolute form (used to discover the home dir).
    Canonicalize {
        path: String,
        resp: oneshot::Sender<Result<String, String>>,
    },
    /// List the contents of a directory.
    ListDir {
        path: String,
        resp: oneshot::Sender<Result<Vec<FileEntry>, String>>,
    },
    /// Close the connection and stop the worker.
    Disconnect,
}

/// Shared state: the sender half of the channel to the current worker, if any.
pub struct SessionManager {
    tx: Mutex<Option<mpsc::UnboundedSender<Req>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            tx: Mutex::new(None),
        }
    }

    /// Send a request to the active worker, or fail if disconnected.
    fn send(&self, req: Req) -> Result<(), String> {
        let guard = self.tx.lock().unwrap();
        match guard.as_ref() {
            Some(tx) => tx.send(req).map_err(|_| error::disconnected_error()),
            None => Err(error::disconnected_error()),
        }
    }
}

/// Open a TCP connection, trying each resolved address with a timeout.
fn tcp_connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|_| error::dns_error())?;
    let mut last: Option<io::Error> = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, Duration::from_secs(10)) {
            Ok(stream) => return Ok(stream),
            Err(e) => last = Some(e),
        }
    }
    Err(match last {
        Some(e) => error::friendly_io(&e),
        None => error::dns_error(),
    })
}

/// Perform the blocking TCP + SSH handshake + authentication.
///
/// Runs on a blocking thread; returns the authenticated session on success.
fn establish_session(params: ConnectParams) -> Result<Session, String> {
    let stream = tcp_connect(&params.host, params.port)?;

    let mut session = Session::new().map_err(|_| "SSH 세션을 만들 수 없어요.".to_string())?;
    // Per-operation timeout so a hung server never blocks forever.
    session.set_timeout(30_000);
    session.set_tcp_stream(stream);
    session.handshake().map_err(|e| {
        error::friendly_ssh(
            &e,
            "서버와 보안 연결을 맺지 못했어요. 이 서버가 SSH를 지원하는지 확인해주세요.",
        )
    })?;

    match params.auth {
        AuthMethod::Password { password } => {
            session
                .userauth_password(&params.username, &password)
                .map_err(|e| error::friendly_ssh(&e, &error::auth_error()))?;
        }
        AuthMethod::Key { path, passphrase } => {
            session
                .userauth_pubkey_file(
                    &params.username,
                    None,
                    Path::new(&path),
                    passphrase.as_deref(),
                )
                .map_err(|e| error::friendly_ssh(&e, &error::key_error()))?;
        }
    }

    if !session.authenticated() {
        return Err(error::auth_error());
    }
    Ok(session)
}

/// Join a Unix-style directory path with a child name, avoiding double slashes.
fn join_unix(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// Render Unix permission bits as a string like "drwxr-xr-x".
fn format_permissions(perm: u32) -> String {
    let file_type = match perm & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        0o010000 => 'p',
        0o140000 => 's',
        0o020000 => 'c',
        0o060000 => 'b',
        _ => '-',
    };
    let mut s = String::with_capacity(10);
    s.push(file_type);
    for shift in [6u32, 3, 0] {
        let bits = (perm >> shift) & 0o7;
        s.push(if bits & 0o4 != 0 { 'r' } else { '-' });
        s.push(if bits & 0o2 != 0 { 'w' } else { '-' });
        s.push(if bits & 0o1 != 0 { 'x' } else { '-' });
    }
    s
}

/// Read a directory into a list of [`FileEntry`], skipping "." and "..".
fn read_dir_entries(sftp: &Sftp, path: &str) -> Result<Vec<FileEntry>, String> {
    let raw = sftp
        .readdir(Path::new(path))
        .map_err(|_| error::sftp_error("폴더를 여는"))?;

    let mut entries = Vec::with_capacity(raw.len());
    for (child, stat) in raw {
        // Use only the final path component as the display name; build the full
        // path ourselves so we don't depend on how readdir formats it.
        let name = match child.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        if name == "." || name == ".." {
            continue;
        }
        let perm = stat.perm.unwrap_or(0);
        entries.push(FileEntry {
            path: join_unix(path, &name),
            name,
            size: stat.size.unwrap_or(0),
            is_dir: stat.is_dir(),
            is_symlink: (perm & 0o170000) == 0o120000,
            modified: stat.mtime,
            permissions: format_permissions(perm),
        });
    }
    Ok(entries)
}

/// The worker thread body: owns the session + SFTP handle for its whole life.
fn worker_loop(session: Session, mut rx: mpsc::UnboundedReceiver<Req>) {
    // Open the SFTP subsystem once and reuse it for every request.
    let sftp = match session.sftp() {
        Ok(sftp) => sftp,
        Err(_) => {
            // Couldn't start SFTP: fail every queued request so callers unblock.
            while let Some(req) = rx.blocking_recv() {
                match req {
                    Req::Canonicalize { resp, .. } => {
                        let _ = resp.send(Err(error::sftp_error("파일 작업을 준비하는")));
                    }
                    Req::ListDir { resp, .. } => {
                        let _ = resp.send(Err(error::sftp_error("파일 작업을 준비하는")));
                    }
                    Req::Disconnect => break,
                }
            }
            return;
        }
    };

    while let Some(req) = rx.blocking_recv() {
        match req {
            Req::Canonicalize { path, resp } => {
                let result = sftp
                    .realpath(Path::new(&path))
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|_| error::sftp_error("경로를 확인하는"));
                let _ = resp.send(result);
            }
            Req::ListDir { path, resp } => {
                let _ = resp.send(read_dir_entries(&sftp, &path));
            }
            Req::Disconnect => break,
        }
    }

    // Dropping `sftp`/`session` closes the channel; ask for a clean shutdown too.
    let _ = session.disconnect(None, "bye", None);
}

/// Connect to a server and return the starting directory.
#[tauri::command]
pub async fn connect(
    state: State<'_, SessionManager>,
    params: ConnectParams,
) -> Result<ConnectResult, String> {
    // Drop any previous session first.
    if let Some(old) = state.tx.lock().unwrap().take() {
        let _ = old.send(Req::Disconnect);
    }

    // The handshake blocks, so run it off the async runtime's threads.
    let session = tauri::async_runtime::spawn_blocking(move || establish_session(params))
        .await
        .map_err(|_| "내부 오류가 발생했어요. 다시 시도해주세요.".to_string())??;

    // Hand the session to a dedicated worker thread.
    let (tx, rx) = mpsc::unbounded_channel();
    std::thread::spawn(move || worker_loop(session, rx));
    *state.tx.lock().unwrap() = Some(tx);

    // Resolve the home directory as a first real SFTP round-trip.
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Canonicalize {
        path: ".".to_string(),
        resp: resp_tx,
    })?;
    let home = resp_rx
        .await
        .map_err(|_| error::disconnected_error())??;

    Ok(ConnectResult { home })
}

/// List the contents of a directory on the server.
#[tauri::command]
pub async fn list_dir(
    state: State<'_, SessionManager>,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::ListDir {
        path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Close the current connection, if any.
#[tauri::command]
pub async fn disconnect(state: State<'_, SessionManager>) -> Result<(), String> {
    if let Some(tx) = state.tx.lock().unwrap().take() {
        let _ = tx.send(Req::Disconnect);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test against Rebex's public read-only SFTP test server.
    /// Ignored by default (needs network); run with:
    ///   cargo test -- --ignored connects_to_public_test_server
    #[test]
    #[ignore]
    fn connects_to_public_test_server() {
        let params = ConnectParams {
            host: "test.rebex.net".to_string(),
            port: 22,
            username: "demo".to_string(),
            auth: AuthMethod::Password {
                password: "password".to_string(),
            },
        };
        let session = establish_session(params).expect("should authenticate");
        let sftp = session.sftp().expect("should open sftp");
        let home = sftp.realpath(Path::new(".")).expect("should resolve home");
        assert!(!home.to_string_lossy().is_empty());
    }
}
