import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
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
  searchFiles,
  upload,
  type RemoteSearchEngine,
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
import { useSettings } from "../lib/settings";
import { resolveFileSearchEngine } from "../lib/fileSearch";

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
  const focusedPaneId = useAppStore((s) => s.focusedPaneId);
  const preferredSearchEngine = useSettings((s) => s.settings.fileSearchEngine);
  const { language, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const [currentPath, setCurrentPath] = useState(connection?.home ?? "/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

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
  const searchReqIdRef = useRef(0);
  const currentPathRef = useRef(currentPath);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const suppressClickRef = useRef(false);
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const lastFsRef = useRef(fsVersion);
  const didLoadInitialRef = useRef(false);
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const effectiveSearchEngine = resolveFileSearchEngine(
    preferredSearchEngine,
    connection?.searchTools ?? {
      find: null,
      fdCommand: null,
      fdChecked: false,
    },
  );

  const loadDir = useCallback(async (path: string) => {
    const reqId = ++reqIdRef.current;
    setCurrentPath(path);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setSearchQuery("");
    searchReqIdRef.current += 1;
    setSearchResults([]);
    setSearchActive(false);
    setSearching(false);
    setSearchError(null);
    setSearchTruncated(false);
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
        if (reqIdRef.current === reqId) {
          const sorted = sortEntries(list);
          const existing = new Set(sorted.map((entry) => entry.path));
          setEntries(sorted);
          setSelectedPaths((previous) =>
            new Set([...previous].filter((path) => existing.has(path))),
          );
        }
      })
      .catch(() => {});
  }, []);

  const runRemoteSearch = useCallback(
    async (rawQuery = searchQuery, includeHidden = showHidden) => {
      const query = rawQuery.trim();
      if (!query) {
        searchReqIdRef.current += 1;
        setSearchResults([]);
        setSearchActive(false);
        setSearching(false);
        setSearchError(null);
        setSearchTruncated(false);
        return;
      }
      if (effectiveSearchEngine === "filter") return;

      const reqId = ++searchReqIdRef.current;
      setSearchActive(true);
      setSearching(true);
      setSearchError(null);
      setSearchTruncated(false);
      setSelectedPaths(new Set());
      setSelectionAnchor(null);
      const root = currentPathRef.current;
      if (connection) {
        logCommand(
          operationToCommandString(
            {
              type: "search",
              root,
              query,
              engine:
                effectiveSearchEngine === "fd"
                  ? connection.searchTools.fdCommand === "fdfind"
                    ? "fdfind"
                    : "fd"
                  : "find",
              includeHidden,
            },
            { user: connection.username, host: connection.host },
            language,
          ),
        );
      }
      try {
        const result = await searchFiles(
          root,
          query,
          effectiveSearchEngine as RemoteSearchEngine,
          includeHidden,
        );
        if (searchReqIdRef.current === reqId) {
          setSearchResults(result.entries);
          setSearchTruncated(result.truncated);
        }
      } catch (searchFailure) {
        if (searchReqIdRef.current === reqId) {
          setSearchResults([]);
          setSearchError(
            typeof searchFailure === "string"
              ? searchFailure
              : tRef.current("files.search.failed"),
          );
        }
      } finally {
        if (searchReqIdRef.current === reqId) setSearching(false);
      }
    },
    [
      connection,
      effectiveSearchEngine,
      language,
      logCommand,
      searchQuery,
      showHidden,
    ],
  );

  // Changing the configured search behavior returns every pane to its normal
  // directory listing; the next query follows the newly selected behavior.
  useEffect(() => {
    searchReqIdRef.current += 1;
    setSearchQuery("");
    setSearchResults([]);
    setSearchActive(false);
    setSearching(false);
    setSearchError(null);
    setSearchTruncated(false);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
  }, [preferredSearchEngine]);

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
    if (searchActive && effectiveSearchEngine !== "filter") {
      void runRemoteSearch();
    }
  }, [
    effectiveSearchEngine,
    fsVersion,
    reloadSilently,
    runRemoteSearch,
    searchActive,
  ]);

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
    if (showBatch) startBatch(batchId, paths.length, "upload");
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

  function selectEntry(entry: FileEntry, event: React.MouseEvent) {
    // A browser click fires after mouseup. Ignore the click produced by an
    // actual drag so a multi-selection is not collapsed to the dragged row.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchor) {
      event.preventDefault();
      const anchorIndex = visibleEntries.findIndex(
        (item) => item.path === selectionAnchor,
      );
      const entryIndex = visibleEntries.findIndex((item) => item.path === entry.path);
      if (anchorIndex >= 0 && entryIndex >= 0) {
        const [start, end] = anchorIndex < entryIndex
          ? [anchorIndex, entryIndex]
          : [entryIndex, anchorIndex];
        const range = visibleEntries.slice(start, end + 1).map((item) => item.path);
        setSelectedPaths((previous) =>
          new Set(additive ? [...previous, ...range] : range),
        );
        return;
      }
    }

    if (additive) {
      setSelectedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
    } else {
      setSelectedPaths(new Set([entry.path]));
    }
    setSelectionAnchor(entry.path);
  }

  /** Start a Windows-style selection rectangle from empty file-list space. */
  function onSelectionAreaMouseDown(event: React.MouseEvent) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest("[data-file-path]") ||
      target.closest("button, input, select, textarea, thead")
    ) {
      return;
    }

    const area = contentRef.current;
    const root = rootRef.current;
    if (!area || !root) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const keepExisting = event.ctrlKey || event.metaKey;
    const baseSelection = keepExisting ? new Set(selectedPaths) : new Set<string>();
    let moved = false;

    const updateRectangle = (clientX: number, clientY: number) => {
      const areaRect = area.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const x = Math.min(Math.max(clientX, areaRect.left), areaRect.right);
      const y = Math.min(Math.max(clientY, areaRect.top), areaRect.bottom);
      const left = Math.min(startX, x);
      const right = Math.max(startX, x);
      const top = Math.min(startY, y);
      const bottom = Math.max(startY, y);

      setSelectionRect({
        left: left - rootRect.left,
        top: top - rootRect.top,
        width: right - left,
        height: bottom - top,
      });

      const next = new Set(baseSelection);
      root.querySelectorAll<HTMLElement>("[data-file-path]").forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.right >= left &&
          rect.left <= right &&
          rect.bottom >= top &&
          rect.top <= bottom
        ) {
          const path = element.dataset.filePath;
          if (path) next.add(path);
        }
      });
      setSelectedPaths(next);

      if (clientY < areaRect.top + 28) area.scrollTop -= 18;
      else if (clientY > areaRect.bottom - 28) area.scrollTop += 18;
    };

    const onMove = (moveEvent: MouseEvent) => {
      if (!moved) {
        if (
          Math.abs(moveEvent.clientX - startX) +
            Math.abs(moveEvent.clientY - startY) <
          4
        ) {
          return;
        }
        moved = true;
        document.body.style.userSelect = "none";
      }
      moveEvent.preventDefault();
      updateRectangle(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setSelectionRect(null);
      if (!moved && !keepExisting) {
        setSelectedPaths(new Set());
        setSelectionAnchor(null);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Start a potential drag-to-move; selected items move together. */
  function onItemMouseDown(entry: FileEntry, e: React.MouseEvent) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const additive = e.ctrlKey || e.metaKey;
    const dragEntries = selectedPaths.has(entry.path)
      ? selectedEntries
      : additive
        ? [...selectedEntries, entry]
        : [entry];

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
        suppressClickRef.current = true;
        setSelectedPaths(new Set(dragEntries.map((item) => item.path)));
        setSelectionAnchor(entry.path);
        setDragItem({
          items: dragEntries.map((item) => ({
            name: item.name,
            path: item.path,
            isDir: item.isDir,
          })),
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
        if (destDir != null) void performMove(dragEntries, destDir);
        // Normally the following click consumes the flag. If the platform
        // suppresses that click after dragging, clear it for the next action.
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Move selected entries via rename (same connection = same filesystem). */
  async function performMove(items: FileEntry[], destDir: string) {
    const movableItems = items.filter(
      (item) => parentPath(item.path) !== destDir,
    );
    if (movableItems.length === 0) return;
    if (
      movableItems.some(
        (item) =>
          item.isDir &&
          (destDir === item.path || destDir.startsWith(item.path + "/")),
      )
    ) {
      setOpError(t("files.error.moveIntoSelf"));
      return;
    }

    let failed = 0;
    let completed = 0;
    for (const item of movableItems) {
      const to = joinPath(destDir, item.name);
      try {
        await rename(item.path, to);
        logOp({ type: "move", from: item.path, to });
        completed += 1;
      } catch {
        failed += 1;
      }
    }
    if (completed > 0) bumpFs();
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    if (failed > 0) {
      setOpError(
        t("files.error.batch", { failed, total: movableItems.length }),
      );
    }
  }

  const crumbs = useMemo(() => breadcrumbs(currentPath), [currentPath]);
  const visibleEntries = useMemo(() => {
    const source = searchActive ? searchResults : entries;
    const query =
      effectiveSearchEngine === "filter"
        ? searchQuery.trim().toLocaleLowerCase()
        : "";
    return source.filter(
      (entry) =>
        (showHidden || !entry.name.startsWith(".")) &&
        (!query || entry.name.toLocaleLowerCase().includes(query)),
    );
  }, [
    effectiveSearchEngine,
    entries,
    searchActive,
    searchQuery,
    searchResults,
    showHidden,
  ]);
  const selectedEntries = useMemo(
    () => visibleEntries.filter((entry) => selectedPaths.has(entry.path)),
    [selectedPaths, visibleEntries],
  );
  const primarySelected = selectedEntries[selectedEntries.length - 1] ?? null;

  useEffect(() => {
    if (focusedPaneId !== id) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.code === "KeyF") {
        event.preventDefault();
        event.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (editing) {
        if (event.code === "Escape" && target === searchRef.current) {
          event.preventDefault();
          searchReqIdRef.current += 1;
          setSearchQuery("");
          setSearchResults([]);
          setSearchActive(false);
          setSearching(false);
          setSearchError(null);
          setSearchTruncated(false);
          searchRef.current?.blur();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPaths(new Set(visibleEntries.map((entry) => entry.path)));
        setSelectionAnchor(visibleEntries[0]?.path ?? null);
      } else if (event.code === "Escape") {
        setSelectedPaths(new Set());
        setSelectionAnchor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusedPaneId, id, visibleEntries]);

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
        void doDownloadEntries([entry]);
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
      }, language)
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

  async function downloadEntry(
    entry: FileEntry,
    local: string,
    localName: string | null = null,
  ) {
    const id = crypto.randomUUID();
    startTransfer({
      id,
      name: entry.name,
      kind: "download",
      total: entry.isDir ? 0 : entry.size,
    });
    try {
      await download(id, entry.path, local, entry.isDir, localName);
      finishTransfer(id);
      logOp({ type: "download", remotePath: entry.path, isDir: entry.isDir });
      return true;
    } catch (err) {
      finishTransfer(
        id,
        typeof err === "string" ? err : t("files.error.download")
      );
      return false;
    }
  }

  async function doDownloadEntries(items: FileEntry[]) {
    if (items.length === 0) return;

    if (items.length === 1 && !items[0].isDir) {
      const local = await save({ defaultPath: items[0].name });
      if (local) await downloadEntry(items[0], local);
      return;
    }

    const destination = await open({
      title: t("files.download.chooseFolder"),
      directory: true,
      multiple: false,
    });
    if (!destination || Array.isArray(destination)) return;
    const batchId = crypto.randomUUID();
    const showBatch = items.length > 1;
    if (showBatch) startBatch(batchId, items.length, "download");
    for (const item of items) {
      await downloadEntry(item, destination, item.name);
      if (showBatch) advanceBatch(batchId);
    }
  }

  function doRename(entry: FileEntry) {
    setPrompt({
      title: t("common.rename"),
      initialValue: entry.name,
      onConfirm: (newName) => {
        setPrompt(null);
        if (newName === entry.name) return;
        // Search results may come from a nested directory. Rename in place
        // rather than accidentally moving the item into the search root.
        const to = joinPath(parentPath(entry.path), newName);
        runOp(() => rename(entry.path, to), {
          type: "move",
          from: entry.path,
          to,
        });
      },
    });
  }

  function doDeleteEntries(items: FileEntry[]) {
    if (items.length === 0) return;
    const single = items.length === 1 ? items[0] : null;
    setConfirm({
      title: single
        ? single.isDir
          ? t("files.deleteFolder.title")
          : t("files.deleteFile.title")
        : t("files.deleteMany.title", { count: items.length }),
      confirmLabel: t("common.delete"),
      danger: true,
      message: (
        <>
          {single
            ? single.isDir
              ? t("files.deleteFolder.message", { name: single.name })
              : t("files.deleteFile.message", { name: single.name })
            : t("files.deleteMany.message", { count: items.length })}
          <br />{t("files.delete.irreversible")}
        </>
      ),
      onConfirm: () => {
        setConfirm(null);
        void (async () => {
          let failed = 0;
          let completed = 0;
          for (const item of items) {
            try {
              await deletePath(item.path, item.isDir);
              logOp({ type: "delete", path: item.path, isDir: item.isDir });
              completed += 1;
            } catch {
              failed += 1;
            }
          }
          if (completed > 0) bumpFs();
          setSelectedPaths(new Set());
          setSelectionAnchor(null);
          if (failed > 0) {
            setOpError(t("files.error.batch", { failed, total: items.length }));
          }
        })();
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

  function doCopy(items: FileEntry[]) {
    if (items.length === 0) return;
    setClipboard(
      items.map((entry) => ({
        name: entry.name,
        path: entry.path,
        isDir: entry.isDir,
      })),
    );
  }

  /** Paste clipboard items into the current directory (avoids name clashes). */
  function doPaste() {
    if (!clipboard || clipboard.length === 0) return;
    if (
      clipboard.some(
        (item) =>
          item.isDir &&
          (currentPath === item.path || currentPath.startsWith(item.path + "/")),
      )
    ) {
      setOpError(t("errors.copyIntoSelf"));
      return;
    }
    const taken = new Set(entries.map((e) => e.name));
    void (async () => {
      let failed = 0;
      let completed = 0;
      for (const item of clipboard) {
        let name = item.name;
        if (taken.has(name)) {
          let candidate = t("files.copySuffix", { name });
          let index = 2;
          while (taken.has(candidate)) {
            candidate = t("files.copyNumberedSuffix", { name, number: index++ });
          }
          name = candidate;
        }
        taken.add(name);
        const to = joinPath(currentPath, name);
        try {
          await copyPath(item.path, to);
          logOp({ type: "copy", from: item.path, to });
          completed += 1;
        } catch {
          failed += 1;
        }
      }
      if (completed > 0) bumpFs();
      if (failed > 0) {
        setOpError(t("files.error.batch", { failed, total: clipboard.length }));
      }
    })();
  }

  // Right-click a file/folder.
  function openMenu(e: React.MouseEvent, entry: FileEntry) {
    e.preventDefault();
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setSelectionAnchor(entry.path);
    }
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }

  // Right-click empty space.
  function openEmptyMenu(e: React.MouseEvent) {
    e.preventDefault();
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
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
      if (clipboard) {
        items.push({
          label:
            clipboard.length === 1
              ? t("common.pasteNamed", { name: clipboard[0].name })
              : t("common.pasteCount", { count: clipboard.length }),
          onClick: doPaste,
        });
      }
      return items;
    }
    const entry = menu.entry;
    const targets = selectedEntries.length > 0 ? selectedEntries : [entry];
    const items: MenuItem[] = [
      { label: t("common.copy"), onClick: () => doCopy(targets) },
      { label: t("common.download"), onClick: () => void doDownloadEntries(targets) },
    ];
    if (targets.length === 1) {
      items.push({ label: t("common.rename"), onClick: () => doRename(targets[0]) });
    }
    items.push({
      label: t("common.delete"),
      danger: true,
      onClick: () => doDeleteEntries(targets),
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, clipboard, selectedEntries, t]);

  // Menu-bar dropdown contents.
  const fileMenu: DropItem[] = [
    { label: t("files.newFile"), onClick: doNewFile },
    { label: t("files.newFolder"), onClick: doNewFolder },
    {
      label: t("common.download"),
      onClick: () => void doDownloadEntries(selectedEntries),
      disabled: selectedEntries.length === 0,
    },
    { label: t("common.refresh"), onClick: refreshCurrentView },
    { type: "separator" },
    { label: t("files.disconnect"), onClick: handleDisconnect },
  ];
  const editMenu: DropItem[] = [
    {
      label: t("common.copy"),
      onClick: () => doCopy(selectedEntries),
      disabled: selectedEntries.length === 0,
    },
    {
      label: clipboard
        ? clipboard.length === 1
          ? t("common.pasteNamed", { name: clipboard[0].name })
          : t("common.pasteCount", { count: clipboard.length })
        : t("common.paste"),
      onClick: doPaste,
      disabled: !clipboard,
    },
    { type: "separator" },
    {
      label: t("common.rename"),
      onClick: () => primarySelected && doRename(primarySelected),
      disabled: selectedEntries.length !== 1,
    },
    {
      label: t("common.delete"),
      danger: true,
      onClick: () => doDeleteEntries(selectedEntries),
      disabled: selectedEntries.length === 0,
    },
  ];
  const viewMenu: DropItem[] = [
    { type: "check", label: t("files.view.list"), checked: viewMode === "list", onClick: () => setViewMode("list") },
    { type: "check", label: t("files.view.details"), checked: viewMode === "details", onClick: () => setViewMode("details") },
    { type: "check", label: t("files.view.grid"), checked: viewMode === "grid", onClick: () => setViewMode("grid") },
    { type: "separator" },
    {
      type: "check",
      label: t("files.view.hidden"),
      checked: showHidden,
      onClick: () => {
        const next = !showHidden;
        setShowHidden(next);
        setSelectedPaths(new Set());
        setSelectionAnchor(null);
        if (searchActive && effectiveSearchEngine !== "filter") {
          void runRemoteSearch(searchQuery, next);
        }
      },
    },
  ];

  usePaneMenuRegistration(id, [
    { label: t("common.file"), items: fileMenu },
    { label: t("common.edit"), items: editMenu },
    { label: t("common.view"), items: viewMenu },
  ]);

  const atRoot = currentPath === "/";
  function refreshCurrentView() {
    if (error) {
      void loadDir(currentPath);
      return;
    }
    reloadSilently();
    if (searchActive && effectiveSearchEngine !== "filter") {
      void runRemoteSearch();
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col bg-transparent text-slate-100"
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
        <ToolButton label={t("common.refresh")} onClick={refreshCurrentView}>
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

        <div className="relative ml-2 w-40 min-w-24 max-w-[40%] shrink">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500"
          >
            ⌕
          </span>
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={(event) => {
              searchReqIdRef.current += 1;
              setSearchQuery(event.target.value);
              setSelectedPaths(new Set());
              setSelectionAnchor(null);
              if (effectiveSearchEngine !== "filter") {
                setSearchResults([]);
                setSearchActive(false);
                setSearching(false);
                setSearchError(null);
                setSearchTruncated(false);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                effectiveSearchEngine !== "filter"
              ) {
                event.preventDefault();
                void runRemoteSearch();
              }
            }}
            placeholder={
              effectiveSearchEngine === "filter"
                ? t("files.search.placeholder")
                : t("files.search.remotePlaceholder", {
                    engine: effectiveSearchEngine,
                  })
            }
            aria-label={t("files.search.label")}
            aria-busy={searching}
            className={`w-full rounded-md border border-ink-700 bg-ink-900 py-1 pl-6 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-600 focus:ring-1 focus:ring-sky-600/40 ${
              effectiveSearchEngine === "filter" ? "pr-2" : "pr-7"
            }`}
          />
          {effectiveSearchEngine !== "filter" && (
            <button
              onClick={() => void runRemoteSearch()}
              disabled={searching || !searchQuery.trim()}
              title={t("files.search.run", { engine: effectiveSearchEngine })}
              aria-label={t("files.search.run", { engine: effectiveSearchEngine })}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-sky-300 disabled:opacity-40"
            >
              {searching ? "…" : "↵"}
            </button>
          )}
        </div>
      </div>

      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-auto"
        onMouseDown={onSelectionAreaMouseDown}
        onContextMenu={openEmptyMenu}
        data-drop-dir={currentPath}
      >
        {loading ? (
          <CenterMessage>{t("files.loading")}</CenterMessage>
        ) : searching ? (
          <CenterMessage>
            {t("files.search.searching", { engine: effectiveSearchEngine })}
          </CenterMessage>
        ) : error ? (
          <CenterMessage>
            <span className="text-red-300">{error}</span>
          </CenterMessage>
        ) : searchError ? (
          <CenterMessage>
            <span className="text-red-300">{searchError}</span>
          </CenterMessage>
        ) : visibleEntries.length === 0 ? (
          <CenterMessage>
            {searchActive
              ? t("files.search.empty")
              : entries.length === 0
              ? t("files.empty")
              : effectiveSearchEngine === "filter" && searchQuery.trim()
                ? t("files.search.empty")
              : t("files.noVisible")}
          </CenterMessage>
        ) : (
          <FileView
            entries={visibleEntries}
            viewMode={viewMode}
            selectedPaths={selectedPaths}
            onOpen={openEntry}
            onSelect={selectEntry}
            onContextMenu={openMenu}
            onItemMouseDown={onItemMouseDown}
            searchRoot={searchActive ? currentPath : null}
          />
        )}
      </div>

      {searchActive && !searching && !searchError && (
        <div className="flex shrink-0 items-center justify-between border-t border-ink-700/60 bg-ink-800/60 px-3 py-1 text-2xs text-slate-500">
          <span>
            {t("files.search.resultCount", { count: searchResults.length })}
          </span>
          {searchTruncated && (
            <span className="text-amber-400">
              {t("files.search.truncated", { count: 500 })}
            </span>
          )}
        </div>
      )}

      {selectedEntries.length > 0 && (
        <div className="shrink-0 border-t border-ink-700/60 bg-ink-800/60 px-3 py-1 text-2xs text-slate-400">
          {t("files.selected.count", { count: selectedEntries.length })}
        </div>
      )}

      {selectionRect && (
        <div
          className="pointer-events-none absolute z-30 border border-sky-400 bg-sky-500/15"
          style={selectionRect}
        />
      )}

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
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-950/90 px-4 py-2.5 text-sm text-red-200 shadow-popover">
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
      className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-ink-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
