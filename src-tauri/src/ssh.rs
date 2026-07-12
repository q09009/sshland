//! SSH/SFTP session management.
//!
//! `ssh2` is a blocking library, so every session is owned by a dedicated
//! worker thread. Tauri commands (async) send [`Req`] messages to that thread
//! over a channel and await the reply on a oneshot channel. This keeps all
//! blocking network work off the UI thread and sidesteps `ssh2`'s borrow/`Send`
//! constraints (the `Session` and `Sftp` handles never leave the worker).

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ssh2::{Channel, Session, Sftp};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use crate::error;

/// How often the worker polls terminal channels for output while any are open.
const TERMINAL_POLL: Duration = Duration::from_millis(15);
/// Read buffer size for terminal output.
const TERM_BUF: usize = 32 * 1024;
/// Largest file the editor will open in-memory. Bigger files are refused so a
/// huge file can't exhaust memory or bog down CodeMirror; the frontend catches
/// this earlier via the listing size and offers a download instead.
const MAX_EDIT_SIZE: u64 = 5 * 1024 * 1024;

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

/// Progress update for an in-flight file transfer, streamed to the frontend
/// as a `transfer-progress` event.
#[derive(Serialize, Clone)]
struct TransferProgress {
    /// Frontend-supplied id identifying this transfer.
    id: String,
    transferred: u64,
    total: u64,
}

/// A chunk of terminal output, streamed as a `terminal-output` event.
#[derive(Serialize, Clone)]
struct TerminalOutput {
    /// Terminal (pane) id this output belongs to.
    id: String,
    /// Raw bytes from the shell; the frontend feeds these straight to xterm.js.
    data: Vec<u8>,
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
    /// Download a remote file to a local path, emitting progress events.
    Download {
        id: String,
        remote_path: String,
        local_path: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Upload a local file to a remote path, emitting progress events.
    Upload {
        id: String,
        local_path: String,
        remote_path: String,
        resp: oneshot::Sender<Result<(), String>>,
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
    /// Read a remote text file's whole contents into memory (for the editor).
    ReadFile {
        path: String,
        resp: oneshot::Sender<Result<String, String>>,
    },
    /// Overwrite a remote file with new text contents (from the editor).
    WriteFile {
        path: String,
        contents: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Open a new PTY shell channel on the existing connection.
    OpenTerminal {
        id: String,
        cols: u16,
        rows: u16,
        resp: oneshot::Sender<Result<(), String>>,
    },
    /// Send keystrokes/input to a terminal's shell (fire-and-forget).
    WriteTerminal { id: String, data: Vec<u8> },
    /// Tell the shell its window was resized (fire-and-forget).
    ResizeTerminal { id: String, cols: u16, rows: u16 },
    /// Close a terminal's channel, leaving the SSH connection intact.
    CloseTerminal { id: String },
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
        Req::Delete { resp, .. } => {
            let _ = resp.send(Err(msg));
            true
        }
        Req::Copy { resp, .. } => {
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
        // Fire-and-forget terminal messages have no reply channel.
        Req::WriteTerminal { .. } | Req::ResizeTerminal { .. } | Req::CloseTerminal { .. } => true,
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

/// Perform the blocking TCP + SSH handshake + authentication.
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

    // Enable keepalives so we can probe whether the link is still alive.
    session.set_keepalive(true, 30);
    Ok(session)
}

/// Send a request's result to its caller, detecting a dropped connection.
///
/// On error we probe the link with a cheap SFTP round-trip (`realpath`). If
/// that fails too, the connection is gone, so we notify the frontend and signal
/// the worker to stop. Returns `true` when the worker should break its loop.
fn send_and_check<T>(
    sftp: &Sftp,
    app: &AppHandle,
    result: Result<T, String>,
    resp: oneshot::Sender<Result<T, String>>,
) -> bool {
    match result {
        Ok(value) => {
            let _ = resp.send(Ok(value));
            false
        }
        Err(msg) => {
            if sftp.realpath(Path::new(".")).is_err() {
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
        .map_err(|_| error::sftp_error("폴더를 여는"))?;

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

/// Stream a remote file to disk, emitting throttled progress events.
fn download_file(
    sftp: &Sftp,
    app: &AppHandle,
    id: &str,
    remote: &str,
    local: &str,
) -> Result<(), String> {
    let mut remote_file = sftp
        .open(Path::new(remote))
        .map_err(|_| error::sftp_error("파일을 다운로드하는"))?;
    let total = remote_file.stat().ok().and_then(|s| s.size).unwrap_or(0);

    let mut local_file =
        File::create(local).map_err(|_| "파일을 저장할 수 없어요. 저장 위치를 확인해주세요.".to_string())?;

    let mut buf = [0u8; 32 * 1024];
    let mut transferred = 0u64;
    let mut last_emit = Instant::now();

    loop {
        let n = remote_file
            .read(&mut buf)
            .map_err(|_| error::sftp_error("파일을 다운로드하는"))?;
        if n == 0 {
            break;
        }
        local_file
            .write_all(&buf[..n])
            .map_err(|_| "파일을 저장하는 중 문제가 발생했어요.".to_string())?;
        transferred += n as u64;

        // Throttle progress events to ~10/sec.
        if last_emit.elapsed() >= Duration::from_millis(100) {
            emit_progress(app, id, transferred, total);
            last_emit = Instant::now();
        }
    }
    // Final 100% update.
    emit_progress(app, id, transferred, total);
    Ok(())
}

/// Stream a local file up to the server, emitting throttled progress events.
fn upload_file(
    sftp: &Sftp,
    app: &AppHandle,
    id: &str,
    local: &str,
    remote: &str,
) -> Result<(), String> {
    let meta = std::fs::metadata(local)
        .map_err(|_| "업로드할 파일을 열 수 없어요.".to_string())?;
    if meta.is_dir() {
        return Err("폴더는 업로드할 수 없어요. 파일만 올릴 수 있어요.".to_string());
    }
    let total = meta.len();

    let mut local_file =
        File::open(local).map_err(|_| "업로드할 파일을 열 수 없어요.".to_string())?;
    let mut remote_file = sftp
        .create(Path::new(remote))
        .map_err(|_| error::sftp_error("파일을 업로드하는"))?;

    let mut buf = [0u8; 32 * 1024];
    let mut transferred = 0u64;
    let mut last_emit = Instant::now();

    loop {
        let n = local_file
            .read(&mut buf)
            .map_err(|_| "업로드할 파일을 읽는 중 문제가 발생했어요.".to_string())?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buf[..n])
            .map_err(|_| error::sftp_error("파일을 업로드하는"))?;
        transferred += n as u64;

        if last_emit.elapsed() >= Duration::from_millis(100) {
            emit_progress(app, id, transferred, total);
            last_emit = Instant::now();
        }
    }
    emit_progress(app, id, transferred, total);
    Ok(())
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

/// Read a remote file's whole contents into a UTF-8 string for the editor.
///
/// Refuses anything too large ([`MAX_EDIT_SIZE`]) and anything that isn't valid
/// UTF-8 text (binaries contain null bytes / invalid sequences), so a binary
/// never reaches the editor even if the frontend's extension guess was wrong.
fn read_file_contents(sftp: &Sftp, path: &str) -> Result<String, String> {
    let mut remote_file = sftp
        .open(Path::new(path))
        .map_err(|_| error::sftp_error("파일을 여는"))?;

    let size = remote_file.stat().ok().and_then(|s| s.size).unwrap_or(0);
    if size > MAX_EDIT_SIZE {
        return Err(error::file_too_large());
    }

    let mut bytes = Vec::with_capacity(size as usize);
    remote_file
        .read_to_end(&mut bytes)
        .map_err(|_| error::sftp_error("파일을 여는"))?;
    // Guard again on the actual byte count in case the stat lied.
    if bytes.len() as u64 > MAX_EDIT_SIZE {
        return Err(error::file_too_large());
    }

    String::from_utf8(bytes).map_err(|_| error::binary_file())
}

/// Overwrite a remote file with new text (truncating any existing contents).
fn write_file_contents(sftp: &Sftp, path: &str, contents: &str) -> Result<(), String> {
    let mut remote_file = sftp
        .create(Path::new(path))
        .map_err(|_| error::sftp_error("파일을 저장하는"))?;
    remote_file
        .write_all(contents.as_bytes())
        .map_err(|_| error::sftp_error("파일을 저장하는"))?;
    Ok(())
}

/// Recursively delete a directory and everything inside it.
fn remove_recursive(sftp: &Sftp, path: &str) -> Result<(), String> {
    let raw = sftp
        .readdir(Path::new(path))
        .map_err(|_| error::sftp_error("폴더를 삭제하는"))?;
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
                .map_err(|_| error::sftp_error("파일을 삭제하는"))?;
        }
    }
    sftp.rmdir(Path::new(path))
        .map_err(|_| error::sftp_error("폴더를 삭제하는"))
}

/// Quote a string as a single shell argument (safe for arbitrary paths).
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Copy a file or directory on the server using `cp -r` over an exec channel.
/// The copy happens entirely server-side (no data round-trips through us).
fn exec_copy(session: &Session, src: &str, dst: &str) -> Result<(), String> {
    let mut channel = session
        .channel_session()
        .map_err(|_| error::sftp_error("복사하는"))?;
    let cmd = format!("cp -r -- {} {}", shell_quote(src), shell_quote(dst));
    channel
        .exec(&cmd)
        .map_err(|_| error::sftp_error("복사하는"))?;

    // Drain stdout/stderr so the remote command can finish.
    let mut out = String::new();
    let _ = channel.read_to_string(&mut out);
    let mut err = String::new();
    let _ = channel.stderr().read_to_string(&mut err);
    let _ = channel.wait_close();

    match channel.exit_status() {
        Ok(0) => Ok(()),
        _ => Err("복사하지 못했어요. 권한이 있는지, 같은 이름이 이미 있는지 확인해주세요.".to_string()),
    }
}

/// Open a new PTY shell channel on the existing session.
fn open_shell(session: &Session, cols: u16, rows: u16) -> Result<Channel, String> {
    let mut channel = session
        .channel_session()
        .map_err(|_| "터미널을 열 수 없어요.".to_string())?;
    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((cols as u32, rows as u32, 0, 0)),
        )
        .map_err(|_| "터미널을 준비하지 못했어요.".to_string())?;
    channel
        .shell()
        .map_err(|_| "셸을 시작하지 못했어요.".to_string())?;
    Ok(channel)
}

/// Handle one worker request. Assumes the session is in blocking mode.
/// Returns `true` when the worker should stop (disconnect or dropped link).
fn handle_req(
    req: Req,
    session: &Session,
    sftp: &Sftp,
    app: &AppHandle,
    terminals: &mut HashMap<String, Channel>,
) -> bool {
    match req {
        Req::Canonicalize { path, resp } => {
            let result = sftp
                .realpath(Path::new(&path))
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|_| error::sftp_error("경로를 확인하는"));
            send_and_check(sftp, app, result, resp)
        }
        Req::ListDir { path, resp } => {
            send_and_check(sftp, app, read_dir_entries(sftp, &path), resp)
        }
        Req::Download {
            id,
            remote_path,
            local_path,
            resp,
        } => {
            let result = download_file(sftp, app, &id, &remote_path, &local_path);
            send_and_check(sftp, app, result, resp)
        }
        Req::Upload {
            id,
            local_path,
            remote_path,
            resp,
        } => {
            let result = upload_file(sftp, app, &id, &local_path, &remote_path);
            send_and_check(sftp, app, result, resp)
        }
        Req::Rename { from, to, resp } => {
            let result = sftp
                .rename(Path::new(&from), Path::new(&to), None)
                .map_err(|_| error::sftp_error("이름을 바꾸는"));
            send_and_check(sftp, app, result, resp)
        }
        Req::Mkdir { path, resp } => {
            let result = sftp
                .mkdir(Path::new(&path), 0o755)
                .map_err(|_| error::sftp_error("폴더를 만드는"));
            send_and_check(sftp, app, result, resp)
        }
        Req::Delete {
            path,
            is_dir,
            resp,
        } => {
            let result = if is_dir {
                remove_recursive(sftp, &path)
            } else {
                sftp.unlink(Path::new(&path))
                    .map_err(|_| error::sftp_error("파일을 삭제하는"))
            };
            send_and_check(sftp, app, result, resp)
        }
        Req::Copy { src, dst, resp } => {
            let result = exec_copy(session, &src, &dst);
            send_and_check(sftp, app, result, resp)
        }
        Req::ReadFile { path, resp } => {
            send_and_check(sftp, app, read_file_contents(sftp, &path), resp)
        }
        Req::WriteFile {
            path,
            contents,
            resp,
        } => {
            let result = write_file_contents(sftp, &path, &contents);
            send_and_check(sftp, app, result, resp)
        }
        Req::OpenTerminal {
            id,
            cols,
            rows,
            resp,
        } => {
            match open_shell(session, cols, rows) {
                Ok(channel) => {
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
            if let Some(ch) = terminals.get_mut(&id) {
                let _ = ch.write_all(&data);
                let _ = ch.flush();
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
            if let Some(mut ch) = terminals.remove(&id) {
                let _ = ch.close();
            }
            false
        }
        Req::Disconnect => true,
    }
}

/// Read whatever a terminal channel currently has buffered (non-blocking) and
/// emit it. Returns `true` if the channel reached EOF / errored (closed).
fn drain_terminal(app: &AppHandle, id: &str, channel: &mut Channel, buf: &mut [u8]) -> bool {
    let mut acc: Vec<u8> = Vec::new();
    let mut closed = false;
    loop {
        match channel.read(buf) {
            Ok(0) => {
                closed = true;
                break;
            }
            Ok(n) => {
                acc.extend_from_slice(&buf[..n]);
                // Bound per-cycle work so one gushing terminal can't starve others.
                if acc.len() >= 256 * 1024 {
                    break;
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break,
            Err(_) => {
                closed = true;
                break;
            }
        }
    }
    if !acc.is_empty() {
        let _ = app.emit(
            "terminal-output",
            TerminalOutput {
                id: id.to_string(),
                data: acc,
            },
        );
    }
    closed
}

/// The worker thread body: owns the session, SFTP handle, and all terminal
/// channels. Multiplexes file operations and interactive shells over the single
/// connection, since libssh2 requires all session access from one thread.
fn worker_loop(session: Session, cmd_rx: mpsc::Receiver<Req>, app: AppHandle) {
    // Open the SFTP subsystem once and reuse it for every request.
    let sftp = match session.sftp() {
        Ok(sftp) => sftp,
        Err(_) => {
            // Couldn't start SFTP: fail every queued request so callers unblock.
            while let Ok(req) = cmd_rx.recv() {
                if !reply_err(req, error::sftp_error("파일 작업을 준비하는")) {
                    break;
                }
            }
            return;
        }
    };

    let mut terminals: HashMap<String, Channel> = HashMap::new();
    let mut buf = [0u8; TERM_BUF];

    'outer: loop {
        // 1. Handle every command that's already queued (blocking mode).
        loop {
            match cmd_rx.try_recv() {
                Ok(req) => {
                    if handle_req(req, &session, &sftp, &app, &mut terminals) {
                        break 'outer;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => break 'outer,
            }
        }

        // 2. Poll terminals for output, batching each channel into one event.
        if !terminals.is_empty() {
            session.set_blocking(false);
            let mut closed: Vec<String> = Vec::new();
            for (id, channel) in terminals.iter_mut() {
                if drain_terminal(&app, id, channel, &mut buf) {
                    closed.push(id.clone());
                }
            }
            session.set_blocking(true);
            for id in closed {
                terminals.remove(&id);
                let _ = app.emit("terminal-closed", id);
            }
        }

        // 3. Wait for the next command. Poll rapidly only while terminals live;
        //    otherwise block so an idle connection uses no CPU.
        let next = if terminals.is_empty() {
            cmd_rx.recv().map_err(|_| ())
        } else {
            match cmd_rx.recv_timeout(TERMINAL_POLL) {
                Ok(req) => Ok(req),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break 'outer,
            }
        };
        match next {
            Ok(req) => {
                if handle_req(req, &session, &sftp, &app, &mut terminals) {
                    break 'outer;
                }
            }
            Err(_) => break 'outer,
        }
    }

    // Close all terminals, then the session.
    for (_, mut ch) in terminals.drain() {
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
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || worker_loop(session, rx, app));
    *state.tx.lock().unwrap() = Some(tx);

    // Resolve the home directory as a first real SFTP round-trip.
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Canonicalize {
        path: ".".to_string(),
        resp: resp_tx,
    })?;
    let home = resp_rx.await.map_err(|_| error::disconnected_error())??;

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

/// Download a remote file to a chosen local path.
#[tauri::command]
pub async fn download(
    state: State<'_, SessionManager>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::Download {
        id,
        remote_path,
        local_path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Upload a local file to a directory on the server.
#[tauri::command]
pub async fn upload(
    state: State<'_, SessionManager>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
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
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::OpenTerminal {
        id,
        cols,
        rows,
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
pub async fn close_terminal(
    state: State<'_, SessionManager>,
    id: String,
) -> Result<(), String> {
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

/// Read a remote text file's contents (for the editor pane).
#[tauri::command]
pub async fn read_remote_file(
    state: State<'_, SessionManager>,
    path: String,
) -> Result<String, String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::ReadFile {
        path,
        resp: resp_tx,
    })?;
    resp_rx.await.map_err(|_| error::disconnected_error())?
}

/// Overwrite a remote file with new text (from the editor pane).
#[tauri::command]
pub async fn write_remote_file(
    state: State<'_, SessionManager>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let (resp_tx, resp_rx) = oneshot::channel();
    state.send(Req::WriteFile {
        path,
        contents,
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
