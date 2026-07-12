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
import Menu, { DropItem } from "../components/Menu";
import FileView from "../components/FileView";

/**
 * One file-manager pane. All directory state (path, listing, view mode) is
 * LOCAL so multiple file-manager panes navigate independently.
 */
export default function FilesScreen() {
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
        setError(typeof err === "string" ? err : "폴더를 불러오지 못했어요.");
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
   * Upload each dropped local file into this pane's current directory,
   * sequentially. Folders are rejected by the backend with a friendly message.
   * For multi-file drops, an overall "N개 중 M개 완료" batch counter is shown.
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
        await upload(id, local, joinPath(dir, name));
        finishTransfer(id);
        logOp({ type: "upload", localPath: local, remoteDir: dir });
      } catch (err) {
        finishTransfer(
          id,
          typeof err === "string" ? err : "업로드에 실패했어요."
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
      setOpError("폴더를 자기 자신 안으로 옮길 수 없어요.");
      return;
    }
    try {
      const to = joinPath(destDir, entry.name);
      await rename(src, to);
      logOp({ type: "move", from: src, to });
      bumpFs();
    } catch (err) {
      setOpError(typeof err === "string" ? err : "옮기지 못했어요.");
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
      title: "편집기로 열 수 없어요",
      message: reason,
      confirmLabel: "다운로드",
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
        <>
          <span className="font-medium text-slate-100">{entry.name}</span> 은(는)
          텍스트 파일이 아니라서 편집기로 열 수 없어요. 대신 다운로드할까요?
        </>
      );
      return;
    }
    if (entry.size >= MAX_EDITABLE_SIZE) {
      offerDownload(
        entry,
        <>
          <span className="font-medium text-slate-100">{entry.name}</span> 은(는)
          너무 커서 편집기로 열 수 없어요. 대신 다운로드할까요?
        </>
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
      setOpError(typeof err === "string" ? err : "작업에 실패했어요.");
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
        typeof err === "string" ? err : "다운로드에 실패했어요."
      );
    }
  }

  function doRename(entry: FileEntry) {
    setPrompt({
      title: "이름 변경",
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
      title: entry.isDir ? "폴더를 삭제할까요?" : "파일을 삭제할까요?",
      confirmLabel: "삭제",
      danger: true,
      message: (
        <>
          <span className="font-medium text-slate-100">{entry.name}</span>
          {entry.isDir
            ? " 폴더와 그 안의 모든 파일이 삭제돼요."
            : " 파일이 삭제돼요."}
          <br />이 작업은 되돌릴 수 없어요.
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
      title: "새 폴더 만들기",
      placeholder: "폴더 이름",
      onConfirm: (name) => {
        setPrompt(null);
        const path = joinPath(currentPath, name);
        runOp(() => mkdir(path), { type: "mkdir", path });
      },
    });
  }

  function doNewFile() {
    setPrompt({
      title: "새 파일 만들기",
      placeholder: "파일 이름 (예: notes.txt)",
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
      setOpError(typeof err === "string" ? err : "파일을 만들지 못했어요.");
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
      let n = name + " 사본";
      let i = 2;
      while (taken.has(n)) n = `${name} 사본 ${i++}`;
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
        { label: "새 파일", onClick: doNewFile },
        { label: "새 폴더", onClick: doNewFolder },
      ];
      if (clipboard)
        items.push({ label: `붙여넣기 (${clipboard.name})`, onClick: doPaste });
      return items;
    }
    const entry = menu.entry;
    const items: MenuItem[] = [{ label: "복사", onClick: () => doCopy(entry) }];
    if (!entry.isDir)
      items.push({ label: "다운로드", onClick: () => doDownload(entry) });
    items.push({ label: "이름 변경", onClick: () => doRename(entry) });
    items.push({ label: "삭제", danger: true, onClick: () => doDelete(entry) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, clipboard]);

  // Menu-bar dropdown contents.
  const fileMenu: DropItem[] = [
    { label: "새 파일", onClick: doNewFile },
    { label: "새 폴더", onClick: doNewFolder },
    {
      label: "다운로드",
      onClick: () => selected && doDownload(selected),
      disabled: !selected || selected.isDir,
    },
    { label: "새로고침", onClick: () => loadDir(currentPath) },
    { type: "separator" },
    { label: "접속 끊기", onClick: handleDisconnect },
  ];
  const editMenu: DropItem[] = [
    {
      label: "복사",
      onClick: () => selected && doCopy(selected),
      disabled: !selected,
    },
    {
      label: clipboard ? `붙여넣기 (${clipboard.name})` : "붙여넣기",
      onClick: doPaste,
      disabled: !clipboard,
    },
    { type: "separator" },
    {
      label: "이름 변경",
      onClick: () => selected && doRename(selected),
      disabled: !selected,
    },
    {
      label: "삭제",
      danger: true,
      onClick: () => selected && doDelete(selected),
      disabled: !selected,
    },
  ];
  const viewMenu: DropItem[] = [
    { type: "check", label: "목록", checked: viewMode === "list", onClick: () => setViewMode("list") },
    { type: "check", label: "자세히", checked: viewMode === "details", onClick: () => setViewMode("details") },
    { type: "check", label: "큰 아이콘", checked: viewMode === "grid", onClick: () => setViewMode("grid") },
    { type: "separator" },
    { type: "check", label: "숨김파일 표시", checked: showHidden, onClick: () => setShowHidden((v) => !v) },
  ];

  const atRoot = currentPath === "/";

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col bg-ink-900 text-slate-100"
    >
      {/* Menu bar */}
      <div className="flex items-center gap-1 border-b border-ink-700/60 bg-ink-800 px-2 py-1">
        <Menu label="파일" items={fileMenu} />
        <Menu label="편집" items={editMenu} />
        <Menu label="보기" items={viewMenu} />
      </div>

      {/* Navigation row: up / home / refresh + breadcrumb */}
      <div className="flex items-center gap-1 border-b border-ink-700/60 bg-ink-800/60 px-2 py-1">
        <ToolButton
          label="상위 폴더"
          disabled={atRoot}
          onClick={() => loadDir(parentPath(currentPath))}
        >
          <path d="M12 19V6M5 12l7-7 7 7" />
        </ToolButton>
        <ToolButton
          label="홈"
          onClick={() => connection && loadDir(connection.home)}
        >
          <path d="M3 11l9-8 9 8M5 10v10h14V10" />
        </ToolButton>
        <ToolButton label="새로고침" onClick={() => loadDir(currentPath)}>
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
                {crumb.name === "/" ? "루트" : crumb.name}
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
          <CenterMessage>불러오는 중…</CenterMessage>
        ) : error ? (
          <CenterMessage>
            <span className="text-red-300">{error}</span>
          </CenterMessage>
        ) : visibleEntries.length === 0 ? (
          <CenterMessage>
            {entries.length === 0
              ? "이 폴더는 비어 있어요."
              : "표시할 파일이 없어요. (숨김파일이 숨겨져 있어요)"}
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
              여기에 놓으면 업로드돼요
            </div>
            <div className="mt-1 truncate text-sm text-sky-300/80">
              {currentPath} 에 파일이 올라갑니다
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
          confirmLabel={confirm.confirmLabel ?? "확인"}
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

