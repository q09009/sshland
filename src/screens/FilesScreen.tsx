import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { save } from "@tauri-apps/plugin-dialog";
import {
  deletePath,
  disconnect,
  download,
  FileEntry,
  mkdir,
  rename,
  TransferProgress,
  upload,
} from "../api";
import { useAppStore } from "../store";
import { formatDate, formatSize } from "../lib/format";
import { baseName, breadcrumbs, joinPath, parentPath } from "../lib/path";
import { ConfirmDialog, PromptDialog } from "../components/Modal";
import ContextMenu, { MenuItem } from "../components/ContextMenu";
import TransfersPanel from "../components/TransfersPanel";

export default function FilesScreen() {
  const connection = useAppStore((s) => s.connection);
  const currentPath = useAppStore((s) => s.currentPath);
  const entries = useAppStore((s) => s.entries);
  const loading = useAppStore((s) => s.filesLoading);
  const error = useAppStore((s) => s.filesError);
  const showHidden = useAppStore((s) => s.showHidden);
  const loadDir = useAppStore((s) => s.loadDir);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const returnToConnect = useAppStore((s) => s.returnToConnect);
  const startTransfer = useAppStore((s) => s.startTransfer);
  const updateTransfer = useAppStore((s) => s.updateTransfer);
  const finishTransfer = useAppStore((s) => s.finishTransfer);

  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(
    null
  );
  const [confirm, setConfirm] = useState<{
    title: string;
    message: React.ReactNode;
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

  // Load the starting directory on entry.
  useEffect(() => {
    if (connection) loadDir(connection.home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream transfer progress from the backend into the store.
  useEffect(() => {
    const unlisten = listen<TransferProgress>("transfer-progress", (e) => {
      updateTransfer(e.payload.id, e.payload.transferred, e.payload.total);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateTransfer]);

  // Return to the connect screen if the backend reports the link dropped.
  useEffect(() => {
    const unlisten = listen("connection-lost", () => {
      void disconnect().catch(() => {});
      returnToConnect("서버와의 연결이 끊어졌어요. 다시 접속해주세요.");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [returnToConnect]);

  // Auto-clear the operation error banner.
  useEffect(() => {
    if (!opError) return;
    const t = setTimeout(() => setOpError(null), 5000);
    return () => clearTimeout(t);
  }, [opError]);

  // OS file drag-and-drop uploads into the current directory.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") setIsDragging(true);
      else if (p.type === "leave") setIsDragging(false);
      else if (p.type === "drop") {
        setIsDragging(false);
        void handleDrop(p.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Upload each dropped local file into the current directory. */
  async function handleDrop(paths: string[]) {
    // Read the path fresh so the once-registered listener isn't stale.
    const dir = useAppStore.getState().currentPath;
    for (const local of paths) {
      const name = baseName(local);
      const id = crypto.randomUUID();
      startTransfer({ id, name, kind: "upload", total: 0 });
      try {
        await upload(id, local, joinPath(dir, name));
        finishTransfer(id);
      } catch (err) {
        finishTransfer(
          id,
          typeof err === "string" ? err : "업로드에 실패했어요."
        );
      }
    }
    // Refresh if we're still in the directory we uploaded into.
    if (useAppStore.getState().currentPath === dir) await loadDir(dir);
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

  function openEntry(path: string, isDir: boolean) {
    if (isDir) loadDir(path);
  }

  /** Run a mutating operation, then refresh the listing. */
  async function runOp(fn: () => Promise<void>) {
    try {
      await fn();
      await loadDir(currentPath);
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
        runOp(() => rename(entry.path, joinPath(currentPath, newName)));
      },
    });
  }

  function doDelete(entry: FileEntry) {
    setConfirm({
      title: entry.isDir ? "폴더를 삭제할까요?" : "파일을 삭제할까요?",
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
        runOp(() => deletePath(entry.path, entry.isDir));
      },
    });
  }

  function doNewFolder() {
    setPrompt({
      title: "새 폴더 만들기",
      placeholder: "폴더 이름",
      onConfirm: (name) => {
        setPrompt(null);
        runOp(() => mkdir(joinPath(currentPath, name)));
      },
    });
  }

  function openMenu(e: React.MouseEvent, entry: FileEntry) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return [];
    const entry = menu.entry;
    const items: MenuItem[] = [];
    if (!entry.isDir)
      items.push({ label: "다운로드", onClick: () => doDownload(entry) });
    items.push({ label: "이름 변경", onClick: () => doRename(entry) });
    items.push({ label: "삭제", danger: true, onClick: () => doDelete(entry) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  const atRoot = currentPath === "/";

  return (
    <div className="flex h-full flex-col bg-ink-900 text-slate-100">
      <header className="flex items-center justify-between gap-3 border-b border-ink-700/60 bg-ink-800 px-4 py-2.5">
        <p className="truncate text-sm font-medium">
          {connection?.username}@{connection?.host}
        </p>
        <button
          onClick={handleDisconnect}
          className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500/50 hover:text-red-300"
        >
          접속 끊기
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-ink-700/60 bg-ink-800/60 px-3 py-2">
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

        <nav className="mx-1 flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-sm">
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

        <button
          onClick={doNewFolder}
          className="shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-slate-300 hover:border-sky-600 hover:text-white"
        >
          + 새 폴더
        </button>

        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={toggleHidden}
            className="accent-sky-600"
          />
          숨김파일
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-ink-800/95 text-xs text-slate-400 backdrop-blur">
              <tr className="border-b border-ink-700/60">
                <th className="px-4 py-2 text-left font-medium">이름</th>
                <th className="w-28 px-4 py-2 text-right font-medium">크기</th>
                <th className="w-40 px-4 py-2 text-left font-medium">수정일</th>
                <th className="w-32 px-4 py-2 text-left font-medium">권한</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr
                  key={entry.path}
                  onDoubleClick={() => openEntry(entry.path, entry.isDir)}
                  onContextMenu={(e) => openMenu(e, entry)}
                  className={`border-b border-ink-800/60 hover:bg-ink-800/60 ${
                    entry.isDir ? "cursor-pointer" : ""
                  }`}
                >
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <FileIcon isDir={entry.isDir} isSymlink={entry.isSymlink} />
                      <span
                        className={`truncate ${
                          entry.isDir ? "text-slate-100" : "text-slate-300"
                        }`}
                      >
                        {entry.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-slate-400">
                    {formatSize(entry.size, entry.isDir)}
                  </td>
                  <td className="px-4 py-1.5 text-slate-400">
                    {formatDate(entry.modified)}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-xs text-slate-500">
                    {entry.permissions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-sky-950/60 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-sky-400 px-10 py-8 text-center">
            <div className="text-lg font-medium text-sky-200">
              여기에 놓으면 업로드돼요
            </div>
            <div className="mt-1 text-sm text-sky-300/80">
              현재 폴더에 파일이 올라갑니다
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
          confirmLabel="삭제"
          danger
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

      <TransfersPanel />
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

function FileIcon({ isDir, isSymlink }: { isDir: boolean; isSymlink: boolean }) {
  if (isDir) {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-sky-400"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
      </svg>
    );
  }
  return (
    <svg
      className={`h-4 w-4 shrink-0 ${
        isSymlink ? "text-teal-400" : "text-slate-500"
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
