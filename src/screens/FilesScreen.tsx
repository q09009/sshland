import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { save } from "@tauri-apps/plugin-dialog";
import {
  copyPath,
  createFile,
  deletePath,
  disconnect,
  download,
  FileEntry,
  listDir,
  mkdir,
  rename,
  upload,
} from "../api";
import { useAppStore, ViewMode } from "../store";
import { baseName, breadcrumbs, joinPath, parentPath } from "../lib/path";
import { sortEntries } from "../lib/files";
import { isProbablyBinary, MAX_EDITABLE_SIZE } from "../lib/editable";
import { FileOperation, operationToCommandString } from "../lib/commandLog";
import { ConfirmDialog, PromptDialog } from "../components/Modal";
import ContextMenu, { MenuItem } from "../components/ContextMenu";
import type { DropItem } from "../components/Menu";
import FileView from "../components/FileView";
import { usePaneMenuRegistration } from "../lib/paneMenus";
import { useI18n } from "../i18n";

/**
 * One file-manager pane. All directory state (path, listing, view mode) is
 * LOCAL so multiple file-manager panes navigate independently.
 */
export default function FilesScreen({ id }: { id: string }) {
  const connection = useAppStore((s) => s.connection);
  const returnToConnect = useAppStore((s) => s.returnToConnect);
  const startTransfer = useAppStore((s) => s.startTransfer);
  const finishTransfer = useAppStore((s) => s.finishTransfer);
  const startBatch = useAppStore((s) => s.startBatch);
  const advanceBatch = useAppStore((s) => s.advanceBatch);
  const clipboard = useAppStore((s) => s.clipboard);
  const setClipboard = useAppStore((s) => s.setClipboard);
  const setDragItem = useAppStore((s) => s.setDragItem);
  const bumpFs = useAppStore((s) => s.bumpFs);
  const logCommand = useAppStore((s) => s.logCommand);
  const fsVersion = useAppStore((s) => s.fsVersion);
  const openEditor = useAppStore((s) => s.openEditor);
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const [currentPath, setCurrentPath] = useState(connection?.home ?? "/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [selected, setSelected] = useState<FileEntry | null>(null);

  // Context menu: `entry` is null for an empty-area (background) menu.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry | null;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [prompt, setPrompt] = useState<{
    title: string;
    initialValue?: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
  } | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Refs so the once-registered drag-drop listener sees current values.
  const reqIdRef = useRef(0);
  const currentPathRef = useRef(currentPath);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const lastFsRef = useRef(fsVersion);
  const didLoadInitialRef = useRef(false);
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const loadDir = useCallback(async (path: string) => {
    const reqId = ++reqIdRef.current;
    setCurrentPath(path);
    setSelected(null);
    setLoading(true);
    setError(null);
    try {
      const list = await listDir(path);
      if (reqIdRef.current === reqId) {
        setEntries(sortEntries(list));
        setLoading(false);
      }
    } catch (err) {
      if (reqIdRef.current === reqId) {
        setError(typeof err === "string" ? err : tRef.current("files.error.load"));
        setLoading(false);
      }
    }
  }, []);

  // Refresh the current directory without a loading flicker (keeps selection).
  const reloadSilently = useCallback(() => {
    const reqId = ++reqIdRef.current;
    listDir(currentPathRef.current)
      .then((list) => {
        if (reqIdRef.current === reqId) setEntries(sortEntries(list));
      })
      .catch(() => {});
  }, []);

  // Load the starting directory on mount. Guarded so React StrictMode's
  // dev-only double-invoke of this effect can't fire two competing loadDir
  // calls for the same path (the loser's response was silently dropped,
  // sometimes leaving the pane stuck on "불러오는 중...").
  useEffect(() => {
    if (didLoadInitialRef.current) return;
    didLoadInitialRef.current = true;
    if (connection) loadDir(connection.home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any pane's filesystem mutation reloads this pane, keeping panes in sync.
  // Compare the actual version (not a "did I mount" flag) so React StrictMode's
  // dev-only double-invoke doesn't trigger a spurious reload on mount — that
  // reload bumped reqId and dropped the initial loadDir's response, leaving the
  // pane stuck on "불러오는 중...".
  useEffect(() => {
    if (lastFsRef.current === fsVersion) return;
    lastFsRef.current = fsVersion;
    reloadSilently();
  }, [fsVersion, reloadSilently]);

  // Auto-clear the operation error banner.
  useEffect(() => {
    if (!opError) return;
    const t = setTimeout(() => setOpError(null), 5000);
    return () => clearTimeout(t);
  }, [opError]);

  // OS file drag-and-drop uploads into this pane. The drop is routed by CURSOR
  // POSITION, not focus: Tauri fires one window-level event, so every pane's
  // listener runs — each checks whether the cursor is inside its own rect and
  // only the pane under the cursor reacts. Terminal panes have no FilesScreen
  // (so they never react), and dropping never moves focus, so a position check
  // is the only correct way to pick the target pane.
  useEffect(() => {
    // Tauri reports the cursor in physical pixels; convert to CSS pixels
    // (what getBoundingClientRect uses) by dividing out the device pixel ratio.
    const isOverThisPane = (pos: { x: number; y: number }) => {
      const el = rootRef.current;
      if (!el) return false;
      const dpr = window.devicePixelRatio || 1;
      const x = pos.x / dpr;
      const y = pos.y / dpr;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") {
        setIsDragging(isOverThisPane(p.position));
      } else if (p.type === "leave") {
        setIsDragging(false);
      } else if (p.type === "drop") {
        const over = isOverThisPane(p.position);
        setIsDragging(false);
        if (over) void handleDrop(p.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Upload each dropped local file or folder into this pane's current directory,
   * sequentially. Folders keep their complete nested directory structure.
   * For multi-item drops, an overall "N개 중 M개 완료" batch counter is shown.
   */
  async function handleDrop(paths: string[]) {
    const dir = currentPathRef.current;
    const batchId = crypto.randomUUID();
    const showBatch = paths.length > 1;
    if (showBatch) startBatch(batchId, paths.length);
    for (const local of paths) {
      const name = baseName(local);
      const id = crypto.randomUUID();
      startTransfer({ id, name, kind: "upload", total: 0 });
      try {
        const result = await upload(id, local, joinPath(dir, name));
        finishTransfer(id);
        logOp({
          type: "upload",
          localPath: local,
          remoteDir: dir,
          isDir: result.isDir,
        });
      } catch (err) {
        finishTransfer(
          id,
          typeof err === "string" ? err : tRef.current("files.error.upload")
        );
      }
      if (showBatch) advanceBatch(batchId);
    }
    bumpFs();
    // The overall counter auto-dismisses itself from TransfersPanel once done.
  }

  /** Start a potential drag-to-move; commits on drop over a folder/pane. */
  function onItemMouseDown(entry: FileEntry, e: React.MouseEvent) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const targetDirAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const t = el?.closest("[data-drop-dir]") as HTMLElement | null;
      return t?.getAttribute("data-drop-dir") ?? null;
    };
    const clearHighlight = () => {
      highlightedElRef.current?.classList.remove("drop-target-active");
      highlightedElRef.current = null;
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5)
          return;
        dragging = true;
        setDragItem({
          name: entry.name,
          path: entry.path,
          isDir: entry.isDir,
          sourceDir: currentPathRef.current,
        });
        document.body.style.userSelect = "none";
      }
      const el = document.elementFromPoint(
        ev.clientX,
        ev.clientY
      )?.closest("[data-drop-dir]") as HTMLElement | null;
      if (el !== highlightedElRef.current) {
        clearHighlight();
        if (el) {
          el.classList.add("drop-target-active");
          highlightedElRef.current = el;
        }
      }
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      clearHighlight();
      if (dragging) {
        const destDir = targetDirAt(ev.clientX, ev.clientY);
        setDragItem(null);
        if (destDir != null) void performMove(entry, destDir);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Move an item into destDir via rename (same connection = same filesystem). */
  async function performMove(entry: FileEntry, destDir: string) {
    const src = entry.path;
    if (destDir === parentPath(src)) return; // already there
    if (entry.isDir && (destDir === src || destDir.startsWith(src + "/"))) {
      setOpError(t("files.error.moveIntoSelf"));
      return;
    }
    try {
      const to = joinPath(destDir, entry.name);
      await rename(src, to);
      logOp({ type: "move", from: src, to });
      bumpFs();
    } catch (err) {
      setOpError(typeof err === "string" ? err : t("files.error.move"));
    }
  }

  const crumbs = useMemo(() => breadcrumbs(currentPath), [currentPath]);
  const visibleEntries = useMemo(
    () => (showHidden ? entries : entries.filter((e) => !e.name.startsWith("."))),
    [entries, showHidden]
  );

  async function handleDisconnect() {
    try {
      await disconnect();
    } finally {
      returnToConnect();
    }
  }

  /** Offer to download a file that can't be opened in the editor. */
  function offerDownload(entry: FileEntry, reason: React.ReactNode) {
    setConfirm({
      title: t("files.cannotEdit.title"),
      message: reason,
      confirmLabel: t("common.download"),
      onConfirm: () => {
        setConfirm(null);
        void doDownload(entry);
      },
    });
  }

  /** Double-click: open a folder, or open a text file in the editor. Binary or
   *  oversized files can't be edited, so we offer to download them instead. */
  function openEntry(entry: FileEntry) {
    if (entry.isDir) {
      loadDir(entry.path);
      return;
    }
    if (isProbablyBinary(entry.name)) {
      offerDownload(
        entry,
        t("files.cannotEdit.binary", { name: entry.name })
      );
      return;
    }
    if (entry.size >= MAX_EDITABLE_SIZE) {
      offerDownload(
        entry,
        t("files.cannotEdit.large", { name: entry.name })
      );
      return;
    }
    openEditor(entry.path);
  }

  /** Record a completed file operation as a CLI command in the log bar. */
  function logOp(op: FileOperation) {
    if (!connection) return;
    logCommand(
      operationToCommandString(op, {
        user: connection.username,
        host: connection.host,
      })
    );
  }

  /** Run a mutating operation, log its command on success, then refresh panes. */
  async function runOp(fn: () => Promise<void>, op?: FileOperation) {
    try {
      await fn();
      if (op) logOp(op);
      bumpFs();
    } catch (err) {
      setOpError(typeof err === "string" ? err : t("files.error.operation"));
    }
  }

  async function doDownload(entry: FileEntry) {
    const local = await save({ defaultPath: entry.name });
    if (!local) return;
    const id = crypto.randomUUID();
    startTransfer({ id, name: entry.name, kind: "download", total: entry.size });
    try {
      await download(id, entry.path, local);
      finishTransfer(id);
      logOp({ type: "download", remotePath: entry.path });
    } catch (err) {
      finishTransfer(
        id,
        typeof err === "string" ? err : t("files.error.download")
      );
    }
  }

  function doRename(entry: FileEntry) {
    setPrompt({
      title: t("common.rename"),
      initialValue: entry.name,
      onConfirm: (newName) => {
        setPrompt(null);
        if (newName === entry.name) return;
        const to = joinPath(currentPath, newName);
        runOp(() => rename(entry.path, to), {
          type: "move",
          from: entry.path,
          to,
        });
      },
    });
  }

  function doDelete(entry: FileEntry) {
    setConfirm({
      title: entry.isDir ? t("files.deleteFolder.title") : t("files.deleteFile.title"),
      confirmLabel: t("common.delete"),
      danger: true,
      message: (
        <>
          {entry.isDir
            ? t("files.deleteFolder.message", { name: entry.name })
            : t("files.deleteFile.message", { name: entry.name })}
          <br />{t("files.delete.irreversible")}
        </>
      ),
      onConfirm: () => {
        setConfirm(null);
        runOp(() => deletePath(entry.path, entry.isDir), {
          type: "delete",
          path: entry.path,
          isDir: entry.isDir,
        });
      },
    });
  }

  function doNewFolder() {
    setPrompt({
      title: t("files.newFolder.title"),
      placeholder: t("files.newFolder.placeholder"),
      onConfirm: (name) => {
        setPrompt(null);
        const path = joinPath(currentPath, name);
        runOp(() => mkdir(path), { type: "mkdir", path });
      },
    });
  }

  function doNewFile() {
    setPrompt({
      title: t("files.newFile.title"),
      placeholder: t("files.newFile.placeholder"),
      onConfirm: (name) => {
        setPrompt(null);
        void createNewFile(joinPath(currentPath, name));
      },
    });
  }

  /** Create an empty file, then open it in the editor so typing can start. */
  async function createNewFile(path: string) {
    try {
      await createFile(path);
      logOp({ type: "newfile", path });
      bumpFs();
      openEditor(path);
    } catch (err) {
      setOpError(typeof err === "string" ? err : t("files.error.create"));
    }
  }

  function doCopy(entry: FileEntry) {
    setClipboard({ name: entry.name, path: entry.path, isDir: entry.isDir });
  }

  /** Paste the clipboard item into the current directory (avoids name clashes). */
  function doPaste() {
    if (!clipboard) return;
    const taken = new Set(entries.map((e) => e.name));
    let name = clipboard.name;
    if (taken.has(name)) {
      let n = t("files.copySuffix", { name });
      let i = 2;
      while (taken.has(n)) n = t("files.copyNumberedSuffix", { name, number: i++ });
      name = n;
    }
    const to = joinPath(currentPath, name);
    runOp(() => copyPath(clipboard.path, to), {
      type: "copy",
      from: clipboard.path,
      to,
    });
  }

  // Right-click a file/folder.
  function openMenu(e: React.MouseEvent, entry: FileEntry) {
    e.preventDefault();
    setSelected(entry);
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }

  // Right-click empty space.
  function openEmptyMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry: null });
  }

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return [];
    if (!menu.entry) {
      // Background menu.
      const items: MenuItem[] = [
        { label: t("files.newFile"), onClick: doNewFile },
        { label: t("files.newFolder"), onClick: doNewFolder },
      ];
      if (clipboard)
        items.push({ label: t("common.pasteNamed", { name: clipboard.name }), onClick: doPaste });
      return items;
    }
    const entry = menu.entry;
    const items: MenuItem[] = [{ label: t("common.copy"), onClick: () => doCopy(entry) }];
    if (!entry.isDir)
      items.push({ label: t("common.download"), onClick: () => doDownload(entry) });
    items.push({ label: t("common.rename"), onClick: () => doRename(entry) });
    items.push({ label: t("common.delete"), danger: true, onClick: () => doDelete(entry) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, clipboard, t]);

  // Menu-bar dropdown contents.
  const fileMenu: DropItem[] = [
    { label: t("files.newFile"), onClick: doNewFile },
    { label: t("files.newFolder"), onClick: doNewFolder },
    {
      label: t("common.download"),
      onClick: () => selected && doDownload(selected),
      disabled: !selected || selected.isDir,
    },
    { label: t("common.refresh"), onClick: () => loadDir(currentPath) },
    { type: "separator" },
    { label: t("files.disconnect"), onClick: handleDisconnect },
  ];
  const editMenu: DropItem[] = [
    {
      label: t("common.copy"),
      onClick: () => selected && doCopy(selected),
      disabled: !selected,
    },
    {
      label: clipboard ? t("common.pasteNamed", { name: clipboard.name }) : t("common.paste"),
      onClick: doPaste,
      disabled: !clipboard,
    },
    { type: "separator" },
    {
      label: t("common.rename"),
      onClick: () => selected && doRename(selected),
      disabled: !selected,
    },
    {
      label: t("common.delete"),
      danger: true,
      onClick: () => selected && doDelete(selected),
      disabled: !selected,
    },
  ];
  const viewMenu: DropItem[] = [
    { type: "check", label: t("files.view.list"), checked: viewMode === "list", onClick: () => setViewMode("list") },
    { type: "check", label: t("files.view.details"), checked: viewMode === "details", onClick: () => setViewMode("details") },
    { type: "check", label: t("files.view.grid"), checked: viewMode === "grid", onClick: () => setViewMode("grid") },
    { type: "separator" },
    { type: "check", label: t("files.view.hidden"), checked: showHidden, onClick: () => setShowHidden((v) => !v) },
  ];

  usePaneMenuRegistration(id, [
    { label: t("common.file"), items: fileMenu },
    { label: t("common.edit"), items: editMenu },
    { label: t("common.view"), items: viewMenu },
  ]);

  const atRoot = currentPath === "/";

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col bg-ink-900 text-slate-100"
    >
      {/* Navigation row: up / home / refresh + breadcrumb */}
      <div className="flex items-center gap-1 border-b border-ink-700/60 bg-ink-800/60 px-2 py-1">
        <ToolButton
          label={t("files.up")}
          disabled={atRoot}
          onClick={() => loadDir(parentPath(currentPath))}
        >
          <path d="M12 19V6M5 12l7-7 7 7" />
        </ToolButton>
        <ToolButton
          label={t("files.home")}
          onClick={() => connection && loadDir(connection.home)}
        >
          <path d="M3 11l9-8 9 8M5 10v10h14V10" />
        </ToolButton>
        <ToolButton label={t("common.refresh")} onClick={() => loadDir(currentPath)}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </ToolButton>

        <nav className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-sm">
          {crumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center">
              {i > 0 && <span className="mx-0.5 text-slate-600">/</span>}
              <button
                onClick={() => loadDir(crumb.path)}
                className={`rounded px-1.5 py-0.5 hover:bg-ink-700 ${
                  i === crumbs.length - 1
                    ? "font-medium text-slate-100"
                    : "text-slate-400"
                }`}
              >
                {crumb.name === "/" ? t("files.root") : crumb.name}
              </button>
            </span>
          ))}
        </nav>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        onContextMenu={openEmptyMenu}
        data-drop-dir={currentPath}
      >
        {loading ? (
          <CenterMessage>{t("files.loading")}</CenterMessage>
        ) : error ? (
          <CenterMessage>
            <span className="text-red-300">{error}</span>
          </CenterMessage>
        ) : visibleEntries.length === 0 ? (
          <CenterMessage>
            {entries.length === 0
              ? t("files.empty")
              : t("files.noVisible")}
          </CenterMessage>
        ) : (
          <FileView
            entries={visibleEntries}
            viewMode={viewMode}
            selectedPath={selected?.path ?? null}
            onOpen={openEntry}
            onSelect={setSelected}
            onContextMenu={openMenu}
            onItemMouseDown={onItemMouseDown}
          />
        )}
      </div>

      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-sky-400 bg-sky-950/60 backdrop-blur-sm">
          <div className="rounded-2xl px-10 py-8 text-center">
            <div className="text-lg font-medium text-sky-200">
              {t("files.drop.title")}
            </div>
            <div className="mt-1 truncate text-sm text-sky-300/80">
              {t("files.drop.destination", { path: currentPath })}
            </div>
          </div>
        </div>
      )}

      {opError && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-950/90 px-4 py-2.5 text-sm text-red-200 shadow-xl">
          {opError}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel ?? t("common.confirm")}
          danger={confirm.danger}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          initialValue={prompt.initialValue}
          placeholder={prompt.placeholder}
          onConfirm={prompt.onConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-ink-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
