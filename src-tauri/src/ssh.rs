//! SSH/SFTP session management.
//!
//! `ssh2` is a blocking library, so every session is owned by a dedicated
//! worker thread. Tauri commands (async) send [`Req`] messages to that thread
//! over a channel and await the reply on a oneshot channel. This keeps all
//! blocking network work off the UI thread and sidesteps `ssh2`'s borrow/`Send`
//! constraints (the `Session` and `Sftp` handles never leave the worker).

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use ssh2::{
    Channel, CheckResult, HashType, HostKeyType, KnownHostFileKind, OpenFlags, OpenType,
    PtyModeOpcode, PtyModes, Session, Sftp,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use crate::{diagnostics, error};

/// How often the worker polls terminal channels for output while any are open.
const TERMINAL_POLL: Duration = Duration::from_millis(15);
/// SSH-level keepalive interval. `set_keepalive` only configures libssh2;
/// `keepalive_send` still has to be called by the worker at this cadence.
const KEEPALIVE_INTERVAL_SECS: u32 = 30;
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(KEEPALIVE_INTERVAL_SECS as u64);
/// Read buffer size for terminal output.
const TERM_BUF: usize = 32 * 1024;
/// Largest file the editor will open in-memory. Bigger files are refused so a
/// huge file can't exhaust memory or bog down CodeMirror; the frontend catches
/// this earlier via the listing size and offers a download instead.
const MAX_EDIT_SIZE: u64 = 5 * 1024 * 1024;
/// Bound recursive search results so broad queries cannot flood the UI or make
/// hundreds of unbounded follow-up SFTP metadata requests.
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_SEARCH_QUERY_CHARS: usize = 256;
const MAX_SEARCH_PATH_BYTES: usize = 64 * 1024;

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
    /// SHA-256 fingerprint the user explicitly approved after a prior probe.
    /// It is compared against a fresh handshake before anything is persisted.
    #[serde(default, rename = "acceptHostFingerprint")]
    pub accept_host_fingerprint: Option<String>,
}

/// Returned to the frontend after a successful connection.
#[derive(Serialize)]
pub struct ConnectResult {
    /// Absolute path of the user's starting (home) directory.
    pub home: String,
}

/// Result of checking one optional server-side file-search command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchToolCheck {
    pub available: bool,
    /// The executable name that will be used (`find`, `fd`, or `fdfind`).
    pub command: Option<String>,
}

#[derive(Copy, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchEngine {
    Find,
    Fd,
}

/// One bounded page of recursive search results.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

/// Structured connection failures let the frontend distinguish a host-key
/// decision from an ordinary localized error without parsing human text.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectError {
    UnknownHost {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    HostKeyChanged {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    Message {
        message: String,
    },
}

impl From<String> for ConnectError {
    fn from(message: String) -> Self {
        Self::Message { message }
    }
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

/// A remote text file's contents, decoded for the editor.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// The file's text, decoded to UTF-8 for CodeMirror.
    pub content: String,
    /// The encoding the file was stored in (e.g. "UTF-8", "EUC-KR"). Echoed
    /// back on save so we re-encode to the same bytes and don't change it.
    pub encoding: String,
}

/// Progress update for an in-flight file transfer, streamed to the frontend
/// as a `transfer-progress` event.
#[derive(Serialize, Clone)]
struct TransferProgress {
    /// Frontend-supplied id identifying this transfer.
    id: String,
    transferred: u64,
    total: u64,
}

/// Describes the local entry that finished uploading so the frontend can
/// render an honest equivalent command (`scp` vs `scp -r`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub is_dir: bool,
}

/// A chunk of terminal output, streamed as a `terminal-output` event.
#[derive(Serialize, Clone)]
struct TerminalOutput {
    /// Terminal (pane) id this output belongs to.
    id: String,
    /// Raw bytes from the shell; the frontend feeds these straight to xterm.js.
    data: Vec<u8>,
}

/// One frontend input chunk waiting to be fully written. Keeping the offset
/// lets a non-blocking write resume after `WouldBlock` without dropping or
/// duplicating any bytes.
struct PendingTerminalInput {
    data: Vec<u8>,
    written: usize,
}

type PendingTerminalInputs = HashMap<String, std::collections::VecDeque<PendingTerminalInput>>;

/// A chunk of a macro run's combined stdout/stderr, streamed as a `macro-output`
/// event. The frontend accumulates these and parses its own step sentinels out.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MacroOutput {
    /// The run id the frontend supplied when starting the macro.
    run_id: String,
    data: Vec<u8>,
}

/// Signals that a macro run's exec channel has finished/closed, as a
/// `macro-closed` event. Any steps still pending by now didn't run.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MacroClosed {
    run_id: String,
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
    /// Recursively search below a remote directory using `find` or `fd`.
    Search {
        root: String,
        query: String,
        engine: SearchEngine,
        include_hidden: bool,
        resp: oneshot::Sender<Result<SearchResult, String>>,
    },
    /// Download a remote file or folder to a local path, emitting progress events.
    Download {
        id: String,
        remote_path: String,
        local_path: PathBuf,
        is_dir: bool,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Upload a local file or folder to a remote path, emitting progress events.
    Upload {
        id: String,
        local_path: String,
        remote_path: String,
        resp: oneshot::Sender<Result<UploadResult, String>>,
    },
    /// Rename/move a remote entry.
    Rename {
        from: String,
        to: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Create a new directory.
    Mkdir {
        path: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Create a new, empty file (fails if one already exists).
    CreateFile {
        path: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Delete a file, or a directory (recursively).
    Delete {
        path: String,
        is_dir: bool,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Copy a file or directory to a new path (server-side `cp -r`).
    Copy {
        src: String,
        dst: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Run a single command over a short-lived exec channel and return its
    /// stdout. Used by dashboard widgets polling on a timer and by the process
    /// manager's kill action — one-shot execs sharing the worker, never a
    /// persistent channel like a PTY terminal.
    RunOnce {
        command: String,
        resp: oneshot::Sender<Result<String, String>>,
    },
    /// Read a remote text file's whole contents into memory (for the editor).
    ReadFile {
        path: String,
        resp: oneshot::Sender<Result<FileContent, String>>,
    },
    /// Overwrite a remote file with new text contents (from the editor),
    /// re-encoding to `encoding` (the file's original encoding).
    WriteFile {
        path: String,
        contents: String,
        encoding: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Open a new PTY shell channel on the existing connection.
    OpenTerminal {
        id: String,
        cols: u16,
        rows: u16,
        setup: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Send keystrokes/input to a terminal's shell (fire-and-forget).
    WriteTerminal { id: String, data: Vec<u8> },
    /// Tell the shell its window was resized (fire-and-forget).
    ResizeTerminal { id: String, cols: u16, rows: u16 },
    /// Close a terminal's channel, leaving the SSH connection intact.
    CloseTerminal { id: String },
    /// Run a macro: exec a pre-assembled script (steps joined with sentinel
    /// echoes) over one non-PTY channel, registered for streaming polling. The
    /// frontend parses its own sentinels out of the `macro-output` stream. Uses
    /// a persistent-until-done exec channel (streamed), NOT the one-shot RunOnce
    /// used by dashboard widgets, because steps share shell state (cd, exports).
    RunMacro {
        run_id: String,
        script: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Stop a running macro by closing its exec channel (ends the remote script).
    StopMacro { run_id: String },
    /// Close the connection and stop the worker.
    Disconnect,
}

/// Reply to a request with an error. Returns `false` for `Disconnect` (a
/// signal that the worker should stop).
fn reply_err(req: Req, msg: String) -> bool {
    match req {
        Req::Canonicalize { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::ListDir { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Search { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Download { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Upload { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Rename { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Mkdir { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::CreateFile { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Delete { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Copy { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::RunOnce { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::ReadFile { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::WriteFile { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::OpenTerminal { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::RunMacro { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        // Fire-and-forget messages have no reply channel.
        Req::WriteTerminal { .. }
        | Req::ResizeTerminal { .. }
        | Req::CloseTerminal { .. }
        | Req::StopMacro { .. } => true,
        Req::Disconnect => false,
    }
}

/// Shared state: the sender half of the channel to the current worker, if any.
pub struct SessionManager {
    tx: Mutex<Option<mpsc::Sender<Req>>>,
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

fn known_hosts_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("known_hosts"))
        .map_err(|_| error::code("errors.knownHostsFolder"))
}

fn known_host_name(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn host_key_algorithm(key_type: HostKeyType) -> &'static str {
    match key_type {
        HostKeyType::Rsa => "RSA",
        HostKeyType::Dss => "DSA",
        HostKeyType::Ecdsa256 => "ECDSA P-256",
        HostKeyType::Ecdsa384 => "ECDSA P-384",
        HostKeyType::Ecdsa521 => "ECDSA P-521",
        HostKeyType::Ed25519 => "ED25519",
        HostKeyType::Unknown => "Unknown",
    }
}

fn format_sha256_fingerprint(digest: &[u8]) -> String {
    format!("SHA256:{}", STANDARD_NO_PAD.encode(digest))
}

fn host_key_error(
    changed: bool,
    host: &str,
    port: u16,
    algorithm: &str,
    fingerprint: &str,
) -> ConnectError {
    if changed {
        ConnectError::HostKeyChanged {
            host: host.to_string(),
            port,
            algorithm: algorithm.to_string(),
            fingerprint: fingerprint.to_string(),
        }
    } else {
        ConnectError::UnknownHost {
            host: host.to_string(),
            port,
            algorithm: algorithm.to_string(),
            fingerprint: fingerprint.to_string(),
        }
    }
}

/// Verify the server identity after the SSH handshake and before sending any
/// user credentials. New hosts use trust-on-first-use: the first call returns
/// the fingerprint, and a second call must carry that exact approved value.
fn verify_host_key(
    session: &Session,
    host: &str,
    port: u16,
    accepted_fingerprint: Option<&str>,
    path: &Path,
) -> Result<(), ConnectError> {
    let (server_key, key_type) = session
        .host_key()
        .ok_or_else(|| error::code("errors.hostKeyUnavailable"))?;
    let server_key = server_key.to_vec();
    let fingerprint = session
        .host_key_hash(HashType::Sha256)
        .map(format_sha256_fingerprint)
        .ok_or_else(|| error::code("errors.hostKeyUnavailable"))?;
    let algorithm = host_key_algorithm(key_type);

    let mut known_hosts = session
        .known_hosts()
        .map_err(|_| error::code("errors.knownHostsRead"))?;
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            known_hosts
                .read_file(path, KnownHostFileKind::OpenSSH)
                .map_err(|_| error::code("errors.knownHostsRead"))?;
        }
        Ok(_) => return Err(error::code("errors.knownHostsRead").into()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(_) => return Err(error::code("errors.knownHostsRead").into()),
    }

    match known_hosts.check_port(host, port, &server_key) {
        CheckResult::Match => Ok(()),
        CheckResult::Mismatch => Err(host_key_error(true, host, port, algorithm, &fingerprint)),
        CheckResult::NotFound => match accepted_fingerprint {
            Some(accepted) if accepted == fingerprint => {
                if matches!(key_type, HostKeyType::Unknown) {
                    return Err(error::code("errors.hostKeyUnavailable").into());
                }
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|_| error::code("errors.knownHostsFolder"))?;
                }
                known_hosts
                    .add(
                        &known_host_name(host, port),
                        &server_key,
                        "sshland",
                        key_type.into(),
                    )
                    .map_err(|_| error::code("errors.knownHostsWrite"))?;
                known_hosts
                    .write_file(path, KnownHostFileKind::OpenSSH)
                    .map_err(|_| error::code("errors.knownHostsWrite"))?;
                Ok(())
            }
            // The key changed between the confirmation dialog and this fresh
            // handshake. Never replace the value the user actually reviewed.
            Some(_) => Err(host_key_error(true, host, port, algorithm, &fingerprint)),
            None => Err(host_key_error(false, host, port, algorithm, &fingerprint)),
        },
        CheckResult::Failure => Err(error::code("errors.knownHostsRead").into()),
    }
}

/// Perform the blocking TCP + SSH handshake + host verification +
/// authentication. Credentials are never sent until verification succeeds.
fn establish_session(
    params: ConnectParams,
    known_hosts_path: PathBuf,
) -> Result<Session, ConnectError> {
    let stream = tcp_connect(&params.host, params.port)?;

    let mut session = Session::new().map_err(|_| error::code("errors.sessionCreate"))?;
    // Per-operation timeout so a hung server never blocks forever.
    session.set_timeout(30_000);
    session.set_tcp_stream(stream);
    session
        .handshake()
        .map_err(|e| error::friendly_ssh(&e, &error::code("errors.handshake")))?;

    verify_host_key(
        &session,
        &params.host,
        params.port,
        params.accept_host_fingerprint.as_deref(),
        &known_hosts_path,
    )?;

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
        return Err(error::auth_error().into());
    }

    // Configure SSH keepalives. The worker calls `keepalive_send` periodically;
    // configuration alone does not put keepalive packets on the wire.
    session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);
    Ok(session)
}

/// Send a request's result to its caller, detecting a dropped connection.
///
/// On error we probe the link with a cheap SFTP round-trip (`realpath`). If
/// that fails too, the connection is gone, so we notify the frontend and signal
/// the worker to stop. Returns `true` when the worker should break its loop.
fn ssh_error_code(error: &ssh2::Error) -> String {
    match error.code() {
        ssh2::ErrorCode::Session(code) => format!("session:{code}"),
        ssh2::ErrorCode::SFTP(code) => format!("sftp:{code}"),
    }
}

fn record_connection_lost(
    app: &AppHandle,
    trigger: &str,
    operation: &str,
    probe_error: &ssh2::Error,
    primary_error: Option<&ssh2::Error>,
    terminal_channels: usize,
    macro_channels: usize,
) {
    let mut fields = vec![
        ("trigger", trigger.to_owned()),
        ("operation", operation.to_owned()),
        ("probe_error_code", ssh_error_code(probe_error)),
        ("probe_error_message", probe_error.message().to_owned()),
        ("terminal_channels", terminal_channels.to_string()),
        ("macro_channels", macro_channels.to_string()),
    ];

    if let Some(primary_error) = primary_error {
        fields.push(("primary_error_code", ssh_error_code(primary_error)));
        fields.push(("primary_error_message", primary_error.message().to_owned()));
    }

    diagnostics::record(app, "ERROR", "connection_lost", &fields);
}

fn send_and_check<T>(
    sftp: &Sftp,
    app: &AppHandle,
    operation: &'static str,
    terminal_channels: usize,
    macro_channels: usize,
    result: Result<T, String>,
    resp: oneshot::Sender<Result<T, String>>,
) -> bool {
    match result {
        Ok(value) => {
            let _ = resp.send(Ok(value));
            false
        }
        Err(msg) => {
            if let Err(probe_error) = sftp.realpath(Path::new(".")) {
                record_connection_lost(
                    app,
                    "request_error_probe_failed",
                    operation,
                    &probe_error,
                    None,
                    terminal_channels,
                    macro_channels,
                );
                let _ = app.emit("connection-lost", ());
                let _ = resp.send(Err(error::disconnected_error()));
                true
            } else {
                let _ = resp.send(Err(msg));
                false
            }
        }
    }
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
        .map_err(|_| error::sftp_error("folderOpen"))?;

    let mut entries = Vec::with_capacity(raw.len());
    for (child, stat) in raw {
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

enum DownloadPlanEntry {
    Directory {
        local_path: PathBuf,
    },
    File {
        remote_path: String,
        local_path: PathBuf,
    },
}

struct DownloadPlan {
    entries: Vec<DownloadPlanEntry>,
    total_bytes: u64,
}

/// Map one Unix remote filename to one local child without allowing a remote
/// name such as `..` or a Windows-looking path to escape the chosen folder.
fn safe_local_child(base: &Path, name: &str) -> Result<PathBuf, String> {
    let relative = Path::new(name);
    let mut components = relative.components();
    if !matches!(components.next(), Some(std::path::Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(error::with_detail("errors.downloadName", name));
    }
    Ok(base.join(relative))
}

/// Inspect the complete remote tree before creating local files. This gives a
/// folder one aggregate progress total and catches unreadable children early.
fn build_download_plan(
    sftp: &Sftp,
    remote: &str,
    local: &Path,
    is_dir: bool,
) -> Result<DownloadPlan, String> {
    let mut entries = Vec::new();
    let mut total_bytes = 0;

    if is_dir {
        append_download_directory(sftp, remote, local, &mut entries, &mut total_bytes)?;
    } else {
        let size = sftp
            .stat(Path::new(remote))
            .map_err(|_| error::sftp_error("fileDownload"))?
            .size
            .unwrap_or(0);
        total_bytes = size;
        entries.push(DownloadPlanEntry::File {
            remote_path: remote.to_string(),
            local_path: local.to_path_buf(),
        });
    }

    Ok(DownloadPlan {
        entries,
        total_bytes,
    })
}

fn append_download_directory(
    sftp: &Sftp,
    remote: &str,
    local: &Path,
    entries: &mut Vec<DownloadPlanEntry>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    entries.push(DownloadPlanEntry::Directory {
        local_path: local.to_path_buf(),
    });
    let mut children = read_dir_entries(sftp, remote)?;
    children.sort_by(|left, right| left.name.cmp(&right.name));

    for child in children {
        let local_child = safe_local_child(local, &child.name)?;
        // Recreating remote symlinks portably would require elevated local
        // privileges on some platforms, while following them could escape the
        // selected tree or create cycles. Fail during the planning pass before
        // any local file is created.
        if child.is_symlink {
            return Err(error::with_detail("errors.downloadSymlink", child.path));
        }
        if child.is_dir {
            append_download_directory(sftp, &child.path, &local_child, entries, total_bytes)?;
        } else {
            *total_bytes = total_bytes
                .checked_add(child.size)
                .ok_or_else(|| error::code("errors.downloadTooLarge"))?;
            entries.push(DownloadPlanEntry::File {
                remote_path: child.path,
                local_path: local_child,
            });
        }
    }
    Ok(())
}

struct DownloadProgress {
    transferred: u64,
    total: u64,
    last_emit: Instant,
}

impl DownloadProgress {
    fn emit(&mut self, app: &AppHandle, id: &str, force: bool) {
        if force || self.last_emit.elapsed() >= Duration::from_millis(100) {
            emit_progress(app, id, self.transferred, self.total);
            self.last_emit = Instant::now();
        }
    }
}

/// Stream one planned remote file to disk, contributing to the aggregate
/// progress shared by the selected top-level file or folder.
fn download_planned_file(
    sftp: &Sftp,
    app: &AppHandle,
    id: &str,
    remote: &str,
    local: &Path,
    progress: &mut DownloadProgress,
) -> Result<(), String> {
    let mut remote_file = sftp
        .open(Path::new(remote))
        .map_err(|_| error::sftp_error("fileDownload"))?;
    let mut local_file = File::create(local).map_err(|_| error::code("errors.localFileCreate"))?;

    let mut buf = [0u8; 32 * 1024];

    loop {
        let n = remote_file
            .read(&mut buf)
            .map_err(|_| error::sftp_error("fileDownload"))?;
        if n == 0 {
            break;
        }
        local_file
            .write_all(&buf[..n])
            .map_err(|_| error::code("errors.localFileWrite"))?;
        progress.transferred += n as u64;
        progress.emit(app, id, false);
    }
    Ok(())
}

fn download_path(
    sftp: &Sftp,
    app: &AppHandle,
    id: &str,
    remote: &str,
    local: &Path,
    is_dir: bool,
) -> Result<(), String> {
    let plan = build_download_plan(sftp, remote, local, is_dir)?;
    let mut progress = DownloadProgress {
        transferred: 0,
        total: plan.total_bytes,
        last_emit: Instant::now(),
    };
    progress.emit(app, id, true);

    for entry in plan.entries {
        let result = match entry {
            DownloadPlanEntry::Directory { local_path } => {
                fs::create_dir_all(local_path).map_err(|_| error::code("errors.localFolderCreate"))
            }
            DownloadPlanEntry::File {
                remote_path,
                local_path,
            } => download_planned_file(sftp, app, id, &remote_path, &local_path, &mut progress),
        };
        if let Err(message) = result {
            progress.emit(app, id, true);
            return Err(message);
        }
    }

    progress.emit(app, id, true);
    Ok(())
}

enum UploadPlanEntry {
    Directory {
        remote_path: String,
    },
    File {
        local_path: PathBuf,
        remote_path: String,
    },
}

struct UploadPlan {
    entries: Vec<UploadPlanEntry>,
    total_bytes: u64,
    is_dir: bool,
}

/// Inspect a local file tree before touching the server. Besides giving folder
/// uploads one aggregate byte total, this catches unreadable children and
/// symlinks before leaving a partially-created remote tree whenever possible.
fn build_upload_plan(local: &Path, remote: &str) -> Result<UploadPlan, String> {
    let root_meta =
        fs::symlink_metadata(local).map_err(|_| error::code("errors.uploadSourceOpen"))?;
    let is_dir = root_meta.is_dir();
    let mut entries = Vec::new();
    let mut total_bytes = 0;
    append_upload_plan(local, remote, &mut entries, &mut total_bytes)?;
    Ok(UploadPlan {
        entries,
        total_bytes,
        is_dir,
    })
}

fn append_upload_plan(
    local: &Path,
    remote: &str,
    entries: &mut Vec<UploadPlanEntry>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let meta = fs::symlink_metadata(local)
        .map_err(|_| error::with_detail("errors.uploadItemRead", local.display().to_string()))?;

    if meta.file_type().is_symlink() {
        return Err(error::with_detail(
            "errors.uploadSymlink",
            local.display().to_string(),
        ));
    }

    if meta.is_dir() {
        entries.push(UploadPlanEntry::Directory {
            remote_path: remote.to_string(),
        });
        let children = fs::read_dir(local).map_err(|_| {
            error::with_detail("errors.uploadFolderRead", local.display().to_string())
        })?;
        let mut children = children
            .collect::<Result<Vec<_>, io::Error>>()
            .map_err(|_| {
                error::with_detail("errors.uploadFolderRead", local.display().to_string())
            })?;
        children.sort_by_key(|item| item.file_name());

        for child in children {
            let child_name = child.file_name();
            let child_name = child_name.to_str().ok_or_else(|| {
                error::with_detail("errors.uploadName", child.path().display().to_string())
            })?;
            append_upload_plan(
                &child.path(),
                &join_unix(remote, child_name),
                entries,
                total_bytes,
            )?;
        }
        return Ok(());
    }

    if meta.is_file() {
        *total_bytes = total_bytes
            .checked_add(meta.len())
            .ok_or_else(|| error::code("errors.uploadTooLarge"))?;
        entries.push(UploadPlanEntry::File {
            local_path: local.to_path_buf(),
            remote_path: remote.to_string(),
        });
        return Ok(());
    }

    Err(error::with_detail(
        "errors.uploadUnsupported",
        local.display().to_string(),
    ))
}

fn ensure_remote_directory(sftp: &Sftp, remote: &str) -> Result<(), String> {
    match sftp.stat(Path::new(remote)) {
        Ok(stat) if stat.is_dir() => Ok(()),
        Ok(_) => Err(error::with_detail("errors.uploadConflict", remote)),
        Err(_) => sftp
            .mkdir(Path::new(remote), 0o755)
            .map_err(|_| error::sftp_error("folderCreate")),
    }
}

struct UploadProgress {
    transferred: u64,
    total: u64,
    last_emit: Instant,
}

impl UploadProgress {
    fn emit(&mut self, app: &AppHandle, id: &str, force: bool) {
        if force || self.last_emit.elapsed() >= Duration::from_millis(100) {
            emit_progress(app, id, self.transferred, self.total);
            self.last_emit = Instant::now();
        }
    }
}

/// Stream one planned local file up to the server, contributing its bytes to
/// the progress total shared by the whole top-level upload.
fn upload_planned_file(
    sftp: &Sftp,
    app: &AppHandle,
    id: &str,
    local: &Path,
    remote: &str,
    progress: &mut UploadProgress,
) -> Result<(), String> {
    let mut local_file = File::open(local)
        .map_err(|_| error::with_detail("errors.uploadFileOpen", local.display().to_string()))?;
    let mut remote_file = sftp
        .create(Path::new(remote))
        .map_err(|_| error::sftp_error("fileUpload"))?;

    let mut buf = [0u8; 32 * 1024];

    loop {
        let n = local_file
            .read(&mut buf)
            .map_err(|_| error::code("errors.uploadFileRead"))?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buf[..n])
            .map_err(|_| error::sftp_error("fileUpload"))?;
        progress.transferred += n as u64;
        progress.emit(app, id, false);
    }
    Ok(())
}

/// Upload a local file or recursively upload a folder using only SFTP. Existing
/// remote directories are merged; existing files keep the previous overwrite
/// behavior of `sftp.create`.
fn upload_path(
    sftp: &Sftp,
    app: &AppHandle,
    id: &str,
    local: &str,
    remote: &str,
) -> Result<UploadResult, String> {
    let plan = build_upload_plan(Path::new(local), remote)?;
    let mut progress = UploadProgress {
        transferred: 0,
        total: plan.total_bytes,
        last_emit: Instant::now(),
    };
    progress.emit(app, id, true);

    for entry in plan.entries {
        let result = match entry {
            UploadPlanEntry::Directory { remote_path } => {
                ensure_remote_directory(sftp, &remote_path)
            }
            UploadPlanEntry::File {
                local_path,
                remote_path,
            } => upload_planned_file(sftp, app, id, &local_path, &remote_path, &mut progress),
        };
        if let Err(message) = result {
            progress.emit(app, id, true);
            return Err(message);
        }
    }

    progress.emit(app, id, true);
    Ok(UploadResult {
        is_dir: plan.is_dir,
    })
}

fn emit_progress(app: &AppHandle, id: &str, transferred: u64, total: u64) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            id: id.to_string(),
            transferred,
            total,
        },
    );
}

/// Read a remote file's contents into UTF-8 text for the editor.
///
/// Refuses anything too large ([`MAX_EDIT_SIZE`]) or truly binary (contains a
/// null byte). Valid UTF-8 is the fast path; otherwise the encoding is guessed
/// (chardetng) and transcoded to UTF-8 (encoding_rs). The original encoding is
/// returned so a save re-encodes to the same bytes. A file that still can't be
/// decoded cleanly is treated as binary (editing it could corrupt it on save).
fn read_file_contents(sftp: &Sftp, path: &str) -> Result<FileContent, String> {
    let mut remote_file = sftp.open(Path::new(path)).map_err(|e| {
        eprintln!("read_remote_file: open failed for {path}: {e}");
        error::sftp_error("fileOpen")
    })?;

    let size = remote_file.stat().ok().and_then(|s| s.size).unwrap_or(0);
    if size > MAX_EDIT_SIZE {
        return Err(error::file_too_large());
    }

    // Read in a fixed-buffer loop — the same path download uses. `read_to_end`
    // on an `ssh2::File` errors on some servers (it keeps reading past EOF
    // instead of returning Ok(0)), which surfaced as a spurious open error.
    let mut bytes: Vec<u8> = Vec::with_capacity(size.min(MAX_EDIT_SIZE) as usize);
    let mut buf = [0u8; 32 * 1024];
    loop {
        let n = match remote_file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                eprintln!("read_remote_file: read failed for {path}: {e}");
                return Err(error::sftp_error("fileOpen"));
            }
        };
        bytes.extend_from_slice(&buf[..n]);
        if bytes.len() as u64 > MAX_EDIT_SIZE {
            return Err(error::file_too_large());
        }
    }

    decode_text(&bytes)
}

/// Decode raw file bytes to UTF-8 text, detecting the encoding when needed.
///
/// A null byte, or content that can't be decoded cleanly, is reported as binary
/// (editing it could corrupt it on save). Pure, so it can be unit-tested.
fn decode_text(bytes: &[u8]) -> Result<FileContent, String> {
    // A null byte means it's not text at all — never try to decode it.
    if bytes.contains(&0) {
        return Err(error::binary_file());
    }

    // Fast path: already UTF-8.
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(FileContent {
            content: text.to_string(),
            encoding: "UTF-8".to_string(),
        });
    }

    // Otherwise guess the encoding and transcode to UTF-8.
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (text, had_errors) = encoding.decode_without_bom_handling(bytes);
    if had_errors {
        // Couldn't decode cleanly → can't safely re-encode on save.
        return Err(error::binary_file());
    }
    Ok(FileContent {
        content: text.into_owned(),
        encoding: encoding.name().to_string(),
    })
}

/// Encode editor text back to the file's original encoding. Pure/testable.
fn encode_text(contents: &str, encoding: &str) -> Vec<u8> {
    if encoding.eq_ignore_ascii_case("UTF-8") {
        return contents.as_bytes().to_vec();
    }
    match encoding_rs::Encoding::for_label(encoding.as_bytes()) {
        Some(enc) => enc.encode(contents).0.into_owned(),
        // Unknown label (shouldn't happen — it came from us): save as UTF-8.
        None => contents.as_bytes().to_vec(),
    }
}

/// Create a new, empty file. Fails if something already exists at `path`, so an
/// existing file is never clobbered (the editor's "new file" flow).
fn create_empty_file(sftp: &Sftp, path: &str) -> Result<(), String> {
    if sftp.stat(Path::new(path)).is_ok() {
        return Err(error::already_exists());
    }
    // Opening with CREATE|TRUNCATE and immediately dropping the handle leaves a
    // zero-byte file behind.
    sftp.open_mode(
        Path::new(path),
        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        0o644,
        OpenType::File,
    )
    .map_err(|_| error::sftp_error("fileCreate"))?;
    Ok(())
}

/// Overwrite a remote file with new text (truncating any existing contents),
/// re-encoding from UTF-8 to `encoding` (the file's original encoding).
fn write_file_contents(
    sftp: &Sftp,
    path: &str,
    contents: &str,
    encoding: &str,
) -> Result<(), String> {
    let bytes = encode_text(contents, encoding);
    let mut remote_file = sftp
        .create(Path::new(path))
        .map_err(|_| error::sftp_error("fileSave"))?;
    remote_file
        .write_all(&bytes)
        .map_err(|_| error::sftp_error("fileSave"))?;
    Ok(())
}

/// Recursively delete a directory and everything inside it.
fn remove_recursive(sftp: &Sftp, path: &str) -> Result<(), String> {
    let raw = sftp
        .readdir(Path::new(path))
        .map_err(|_| error::sftp_error("folderDelete"))?;
    for (child, stat) in raw {
        let name = match child.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        if name == "." || name == ".." {
            continue;
        }
        let child_path = join_unix(path, &name);
        // lstat-based is_dir: symlinks report false, so they're just unlinked.
        if stat.is_dir() {
            remove_recursive(sftp, &child_path)?;
        } else {
            sftp.unlink(Path::new(&child_path))
                .map_err(|_| error::sftp_error("fileDelete"))?;
        }
    }
    sftp.rmdir(Path::new(path))
        .map_err(|_| error::sftp_error("folderDelete"))
}

/// Quote a string as a single shell argument (safe for arbitrary paths).
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Return true when `dst` is `src` itself or is nested below it.
/// This avoids commands such as `cp -r /a /a/b`, which can recursively copy a
/// directory into itself until the disk fills. Paths from SFTP are Unix paths.
fn is_same_or_descendant(src: &str, dst: &str) -> bool {
    let normalized_src = if src == "/" {
        "/"
    } else {
        src.trim_end_matches('/')
    };
    let normalized_dst = if dst == "/" {
        "/"
    } else {
        dst.trim_end_matches('/')
    };

    normalized_dst == normalized_src
        || (normalized_src == "/" && normalized_dst.starts_with('/'))
        || normalized_dst
            .strip_prefix(normalized_src)
            .is_some_and(|rest| rest.starts_with('/'))
}

impl SearchEngine {
    fn command_name(self) -> &'static str {
        match self {
            Self::Find => "find",
            Self::Fd => "fd",
        }
    }

    fn availability_probe(self) -> &'static str {
        match self {
            Self::Find => {
                "if command -v find >/dev/null 2>&1; then printf 'find\\n'; fi"
            }
            Self::Fd => "if command -v fd >/dev/null 2>&1; then printf 'fd\\n'; elif command -v fdfind >/dev/null 2>&1; then printf 'fdfind\\n'; fi",
        }
    }
}

fn parse_search_tool_check(engine: SearchEngine, output: &str) -> SearchToolCheck {
    let command = output.lines().find_map(|line| match (engine, line.trim()) {
        (SearchEngine::Find, "find") => Some("find".to_string()),
        (SearchEngine::Fd, "fd") => Some("fd".to_string()),
        (SearchEngine::Fd, "fdfind") => Some("fdfind".to_string()),
        _ => None,
    });
    SearchToolCheck {
        available: command.is_some(),
        command,
    }
}

/// Escape characters that `find -iname` treats specially so the UI always
/// performs a literal filename-substring search, not an accidental glob.
fn escape_find_pattern(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for character in query.chars() {
        if matches!(character, '\\' | '*' | '?' | '[') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn build_search_command(
    root: &str,
    query: &str,
    engine: SearchEngine,
    include_hidden: bool,
) -> String {
    let root = shell_quote(root);
    match engine {
        SearchEngine::Find => {
            let pattern = shell_quote(&format!("*{}*", escape_find_pattern(query)));
            let find = if include_hidden {
                format!("find {root} -mindepth 1 -iname {pattern} -print0")
            } else {
                format!(
                    "find {root} -mindepth 1 \\( -name '.*' -prune \\) -o \\( -iname {pattern} -print0 \\)"
                )
            };
            format!(
                "if command -v find >/dev/null 2>&1; then {find}; else exit 127; fi 2>/dev/null"
            )
        }
        SearchEngine::Fd => {
            let hidden = if include_hidden { " --hidden" } else { "" };
            let args = format!(
                "--color never --absolute-path --print0 --fixed-strings --ignore-case --no-ignore --max-results 501{hidden} -- {} {root}",
                shell_quote(query)
            );
            format!(
                "if command -v fd >/dev/null 2>&1; then fd {args}; elif command -v fdfind >/dev/null 2>&1; then fdfind {args}; else exit 127; fi 2>/dev/null"
            )
        }
    }
}

/// Execute a NUL-delimited path search and stop reading after one result past
/// the UI limit. NUL framing keeps newlines and other legal filename bytes from
/// being reinterpreted as injected paths.
fn exec_search_paths(
    session: &Session,
    command: &str,
    engine: SearchEngine,
) -> Result<(Vec<String>, bool), String> {
    let mut channel = session
        .channel_session()
        .map_err(|_| error::code("errors.searchFailed"))?;
    channel
        .exec(command)
        .map_err(|_| error::code("errors.searchFailed"))?;

    let mut paths = Vec::new();
    let mut pending = Vec::new();
    let mut buffer = [0u8; 32 * 1024];
    let mut truncated = false;

    'read: loop {
        let count = channel
            .read(&mut buffer)
            .map_err(|_| error::code("errors.searchFailed"))?;
        if count == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..count]);

        let mut consumed = 0;
        while let Some(end) = pending[consumed..].iter().position(|byte| *byte == 0) {
            let end = consumed + end;
            if end > consumed {
                paths.push(String::from_utf8_lossy(&pending[consumed..end]).into_owned());
                if paths.len() > MAX_SEARCH_RESULTS {
                    paths.pop();
                    truncated = true;
                    let _ = channel.close();
                    break 'read;
                }
            }
            consumed = end + 1;
        }
        if consumed > 0 {
            pending.drain(..consumed);
        }
        if pending.len() > MAX_SEARCH_PATH_BYTES {
            let _ = channel.close();
            return Err(error::code("errors.searchFailed"));
        }
    }

    if truncated {
        return Ok((paths, true));
    }

    let mut stderr = Vec::new();
    let _ = channel.stderr().read_to_end(&mut stderr);
    let _ = channel.wait_close();
    match channel.exit_status() {
        Ok(0) => Ok((paths, false)),
        Ok(127) => Err(error::with_detail(
            "errors.searchToolUnavailable",
            engine.command_name(),
        )),
        _ if !paths.is_empty() => Ok((paths, false)),
        _ => Err(error::code("errors.searchFailed")),
    }
}

fn unix_file_name(path: &str) -> Option<&str> {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
}

fn search_remote(
    session: &Session,
    sftp: &Sftp,
    root: &str,
    query: &str,
    engine: SearchEngine,
    include_hidden: bool,
) -> Result<SearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err(error::code("errors.searchQueryEmpty"));
    }
    if query.chars().count() > MAX_SEARCH_QUERY_CHARS {
        return Err(error::code("errors.searchQueryTooLong"));
    }

    let command = build_search_command(root, query, engine, include_hidden);
    let (paths, truncated) = exec_search_paths(session, &command, engine)?;
    let mut entries = Vec::with_capacity(paths.len());

    for path in paths {
        // The command is fixed and both arguments are quoted, but keep the
        // SFTP metadata pass inside the requested root as a second boundary.
        if path == root || !is_same_or_descendant(root, &path) {
            continue;
        }
        let Some(name) = unix_file_name(&path) else {
            continue;
        };
        let Ok(stat) = sftp.lstat(Path::new(&path)) else {
            continue;
        };
        let permissions = stat.perm.unwrap_or(0);
        entries.push(FileEntry {
            name: name.to_string(),
            path,
            size: stat.size.unwrap_or(0),
            is_dir: stat.is_dir(),
            is_symlink: (permissions & 0o170000) == 0o120000,
            modified: stat.mtime,
            permissions: format_permissions(permissions),
        });
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(SearchResult { entries, truncated })
}

/// Copy a file or directory on the server using `cp -r` over an exec channel.
/// The copy happens entirely server-side (no data round-trips through us).
fn exec_copy(session: &Session, src: &str, dst: &str) -> Result<(), String> {
    if is_same_or_descendant(src, dst) {
        return Err(error::code("errors.copyIntoSelf"));
    }
    let mut channel = session
        .channel_session()
        .map_err(|_| error::sftp_error("copy"))?;
    let cmd = format!("cp -r -- {} {}", shell_quote(src), shell_quote(dst));
    channel.exec(&cmd).map_err(|_| error::sftp_error("copy"))?;

    // Drain stdout/stderr so the remote command can finish.
    let mut out = String::new();
    let _ = channel.read_to_string(&mut out);
    let mut err = String::new();
    let _ = channel.stderr().read_to_string(&mut err);
    let _ = channel.wait_close();

    match channel.exit_status() {
        Ok(0) => Ok(()),
        _ => Err(error::code("errors.copy")),
    }
}

/// Run one command over a short-lived exec channel and return its stdout.
///
/// Same one-shot exec-channel technique as [`exec_copy`], but the output is
/// captured for a dashboard widget to parse. On a non-zero exit we still return
/// stdout if the command produced any (many tools print useful data and exit
/// non-zero); only a truly empty failure surfaces an error so the widget can
/// show an inline message. A dead connection is detected by the caller's
/// `send_and_check`.
fn exec_capture(session: &Session, command: &str) -> Result<String, String> {
    let mut channel = session
        .channel_session()
        .map_err(|_| error::command_failed())?;
    channel.exec(command).map_err(|_| error::command_failed())?;

    let mut out = String::new();
    let _ = channel.read_to_string(&mut out);
    let mut err = String::new();
    let _ = channel.stderr().read_to_string(&mut err);
    let _ = channel.wait_close();

    match channel.exit_status() {
        Ok(0) => Ok(out),
        _ if !out.trim().is_empty() => Ok(out),
        _ => Err(error::command_failed()),
    }
}

/// Open a new PTY shell channel on the existing session.
fn open_shell(session: &Session, cols: u16, rows: u16, setup: &str) -> Result<Channel, String> {
    let mut channel = session
        .channel_session()
        .map_err(|_| error::code("errors.terminalOpen"))?;
    let mut pty_modes = PtyModes::new();
    pty_modes.set_boolean(PtyModeOpcode::ECHO, false);
    channel
        .request_pty(
            "xterm-256color",
            Some(pty_modes),
            Some((cols as u32, rows as u32, 0, 0)),
        )
        .map_err(|_| error::code("errors.terminalPrepare"))?;
    channel
        .shell()
        .map_err(|_| error::code("errors.shellStart"))?;
    channel
        .write_all(setup.as_bytes())
        .map_err(|_| error::code("errors.terminalInit"))?;
    Ok(channel)
}

/// Handle one worker request. The worker uses blocking mode for every request
/// except `WriteTerminal`, which only appends to the non-blocking input queue.
/// Returns `true` when the worker should stop (disconnect or dropped link).
fn handle_req(
    req: Req,
    session: &Session,
    sftp: &Sftp,
    app: &AppHandle,
    terminals: &mut HashMap<String, Channel>,
    macros: &mut HashMap<String, Channel>,
    pending_terminal_inputs: &mut PendingTerminalInputs,
) -> bool {
    let terminal_channels = terminals.len();
    let macro_channels = macros.len();

    match req {
        Req::Canonicalize { path, resp } => {
            let result = sftp
                .realpath(Path::new(&path))
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|_| error::sftp_error("pathCheck"));
            send_and_check(
                sftp,
                app,
                "canonicalize",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::ListDir { path, resp } => send_and_check(
            sftp,
            app,
            "list_dir",
            terminal_channels,
            macro_channels,
            read_dir_entries(sftp, &path),
            resp,
        ),
        Req::Search {
            root,
            query,
            engine,
            include_hidden,
            resp,
        } => {
            let result = search_remote(session, sftp, &root, &query, engine, include_hidden);
            send_and_check(
                sftp,
                app,
                "search",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::Download {
            id,
            remote_path,
            local_path,
            is_dir,
            resp,
        } => {
            let result = download_path(sftp, app, &id, &remote_path, &local_path, is_dir);
            send_and_check(
                sftp,
                app,
                "download",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::Upload {
            id,
            local_path,
            remote_path,
            resp,
        } => {
            let result = upload_path(sftp, app, &id, &local_path, &remote_path);
            send_and_check(
                sftp,
                app,
                "upload",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::Rename { from, to, resp } => {
            let result = sftp
                .rename(Path::new(&from), Path::new(&to), None)
                .map_err(|_| error::sftp_error("rename"));
            send_and_check(
                sftp,
                app,
                "rename",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::Mkdir { path, resp } => {
            let result = sftp
                .mkdir(Path::new(&path), 0o755)
                .map_err(|_| error::sftp_error("folderCreate"));
            send_and_check(
                sftp,
                app,
                "mkdir",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::CreateFile { path, resp } => {
            let result = create_empty_file(sftp, &path);
            send_and_check(
                sftp,
                app,
                "create_file",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::Delete { path, is_dir, resp } => {
            let result = if is_dir {
                remove_recursive(sftp, &path)
            } else {
                sftp.unlink(Path::new(&path))
                    .map_err(|_| error::sftp_error("fileDelete"))
            };
            send_and_check(
                sftp,
                app,
                "delete",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::Copy { src, dst, resp } => {
            let result = exec_copy(session, &src, &dst);
            send_and_check(
                sftp,
                app,
                "copy",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::RunOnce { command, resp } => {
            let result = exec_capture(session, &command);
            send_and_check(
                sftp,
                app,
                "run_once",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::ReadFile { path, resp } => send_and_check(
            sftp,
            app,
            "read_file",
            terminal_channels,
            macro_channels,
            read_file_contents(sftp, &path),
            resp,
        ),
        Req::WriteFile {
            path,
            contents,
            encoding,
            resp,
        } => {
            let result = write_file_contents(sftp, &path, &contents, &encoding);
            send_and_check(
                sftp,
                app,
                "write_file",
                terminal_channels,
                macro_channels,
                result,
                resp,
            )
        }
        Req::OpenTerminal {
            id,
            cols,
            rows,
            setup,
            resp,
        } => {
            match open_shell(session, cols, rows, &setup) {
                Ok(channel) => {
                    pending_terminal_inputs.remove(&id);
                    terminals.insert(id, channel);
                    let _ = resp.send(Ok(()));
                }
                Err(msg) => {
                    let _ = resp.send(Err(msg));
                }
            }
            false
        }
        Req::WriteTerminal { id, data } => {
            if terminals.contains_key(&id) {
                pending_terminal_inputs
                    .entry(id)
                    .or_default()
                    .push_back(PendingTerminalInput { data, written: 0 });
            }
            false
        }
        Req::ResizeTerminal { id, cols, rows } => {
            if let Some(ch) = terminals.get_mut(&id) {
                let _ = ch.request_pty_size(cols as u32, rows as u32, None, None);
            }
            false
        }
        Req::CloseTerminal { id } => {
            pending_terminal_inputs.remove(&id);
            if let Some(mut ch) = terminals.remove(&id) {
                let _ = ch.close();
            }
            false
        }
        Req::RunMacro {
            run_id,
            script,
            resp,
        } => {
            match open_exec(session, &script) {
                Ok(channel) => {
                    macros.insert(run_id, channel);
                    let _ = resp.send(Ok(()));
                }
                Err(msg) => {
                    let _ = resp.send(Err(msg));
                }
            }
            false
        }
        Req::StopMacro { run_id } => {
            if let Some(mut ch) = macros.remove(&run_id) {
                let _ = ch.close();
            }
            // The run is over (stopped); tell the frontend so it can finalize.
            let _ = app.emit("macro-closed", MacroClosed { run_id });
            false
        }
        Req::Disconnect => {
            diagnostics::record(app, "INFO", "connection_disconnect_requested", &[]);
            true
        }
    }
}

/// Dispatch one worker request without toggling the whole libssh2 session for
/// keystrokes. Terminal input only enters a queue; operations that actually use
/// SFTP or a channel synchronously still run in blocking mode.
fn dispatch_worker_req(
    req: Req,
    session: &Session,
    sftp: &Sftp,
    app: &AppHandle,
    terminals: &mut HashMap<String, Channel>,
    macros: &mut HashMap<String, Channel>,
    pending_terminal_inputs: &mut PendingTerminalInputs,
) -> bool {
    let queued_terminal_input = matches!(&req, Req::WriteTerminal { .. });
    if !queued_terminal_input {
        session.set_blocking(true);
    }

    let should_stop = handle_req(
        req,
        session,
        sftp,
        app,
        terminals,
        macros,
        pending_terminal_inputs,
    );

    if !queued_terminal_input && !should_stop {
        session.set_blocking(false);
    }
    should_stop
}

/// Advance one terminal's queued input while the session remains non-blocking.
/// `false` means either the queue drained or libssh2 asked us to retry later;
/// `true` means a real channel error occurred and the caller should close/probe.
fn drain_terminal_input(
    channel: &mut Channel,
    queue: &mut std::collections::VecDeque<PendingTerminalInput>,
) -> bool {
    loop {
        let Some(input) = queue.front_mut() else {
            return false;
        };

        if input.written < input.data.len() {
            match channel.write(&input.data[input.written..]) {
                Ok(0) => return false,
                Ok(written) => {
                    input.written += written;
                    continue;
                }
                Err(ref write_error) if write_error.kind() == io::ErrorKind::WouldBlock => {
                    return false;
                }
                Err(_) => return true,
            }
        }

        // `ssh2::Channel::flush()` maps to libssh2_channel_flush_ex(), which
        // discards buffered incoming channel data; it is not an output flush.
        // A successful channel write has already handed these bytes to libssh2.
        queue.pop_front();
    }
}

/// Read whatever a channel currently has buffered (non-blocking), batching it
/// into one `acc`. Returns `(bytes, closed)` — `closed` is true if the channel
/// reached EOF / errored. Shared by terminal polling and macro-run polling so
/// both use the exact same non-blocking read-and-batch mechanism.
fn drain_channel(
    app: &AppHandle,
    channel_kind: &'static str,
    channel: &mut Channel,
    buf: &mut [u8],
) -> (Vec<u8>, bool) {
    let mut acc: Vec<u8> = Vec::new();
    let mut closed = false;
    loop {
        match channel.read(buf) {
            Ok(0) => {
                diagnostics::record(
                    app,
                    "INFO",
                    "channel_ended",
                    &[
                        ("channel_kind", channel_kind.to_owned()),
                        ("reason", "eof".to_owned()),
                    ],
                );
                closed = true;
                break;
            }
            Ok(n) => {
                acc.extend_from_slice(&buf[..n]);
                // Bound per-cycle work so one gushing channel can't starve others.
                if acc.len() >= 256 * 1024 {
                    break;
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break,
            Err(read_error) => {
                diagnostics::record(
                    app,
                    "WARN",
                    "channel_read_failed",
                    &[
                        ("channel_kind", channel_kind.to_owned()),
                        ("io_error_kind", format!("{:?}", read_error.kind())),
                        ("error_message", read_error.to_string()),
                    ],
                );
                closed = true;
                break;
            }
        }
    }
    (acc, closed)
}

/// How long the worker may sleep before it must service streaming channels or
/// send the next SSH keepalive. An idle worker still wakes for keepalives, while
/// a live terminal/macro keeps the existing fast polling cadence.
fn worker_wait_timeout(has_streaming_channels: bool, until_keepalive: Duration) -> Duration {
    if has_streaming_channels {
        TERMINAL_POLL.min(until_keepalive)
    } else {
        until_keepalive
    }
}

/// Wrap a macro's step-sentinel script so it runs backgrounded under `setsid`
/// (making the backgrounded shell its own process group leader, so its PID
/// doubles as its process group id), with that PID reported back as a sentinel
/// line before any step output begins.
///
/// This matters for Stop: a plain exec channel has no PTY/line-discipline to
/// turn a client-side interrupt into SIGINT, so closing the channel alone does
/// not signal the remote process — the frontend instead sends an explicit
/// `kill -TERM -<pid>` (process-GROUP target, so children a step spawns are
/// signaled too, not just the orphaned parent shell) through a one-shot exec,
/// the same mechanism already used for dashboard widget polling and the
/// process manager's kill action. Pure (no I/O) so it's directly testable.
fn wrap_macro_script(script: &str) -> String {
    format!(
        "setsid bash -c {} &\nMACRO_PID=$!\necho \"___SSHLAND_PID___${{MACRO_PID}}___\"\nwait \"$MACRO_PID\"\n",
        shell_quote(script)
    )
}

/// Open a non-PTY exec channel running `script`, for a macro run. Unlike a
/// terminal this is headless (no `request_pty`/`shell`) — the whole script is
/// exec'd at once (wrapped via [`wrap_macro_script`]) and its output streamed
/// back via polling.
fn open_exec(session: &Session, script: &str) -> Result<Channel, String> {
    let wrapped = wrap_macro_script(script);
    let mut channel = session
        .channel_session()
        .map_err(|_| error::macro_run_failed())?;
    channel
        .exec(&wrapped)
        .map_err(|_| error::macro_run_failed())?;
    Ok(channel)
}

/// The worker thread body: owns the session, SFTP handle, and all terminal
/// channels. Multiplexes file operations and interactive shells over the single
/// connection, since libssh2 requires all session access from one thread.
fn worker_loop(session: Session, cmd_rx: mpsc::Receiver<Req>, app: AppHandle) {
    // Open the SFTP subsystem once and reuse it for every request.
    let sftp = match session.sftp() {
        Ok(sftp) => sftp,
        Err(sftp_error) => {
            diagnostics::record(
                &app,
                "ERROR",
                "connection_worker_start_failed",
                &[
                    ("error_code", ssh_error_code(&sftp_error)),
                    ("error_message", sftp_error.message().to_owned()),
                ],
            );
            // Couldn't start SFTP: fail every queued request so callers unblock.
            while let Ok(req) = cmd_rx.recv() {
                if !reply_err(req, error::sftp_error("fileOperation")) {
                    break;
                }
            }
            return;
        }
    };

    let mut terminals: HashMap<String, Channel> = HashMap::new();
    // Streaming exec channels for in-flight macro runs (keyed by run id). Polled
    // with the same non-blocking read-and-batch mechanism as terminals.
    let mut macros: HashMap<String, Channel> = HashMap::new();
    let mut pending_terminal_inputs: PendingTerminalInputs = HashMap::new();
    let mut buf = [0u8; TERM_BUF];
    let mut next_keepalive = Instant::now() + KEEPALIVE_INTERVAL;

    // Streaming I/O stays non-blocking between worker requests. Previously the
    // session flipped mode twice every 15 ms; libssh2 could then be interrupted
    // between EAGAIN-driven channel state-machine calls by a blocking write.
    session.set_blocking(false);

    'outer: loop {
        // 1. Handle every command that's already queued. Keystrokes only enter
        //    the non-blocking input queue; synchronous file/control operations
        //    temporarily switch the session to blocking mode.
        loop {
            match cmd_rx.try_recv() {
                Ok(req) => {
                    if dispatch_worker_req(
                        req,
                        &session,
                        &sftp,
                        &app,
                        &mut terminals,
                        &mut macros,
                        &mut pending_terminal_inputs,
                    ) {
                        break 'outer;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => break 'outer,
            }
        }

        // 2. Advance queued terminal writes, then poll terminal/macro output.
        //    All streaming operations remain in the same non-blocking mode.
        if !terminals.is_empty() || !macros.is_empty() {
            let mut closed_terms: Vec<String> = Vec::new();
            for (id, queue) in pending_terminal_inputs.iter_mut() {
                let failed = terminals
                    .get_mut(id)
                    .is_some_and(|channel| drain_terminal_input(channel, queue));
                if failed {
                    closed_terms.push(id.clone());
                }
            }
            pending_terminal_inputs.retain(|_, queue| !queue.is_empty());

            for (id, channel) in terminals.iter_mut() {
                if closed_terms.contains(id) {
                    continue;
                }
                let (data, closed) = drain_channel(&app, "terminal", channel, &mut buf);
                if !data.is_empty() {
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutput {
                            id: id.clone(),
                            data,
                        },
                    );
                }
                if closed {
                    closed_terms.push(id.clone());
                }
            }

            let mut closed_macros: Vec<String> = Vec::new();
            for (run_id, channel) in macros.iter_mut() {
                let (data, closed) = drain_channel(&app, "macro", channel, &mut buf);
                if !data.is_empty() {
                    let _ = app.emit(
                        "macro-output",
                        MacroOutput {
                            run_id: run_id.clone(),
                            data,
                        },
                    );
                }
                if closed {
                    closed_macros.push(run_id.clone());
                }
            }

            // EOF can mean a normal shell exit, but it is also how libssh2 may
            // surface a dead transport. Probe immediately so a dropped SSH
            // connection is not left looking like only one terminal ended until
            // the user happens to perform a later SFTP operation.
            if !closed_terms.is_empty() || !closed_macros.is_empty() {
                session.set_blocking(true);
                if let Err(probe_error) = sftp.realpath(Path::new(".")) {
                    record_connection_lost(
                        &app,
                        "channel_closed_probe_failed",
                        "channel_poll",
                        &probe_error,
                        None,
                        terminals.len(),
                        macros.len(),
                    );
                    let _ = app.emit("connection-lost", ());
                    break 'outer;
                }
                session.set_blocking(false);
            }

            for id in closed_terms {
                pending_terminal_inputs.remove(&id);
                terminals.remove(&id);
                let _ = app.emit("terminal-closed", id);
            }
            for run_id in closed_macros {
                macros.remove(&run_id);
                let _ = app.emit("macro-closed", MacroClosed { run_id });
            }
        }

        // 3. Actually send SSH keepalives. `set_keepalive` above only stores the
        //    policy in libssh2; without this call an otherwise idle connection
        //    can still be reaped by the server, NAT, VPN, or firewall.
        if Instant::now() >= next_keepalive {
            session.set_blocking(true);
            match session.keepalive_send() {
                Ok(seconds_to_next) => {
                    // libssh2 reports when it needs to be called again. Clamp a
                    // zero result to avoid a busy loop on unusual servers.
                    next_keepalive =
                        Instant::now() + Duration::from_secs(u64::from(seconds_to_next.max(1)));
                }
                Err(keepalive_error) => {
                    // Avoid declaring a disconnect for a keepalive-specific
                    // failure if a real SFTP round-trip still succeeds.
                    if let Err(probe_error) = sftp.realpath(Path::new(".")) {
                        record_connection_lost(
                            &app,
                            "keepalive_probe_failed",
                            "keepalive",
                            &probe_error,
                            Some(&keepalive_error),
                            terminals.len(),
                            macros.len(),
                        );
                        let _ = app.emit("connection-lost", ());
                        break 'outer;
                    }
                    next_keepalive = Instant::now() + KEEPALIVE_INTERVAL;
                }
            }
            session.set_blocking(false);
        }

        // 4. Wait for the next request, terminal poll, or keepalive deadline.
        // Idle connections wake only for a keepalive, so CPU usage remains
        // effectively zero without leaving the transport completely silent.
        let has_streaming_channels = !terminals.is_empty() || !macros.is_empty();
        let until_keepalive = next_keepalive.saturating_duration_since(Instant::now());
        let wait = worker_wait_timeout(has_streaming_channels, until_keepalive);
        match cmd_rx.recv_timeout(wait) {
            Ok(req) => {
                if dispatch_worker_req(
                    req,
                    &session,
                    &sftp,
                    &app,
                    &mut terminals,
                    &mut macros,
                    &mut pending_terminal_inputs,
                ) {
                    break 'outer;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break 'outer,
        }
    }

    // Close all terminal + macro channels, then the session.
    session.set_blocking(true);
    for (_, mut ch) in terminals.drain() {
        let _ = ch.close();
    }
    for (_, mut ch) in macros.drain() {
        let _ = ch.close();
    }
    let _ = session.disconnect(None, "bye", None);
}

/// Connect to a server and return the starting directory.
#[tauri::command]
pub async fn connect(
    state: State<'_, SessionManager>,
    app: AppHandle,
    params: ConnectParams,
) -> Result<ConnectResult, ConnectError> {
    // Drop any previous session first.
    if let Some(old) = state.tx.lock().unwrap().take() {
        let _ = old.send(Req::Disconnect);
    }

    let hosts_path = known_hosts_path(&app)?;

    // The handshake blocks, so run it off the async runtime's threads.
    let session =
        tauri::async_runtime::spawn_blocking(move || establish_session(params, hosts_path))
            .await
            .map_err(|_| ConnectError::from(error::code("errors.internal")))??;

    // Hand the session to a dedicated worker thread.
    let (tx, rx) = mpsc::channel();
    let worker_app = app.clone();
    std::thread::spawn(move || worker_loop(session, rx, worker_app));
    *state.tx.lock().unwrap() = Some(tx);

    // Resolve the home directory as a first real SFTP round-trip.
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Canonicalize {
        path: ".".to_string(),
        resp: resp_tx,
    })?;
    let home = resp_rx.await.map_err(|_| error::disconnected_error())??;

    diagnostics::record(
        &app,
        "INFO",
        "connection_established",
        &[(
            "keepalive_interval_seconds",
            KEEPALIVE_INTERVAL_SECS.to_string(),
        )],
    );

    Ok(ConnectResult { home })
}

fn forget_host_key_in_file(path: &Path, host: &str, port: u16) -> Result<(), String> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => return Err(error::code("errors.knownHostsRead")),
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(error::code("errors.knownHostsRead")),
    }

    let session = Session::new().map_err(|_| error::code("errors.sessionCreate"))?;
    let mut known_hosts = session
        .known_hosts()
        .map_err(|_| error::code("errors.knownHostsRead"))?;
    known_hosts
        .read_file(path, KnownHostFileKind::OpenSSH)
        .map_err(|_| error::code("errors.knownHostsRead"))?;

    let target = known_host_name(host, port);
    let entries = known_hosts
        .hosts()
        .map_err(|_| error::code("errors.knownHostsRead"))?;
    for entry in entries {
        if entry.name() == Some(target.as_str()) {
            known_hosts
                .remove(&entry)
                .map_err(|_| error::code("errors.knownHostsWrite"))?;
        }
    }
    known_hosts
        .write_file(path, KnownHostFileKind::OpenSSH)
        .map_err(|_| error::code("errors.knownHostsWrite"))?;
    Ok(())
}

/// Remove the saved key for one host. A later connection is still blocked as
/// unknown until the user explicitly reviews and accepts the fresh fingerprint.
#[tauri::command]
pub fn forget_host_key(app: AppHandle, host: String, port: u16) -> Result<(), String> {
    let path = known_hosts_path(&app)?;
    forget_host_key_in_file(&path, &host, port)
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

/// Check one optional recursive-search command when its settings option is
/// clicked. Keeping this out of connection setup avoids an unnecessary shell
/// round-trip for users who only need the built-in current-folder filter.
#[tauri::command]
pub async fn check_search_tool(
    state: State<'_, SessionManager>,
    engine: SearchEngine,
) -> Result<SearchToolCheck, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::RunOnce {
        command: engine.availability_probe().to_string(),
        resp: resp_tx,
    })?;
    let output = resp_rx.await.map_err(|_| error::disconnected_error())??;
    Ok(parse_search_tool_check(engine, &output))
}

/// Recursively search below `root` using a server-side search command.
#[tauri::command]
pub async fn search_files(
    state: State<'_, SessionManager>,
    root: String,
    query: String,
    engine: SearchEngine,
    include_hidden: bool,
) -> Result<SearchResult, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Search {
        root,
        query,
        engine,
        include_hidden,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Download a remote file or folder to a chosen local path.
#[tauri::command]
pub async fn download(
    state: State<'_, SessionManager>,
    id: String,
    remote_path: String,
    local_path: String,
    is_dir: bool,
    local_name: Option<String>,
) -> Result<(), String> {
    // A native save dialog supplies a complete trusted local path. Batch and
    // folder downloads instead supply a chosen directory plus an untrusted
    // remote name, which must be joined here with platform-aware validation.
    let local_path = match local_name {
        Some(name) => safe_local_child(Path::new(&local_path), &name)?,
        None => PathBuf::from(local_path),
    };
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Download {
        id,
        remote_path,
        local_path,
        is_dir,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Upload a local file or folder to a directory on the server.
#[tauri::command]
pub async fn upload(
    state: State<'_, SessionManager>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<UploadResult, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Upload {
        id,
        local_path,
        remote_path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Rename (or move) a remote entry.
#[tauri::command]
pub async fn rename(
    state: State<'_, SessionManager>,
    from: String,
    to: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Rename {
        from,
        to,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Create a new directory.
#[tauri::command]
pub async fn mkdir(state: State<'_, SessionManager>, path: String) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Mkdir {
        path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Create a new, empty file (fails if one already exists at the path).
#[tauri::command]
pub async fn create_file(state: State<'_, SessionManager>, path: String) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::CreateFile {
        path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Delete a file, or a directory and everything inside it.
#[tauri::command]
pub async fn delete(
    state: State<'_, SessionManager>,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Delete {
        path,
        is_dir,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Open a new PTY shell (terminal) on the existing connection.
#[tauri::command]
pub async fn open_terminal(
    state: State<'_, SessionManager>,
    id: String,
    cols: u16,
    rows: u16,
    setup: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::OpenTerminal {
        id,
        cols,
        rows,
        setup,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Send input (keystrokes) to a terminal.
#[tauri::command]
pub async fn write_terminal(
    state: State<'_, SessionManager>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.send(Req::WriteTerminal { id, data })
}

/// Notify a terminal's shell that its window size changed.
#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, SessionManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.send(Req::ResizeTerminal { id, cols, rows })
}

/// Close a terminal, leaving the SSH connection open.
#[tauri::command]
pub async fn close_terminal(state: State<'_, SessionManager>, id: String) -> Result<(), String> {
    state.send(Req::CloseTerminal { id })
}

/// Copy a file or directory to a new path on the server.
#[tauri::command]
pub async fn copy(
    state: State<'_, SessionManager>,
    src: String,
    dst: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Copy {
        src,
        dst,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Run a single command over a one-shot exec channel and return its stdout.
/// Used by dashboard widgets (polling on a timer) and the process-manager kill
/// action. Shares the existing worker thread — no dedicated channel.
#[tauri::command]
pub async fn poll_widget_command(
    state: State<'_, SessionManager>,
    command: String,
) -> Result<String, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::RunOnce {
        command,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Run a macro: exec the pre-assembled `script` over one non-PTY channel and
/// stream its output back via `macro-output` events keyed by `run_id`. Resolves
/// once the channel is open; per-step progress is derived from the stream.
#[tauri::command]
pub async fn run_macro(
    state: State<'_, SessionManager>,
    run_id: String,
    script: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::RunMacro {
        run_id,
        script,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Stop a running macro by closing its exec channel (ends the remote script).
/// Fire-and-forget: a `macro-closed` event confirms it ended.
#[tauri::command]
pub async fn stop_macro(state: State<'_, SessionManager>, run_id: String) -> Result<(), String> {
    state.send(Req::StopMacro { run_id })
}

/// Read a remote text file's contents (for the editor pane).
#[tauri::command]
pub async fn read_remote_file(
    state: State<'_, SessionManager>,
    path: String,
) -> Result<FileContent, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::ReadFile {
        path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Overwrite a remote file with new text (from the editor pane), re-encoding to
/// the file's original `encoding`.
#[tauri::command]
pub async fn write_remote_file(
    state: State<'_, SessionManager>,
    path: String,
    contents: String,
    encoding: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::WriteFile {
        path,
        contents,
        encoding,
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

    struct LocalUploadFixture {
        path: PathBuf,
    }

    impl LocalUploadFixture {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "sshland-upload-plan-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("should create upload-plan fixture");
            Self { path }
        }
    }

    impl Drop for LocalUploadFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn folder_upload_plan_keeps_nested_and_empty_directories() {
        let fixture = LocalUploadFixture::new();
        let root = fixture.path.join("project");
        fs::create_dir_all(root.join("nested")).expect("should create nested folder");
        fs::create_dir(root.join("empty")).expect("should create empty folder");
        fs::write(root.join("a.txt"), b"abc").expect("should write first file");
        fs::write(root.join("nested").join("b.bin"), b"12345").expect("should write nested file");

        let plan = build_upload_plan(&root, "/srv/project").expect("plan should build");
        assert!(plan.is_dir);
        assert_eq!(plan.total_bytes, 8);

        let mut directories = Vec::new();
        let mut files = Vec::new();
        for entry in plan.entries {
            match entry {
                UploadPlanEntry::Directory { remote_path } => directories.push(remote_path),
                UploadPlanEntry::File { remote_path, .. } => files.push(remote_path),
            }
        }
        assert_eq!(
            directories,
            ["/srv/project", "/srv/project/empty", "/srv/project/nested"]
        );
        assert_eq!(files, ["/srv/project/a.txt", "/srv/project/nested/b.bin"]);
    }

    #[test]
    fn single_file_upload_plan_stays_a_single_file() {
        let fixture = LocalUploadFixture::new();
        let file = fixture.path.join("hello.txt");
        fs::write(&file, b"hello").expect("should write file");

        let plan = build_upload_plan(&file, "/srv/hello.txt").expect("plan should build");
        assert!(!plan.is_dir);
        assert_eq!(plan.total_bytes, 5);
        assert_eq!(plan.entries.len(), 1);
        assert!(matches!(plan.entries[0], UploadPlanEntry::File { .. }));
    }

    #[test]
    fn downloaded_child_names_cannot_escape_the_destination() {
        let base = Path::new("download-root");
        assert_eq!(
            safe_local_child(base, "notes.txt").expect("plain filename"),
            base.join("notes.txt")
        );
        assert!(safe_local_child(base, "..").is_err());
        assert!(safe_local_child(base, "nested/file.txt").is_err());

        #[cfg(target_os = "windows")]
        {
            assert!(safe_local_child(base, r"nested\file.txt").is_err());
            assert!(safe_local_child(base, r"C:\outside.txt").is_err());
        }
    }

    #[test]
    fn utf8_text_decodes_as_utf8() {
        let fc = decode_text("안녕하세요 hello".as_bytes()).expect("utf-8 text");
        assert_eq!(fc.content, "안녕하세요 hello");
        assert_eq!(fc.encoding, "UTF-8");
    }

    #[test]
    fn null_byte_is_binary() {
        assert!(decode_text(b"abc\0def").is_err());
    }

    #[test]
    fn euc_kr_round_trips() {
        // A longer Korean sample so detection is reliable.
        let text = "안녕하세요. 이것은 한국어로 작성된 설정 파일입니다. \
                    서버 설정을 여기에 저장합니다. 인코딩 테스트 문장입니다.";
        let (euc_bytes, _, had_errors) = encoding_rs::EUC_KR.encode(text);
        assert!(!had_errors, "sample should be EUC-KR-encodable");

        // Decode the non-UTF-8 bytes back to the original text.
        let fc = decode_text(&euc_bytes).expect("should decode");
        assert_eq!(fc.content, text);
        assert_ne!(fc.encoding, "UTF-8");

        // Re-encoding with the reported label reproduces the original bytes.
        let out = encode_text(&fc.content, &fc.encoding);
        assert_eq!(out, euc_bytes.to_vec());
    }

    #[test]
    fn utf8_save_is_verbatim() {
        assert_eq!(encode_text("hi 안녕", "UTF-8"), "hi 안녕".as_bytes());
    }

    #[test]
    fn wrap_macro_script_backgrounds_under_setsid_and_reports_pid() {
        let wrapped = wrap_macro_script("echo hi");
        assert!(wrapped.starts_with("setsid bash -c 'echo hi' &\n"));
        assert!(wrapped.contains("MACRO_PID=$!"));
        assert!(wrapped.contains("echo \"___SSHLAND_PID___${MACRO_PID}___\""));
        assert!(wrapped.contains("wait \"$MACRO_PID\""));
    }

    #[test]
    fn wrap_macro_script_safely_quotes_a_script_containing_single_quotes() {
        // A macro step's command is user-authored and may contain single
        // quotes (e.g. `echo 'hello world'`); the wrapper must not let that
        // break out of its own `bash -c '...'` quoting.
        let script = "echo 'hello world'\ncd /tmp";
        let wrapped = wrap_macro_script(script);
        // shell_quote's escaping: each ' becomes '\''
        assert!(wrapped.contains("'echo '\\''hello world'\\''\ncd /tmp' &"));
    }

    #[test]
    fn idle_worker_waits_only_until_the_next_keepalive() {
        let until_keepalive = Duration::from_secs(12);
        assert_eq!(worker_wait_timeout(false, until_keepalive), until_keepalive);
    }

    #[test]
    fn streaming_worker_keeps_the_fast_terminal_poll() {
        assert_eq!(
            worker_wait_timeout(true, Duration::from_secs(12)),
            TERMINAL_POLL
        );
        assert_eq!(
            worker_wait_timeout(true, Duration::from_millis(5)),
            Duration::from_millis(5)
        );
    }

    #[test]
    fn known_host_name_uses_openssh_port_syntax() {
        assert_eq!(known_host_name("server.local", 22), "server.local");
        assert_eq!(known_host_name("server.local", 2222), "[server.local]:2222");
        assert_eq!(known_host_name("::1", 2200), "[::1]:2200");
    }

    #[test]
    fn sha256_fingerprint_uses_openssh_base64_without_padding() {
        assert_eq!(format_sha256_fingerprint(&[0, 1, 255]), "SHA256:AAH/");
    }

    #[test]
    fn host_key_challenge_serializes_for_the_frontend() {
        let value = serde_json::to_value(host_key_error(
            false,
            "server.local",
            22,
            "ED25519",
            "SHA256:abc",
        ))
        .expect("challenge should serialize");
        assert_eq!(value["type"], "unknownHost");
        assert_eq!(value["host"], "server.local");
        assert_eq!(value["port"], 22);
        assert_eq!(value["algorithm"], "ED25519");
        assert_eq!(value["fingerprint"], "SHA256:abc");
    }

    #[test]
    fn approved_fingerprint_deserializes_from_frontend_camel_case() {
        let params: ConnectParams = serde_json::from_value(serde_json::json!({
            "host": "server.local",
            "port": 22,
            "username": "alice",
            "auth": { "type": "password", "password": "secret" },
            "acceptHostFingerprint": "SHA256:abc"
        }))
        .expect("frontend connection params should deserialize");
        assert_eq!(
            params.accept_host_fingerprint.as_deref(),
            Some("SHA256:abc")
        );
    }

    #[test]
    fn forgetting_one_host_key_keeps_other_entries() {
        let fixture = LocalUploadFixture::new();
        let path = fixture.path.join("known_hosts");
        let session = Session::new().expect("should create test session");
        let mut known_hosts = session.known_hosts().expect("should create known-host set");
        let first_key = b"first fake host key";
        let second_key = b"second fake host key";
        known_hosts
            .add(
                "server.local",
                first_key,
                "test",
                ssh2::KnownHostKeyFormat::SshRsa,
            )
            .expect("should add first key");
        known_hosts
            .add(
                "[other.local]:2222",
                second_key,
                "test",
                ssh2::KnownHostKeyFormat::SshRsa,
            )
            .expect("should add second key");
        known_hosts
            .write_file(&path, KnownHostFileKind::OpenSSH)
            .expect("should write fixture");

        forget_host_key_in_file(&path, "server.local", 22).expect("should forget one key");

        let verify_session = Session::new().expect("should create verification session");
        let mut verify = verify_session
            .known_hosts()
            .expect("should create verification set");
        verify
            .read_file(&path, KnownHostFileKind::OpenSSH)
            .expect("should read updated fixture");
        assert!(matches!(
            verify.check_port("server.local", 22, first_key),
            CheckResult::NotFound
        ));
        assert!(matches!(
            verify.check_port("other.local", 2222, second_key),
            CheckResult::Match
        ));
    }

    /// Smoke test against Rebex's public read-only SFTP test server.
    /// Ignored by default (needs network); run with:
    ///   cargo test -- --ignored connects_to_public_test_server
    #[test]
    #[ignore]
    fn connects_to_public_test_server() {
        let path =
            std::env::temp_dir().join(format!("sshland-known-hosts-test-{}", std::process::id()));
        let _ = fs::remove_file(&path);
        let params = |accepted: Option<String>| ConnectParams {
            host: "test.rebex.net".to_string(),
            port: 22,
            username: "demo".to_string(),
            auth: AuthMethod::Password {
                password: "password".to_string(),
            },
            accept_host_fingerprint: accepted,
        };

        let fingerprint = match establish_session(params(None), path.clone()) {
            Err(ConnectError::UnknownHost { fingerprint, .. }) => fingerprint,
            Err(other) => panic!("unexpected first-connection result: {other:?}"),
            Ok(_) => panic!("an unknown host must not authenticate"),
        };
        let session = establish_session(params(Some(fingerprint)), path.clone())
            .expect("approved fingerprint should authenticate");
        let sftp = session.sftp().expect("should open sftp");
        let home = sftp.realpath(Path::new(".")).expect("should resolve home");
        assert!(!home.to_string_lossy().is_empty());
        drop(sftp);
        drop(session);

        // Once saved, the same host key connects without another approval.
        let reconnect = establish_session(params(None), path.clone())
            .expect("saved fingerprint should match automatically");
        assert!(reconnect.authenticated());
        drop(reconnect);

        // A different key for the same host must be reported as a hard
        // mismatch, never silently replaced or allowed to authenticate.
        use base64::Engine as _;
        let line = fs::read_to_string(&path).expect("should read saved host key");
        let fields: Vec<_> = line.split_whitespace().collect();
        assert!(fields.len() >= 3, "known_hosts line should have key fields");
        let mut fake_key = base64::engine::general_purpose::STANDARD
            .decode(fields[2])
            .expect("saved host key should be base64");
        let last = fake_key.last_mut().expect("host key should not be empty");
        *last ^= 1;
        let corrupted = format!(
            "{} {} {} sshland\n",
            fields[0],
            fields[1],
            base64::engine::general_purpose::STANDARD.encode(fake_key)
        );
        fs::write(&path, corrupted).expect("should replace test host key");
        match establish_session(params(None), path.clone()) {
            Err(ConnectError::HostKeyChanged { .. }) => {}
            Err(other) => panic!("unexpected changed-key result: {other:?}"),
            Ok(_) => panic!("a changed host key must not authenticate"),
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn copy_destination_cannot_be_the_source_or_its_descendant() {
        assert!(is_same_or_descendant("/home/me/folder", "/home/me/folder"));
        assert!(is_same_or_descendant(
            "/home/me/folder/",
            "/home/me/folder/nested/copy"
        ));
        assert!(!is_same_or_descendant(
            "/home/me/folder",
            "/home/me/folder-copy"
        ));
        assert!(!is_same_or_descendant(
            "/home/me/folder",
            "/home/other/folder"
        ));
        assert!(is_same_or_descendant("/", "/home/me/folder"));
    }

    #[test]
    fn search_tool_probe_parser_accepts_only_the_requested_engine() {
        let fd = parse_search_tool_check(SearchEngine::Fd, "find\nfdfind\nunknown\n");
        assert!(fd.available);
        assert_eq!(fd.command.as_deref(), Some("fdfind"));

        let find = parse_search_tool_check(SearchEngine::Find, "fd\n");
        assert!(!find.available);
        assert_eq!(find.command, None);

        let json = serde_json::to_value(fd).expect("search tool result should serialize");
        assert_eq!(json["available"], true);
        assert_eq!(json["command"], "fdfind");
    }

    #[test]
    fn search_commands_use_literal_nul_delimited_results() {
        assert_eq!(
            escape_find_pattern(r"report*[draft]?\2026"),
            r"report\*\[draft]\?\\2026"
        );

        let find = build_search_command(
            "/srv/shared files",
            "quarterly report",
            SearchEngine::Find,
            false,
        );
        assert!(find.contains("find '/srv/shared files'"));
        assert!(find.contains("-name '.*' -prune"));
        assert!(find.contains("-print0"));

        let fd = build_search_command(
            "/srv/shared files",
            "quarterly report",
            SearchEngine::Fd,
            true,
        );
        assert!(fd.contains("--fixed-strings"));
        assert!(fd.contains("--print0"));
        assert!(fd.contains("--max-results 501"));
        assert!(fd.contains("--hidden"));
        assert!(fd.contains("fdfind"));
    }
}
