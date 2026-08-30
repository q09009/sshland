//! Local filesystem operations used by the client-side file-manager mode.
//!
//! These commands deliberately mirror the remote SFTP surface while staying
//! independent from the SSH worker. Paths must be absolute; the UI obtains its
//! starting directory and platform roots from [`local_fs_info`].

use crate::{error, ssh::FileEntry};
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFsInfo {
    home: String,
    roots: Vec<String>,
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    {
        value.replace('\\', "/")
    }
    #[cfg(not(target_os = "windows"))]
    value
}

fn absolute_path(path: &str) -> Result<PathBuf, String> {
    let value = PathBuf::from(path);
    if value.is_absolute() {
        Ok(value)
    } else {
        Err(error::code("errors.localPath"))
    }
}

fn local_error() -> String {
    error::code("errors.localOperation")
}

#[cfg(unix)]
fn permissions_string(metadata: &fs::Metadata, is_dir: bool, is_symlink: bool) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = metadata.permissions().mode();
    let mut out = String::with_capacity(10);
    out.push(if is_symlink {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    });
    for bit in [
        0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
    ] {
        out.push(if mode & bit != 0 {
            match bit {
                0o400 | 0o040 | 0o004 => 'r',
                0o200 | 0o020 | 0o002 => 'w',
                _ => 'x',
            }
        } else {
            '-'
        });
    }
    out
}

#[cfg(not(unix))]
fn permissions_string(metadata: &fs::Metadata, is_dir: bool, is_symlink: bool) -> String {
    let kind = if is_symlink {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    };
    if metadata.permissions().readonly() {
        format!("{kind}r--------")
    } else {
        format!("{kind}rw-------")
    }
}

#[tauri::command]
pub fn local_fs_info(app: AppHandle) -> Result<LocalFsInfo, String> {
    let home = app.path().home_dir().map_err(|_| local_error())?;
    let mut roots = Vec::new();
    #[cfg(target_os = "windows")]
    for letter in b'A'..=b'Z' {
        let root = PathBuf::from(format!("{}:/", letter as char));
        if root.exists() {
            roots.push(display_path(&root));
        }
    }
    #[cfg(not(target_os = "windows"))]
    roots.push("/".to_string());

    Ok(LocalFsInfo {
        home: display_path(&home),
        roots,
    })
}

#[tauri::command]
pub fn local_list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let directory = absolute_path(&path)?;
    let read_dir = fs::read_dir(&directory).map_err(|_| error::code("errors.localList"))?;
    let mut entries = Vec::new();
    for item in read_dir {
        let item = item.map_err(|_| error::code("errors.localList"))?;
        let item_path = item.path();
        let metadata =
            fs::symlink_metadata(&item_path).map_err(|_| error::code("errors.localList"))?;
        let file_type = metadata.file_type();
        let is_symlink = file_type.is_symlink();
        let is_dir = file_type.is_dir();
        let name = item.file_name().to_string_lossy().into_owned();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        entries.push(FileEntry {
            name,
            path: display_path(&item_path),
            size: if is_dir { 0 } else { metadata.len() },
            is_dir,
            is_symlink,
            modified,
            permissions: permissions_string(&metadata, is_dir, is_symlink),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> Result<(), String> {
    let from = absolute_path(&from)?;
    let to = absolute_path(&to)?;
    if to.try_exists().map_err(|_| local_error())? {
        return Err(error::already_exists());
    }
    fs::rename(from, to).map_err(|_| local_error())
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<(), String> {
    let path = absolute_path(&path)?;
    fs::create_dir(path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::AlreadyExists {
            error::already_exists()
        } else {
            local_error()
        }
    })
}

#[tauri::command]
pub fn local_create_file(path: String) -> Result<(), String> {
    let path = absolute_path(&path)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::AlreadyExists {
                error::already_exists()
            } else {
                local_error()
            }
        })
}

#[tauri::command]
pub fn local_delete(path: String) -> Result<(), String> {
    let path = absolute_path(&path)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| local_error())?;
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path).map_err(|_| local_error())
    } else {
        fs::remove_file(path).map_err(|_| local_error())
    }
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(from).map_err(|_| local_error())?;
    if metadata.file_type().is_symlink() {
        return Err(error::with_detail(
            "errors.localSymlink",
            display_path(from),
        ));
    }
    if metadata.is_dir() {
        fs::create_dir(to).map_err(|_| local_error())?;
        for child in fs::read_dir(from).map_err(|_| local_error())? {
            let child = child.map_err(|_| local_error())?;
            copy_recursive(&child.path(), &to.join(child.file_name()))?;
        }
        Ok(())
    } else if metadata.is_file() {
        fs::copy(from, to).map(|_| ()).map_err(|_| local_error())
    } else {
        Err(error::with_detail(
            "errors.localUnsupported",
            display_path(from),
        ))
    }
}

fn copy_destination_is_inside_source(from: &Path, to: &Path) -> Result<bool, String> {
    let source = fs::canonicalize(from).map_err(|_| local_error())?;
    let destination_parent = to
        .parent()
        .ok_or_else(local_error)
        .and_then(|parent| fs::canonicalize(parent).map_err(|_| local_error()))?;
    let destination = destination_parent.join(to.file_name().ok_or_else(local_error)?);

    #[cfg(target_os = "windows")]
    {
        let source = display_path(&source).to_lowercase();
        let destination = display_path(&destination).to_lowercase();
        Ok(destination == source || destination.starts_with(&format!("{source}/")))
    }
    #[cfg(not(target_os = "windows"))]
    Ok(destination.starts_with(source))
}

#[tauri::command]
pub fn local_copy(from: String, to: String) -> Result<(), String> {
    let from = absolute_path(&from)?;
    let to = absolute_path(&to)?;
    if copy_destination_is_inside_source(&from, &to)? {
        return Err(error::code("errors.copyIntoSelf"));
    }
    if to.try_exists().map_err(|_| local_error())? {
        return Err(error::already_exists());
    }
    let result = copy_recursive(&from, &to);
    if result.is_err() {
        // The destination did not exist before this operation, so any entry at
        // this exact path is a partial copy owned by this failed attempt.
        if let Ok(metadata) = fs::symlink_metadata(&to) {
            if metadata.is_dir() {
                let _ = fs::remove_dir_all(&to);
            } else {
                let _ = fs::remove_file(&to);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn rejects_relative_paths() {
        assert!(absolute_path("relative/file.txt").is_err());
    }

    #[test]
    fn normalizes_display_separators_for_the_current_platform() {
        let displayed = display_path(Path::new("/tmp/example"));
        assert!(!displayed.is_empty());
        #[cfg(target_os = "windows")]
        assert!(!displayed.contains('\\'));
    }

    #[test]
    fn creates_lists_copies_and_deletes_local_entries() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "sshland-local-fs-test-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("test root should be created");

        let source = root.join("source");
        local_mkdir(display_path(&source)).expect("source folder should be created");
        let file = source.join("hello.txt");
        local_create_file(display_path(&file)).expect("file should be created");
        fs::write(&file, b"hello").expect("test content should be written");

        let listed = local_list_dir(display_path(&source)).expect("folder should be listed");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "hello.txt");
        assert_eq!(listed[0].size, 5);

        let nested_copy = source.join("nested-copy");
        assert!(local_copy(display_path(&source), display_path(&nested_copy)).is_err());
        assert!(!nested_copy.exists());

        #[cfg(target_os = "windows")]
        {
            let mut differently_cased_source = display_path(&source);
            let lower_drive = differently_cased_source[0..1].to_lowercase();
            differently_cased_source.replace_range(0..1, &lower_drive);
            assert!(local_copy(differently_cased_source, display_path(&nested_copy)).is_err());
            assert!(!nested_copy.exists());
        }

        let copied = root.join("copied");
        local_copy(display_path(&source), display_path(&copied))
            .expect("folder should be copied recursively");
        assert_eq!(
            fs::read(copied.join("hello.txt")).expect("copied file should be readable"),
            b"hello"
        );

        local_delete(display_path(&source)).expect("source should be deleted");
        local_delete(display_path(&copied)).expect("copy should be deleted");
        fs::remove_dir(root).expect("empty test root should be deleted");
    }
}
