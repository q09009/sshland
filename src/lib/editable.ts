// Deciding whether a remote file should open in the text editor.
//
// We use an extension denylist (known-binary types) rather than a text
// allowlist, so extension-less config files and unknown text files still open.
// The backend read is the real safety net: it rejects non-UTF-8 / null-byte
// content, so a binary that slips past this list still can't reach the editor.

/** Largest file the editor opens. Matches MAX_EDIT_SIZE in ssh.rs. */
export const MAX_EDITABLE_SIZE = 5 * 1024 * 1024;

/** Extensions we treat as binary — never opened in the editor. */
const BINARY_EXTENSIONS = new Set([
  // images (svg is XML text, so it's intentionally NOT here)
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "tif", "tiff", "svgz",
  "heic", "avif", "psd",
  // video
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpg", "mpeg",
  // audio
  "mp3", "wav", "flac", "ogg", "aac", "m4a", "wma", "opus",
  // archives / compressed
  "zip", "tar", "gz", "bz2", "xz", "7z", "rar", "zst", "lz4", "tgz", "jar",
  "war", "cab",
  // executables / objects / bytecode
  "exe", "dll", "so", "o", "a", "bin", "dylib", "class", "pyc", "pyo", "wasm",
  "node", "elf", "obj", "lib",
  // documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  // fonts
  "ttf", "otf", "woff", "woff2", "eot",
  // databases / data blobs
  "db", "sqlite", "sqlite3", "mdb", "dat", "pack", "idx",
  // disk / package images
  "iso", "img", "dmg", "deb", "rpm", "apk", "msi",
]);

/** The lowercase extension of a filename, or "" if it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  // No dot, or a leading-dot dotfile (".bashrc") counts as no extension.
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Whether a filename looks like a binary file from its extension alone. */
export function isProbablyBinary(name: string): boolean {
  const ext = fileExtension(name);
  return ext !== "" && BINARY_EXTENSIONS.has(ext);
}
