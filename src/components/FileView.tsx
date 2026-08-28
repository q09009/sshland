import { FileEntry } from "../api";
import { ViewMode } from "../store";
import { formatDate, formatSize } from "../lib/format";
import { useI18n } from "../i18n";

interface Props {
  entries: FileEntry[];
  viewMode: ViewMode;
  selectedPaths: ReadonlySet<string>;
  /** Search root when entries may come from nested folders. */
  searchRoot?: string | null;
  onOpen: (entry: FileEntry) => void;
  onSelect: (entry: FileEntry, event: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  /** Begin a potential drag-to-move of an item. */
  onItemMouseDown: (entry: FileEntry, e: React.MouseEvent) => void;
}

/** Renders the current directory in the selected layout. */
export default function FileView(props: Props) {
  switch (props.viewMode) {
    case "grid":
      return <GridView {...props} />;
    case "list":
      return <ListView {...props} />;
    default:
      return <DetailsView {...props} />;
  }
}

/** Common row props: click selects, double-click opens, folders are drop
 *  targets (data-drop-dir), and mousedown may start a drag-to-move. */
function rowHandlers(entry: FileEntry, p: Props) {
  return {
    onClick: (event: React.MouseEvent) => p.onSelect(entry, event),
    onDoubleClick: () => p.onOpen(entry),
    onMouseDown: (e: React.MouseEvent) => p.onItemMouseDown(entry, e),
    onContextMenu: (e: React.MouseEvent) => {
      e.stopPropagation();
      p.onContextMenu(e, entry);
    },
    // Folders accept dropped items.
    "data-drop-dir": entry.isDir ? entry.path : undefined,
    "data-file-path": entry.path,
    "aria-selected": p.selectedPaths.has(entry.path),
  };
}

/** Windows-style "Details": a table with size, date, and permissions. */
function DetailsView(props: Props) {
  const { entries, selectedPaths } = props;
  const { t } = useI18n();
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-ink-800/95 text-xs text-slate-400 backdrop-blur">
        <tr className="border-b border-ink-700/60">
          <th className="px-4 py-2 text-left font-medium">{t("files.column.name")}</th>
          <th className="w-28 px-4 py-2 text-right font-medium">{t("files.column.size")}</th>
          <th className="w-40 px-4 py-2 text-left font-medium">{t("files.column.modified")}</th>
          <th className="w-32 px-4 py-2 text-left font-medium">{t("files.column.permissions")}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr
            key={entry.path}
            {...rowHandlers(entry, props)}
            className={`border-b border-ink-800/60 ${
              selectedPaths.has(entry.path)
                ? "bg-sky-500/20"
                : "hover:bg-ink-800/60"
            } ${entry.isDir ? "cursor-pointer" : ""}`}
          >
            <td className="px-4 py-1.5">
              <div className="flex items-center gap-2">
                <FileIcon entry={entry} className="h-4 w-4" />
                <div className="min-w-0">
                  <div
                    className={`truncate ${
                      entry.isDir ? "text-slate-100" : "text-slate-300"
                    }`}
                  >
                    {entry.name}
                  </div>
                  <EntryLocation entry={entry} root={props.searchRoot} />
                </div>
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
  );
}

/** Compact "List": small icon + name in a few wrapping columns. */
function ListView(props: Props) {
  const { entries, selectedPaths } = props;
  return (
    <div className="grid grid-cols-2 gap-x-4 p-2 sm:grid-cols-3 lg:grid-cols-4">
      {entries.map((entry) => (
        <div
          key={entry.path}
          {...rowHandlers(entry, props)}
          className={`flex items-center gap-2 rounded px-2 py-1.5 ${
            selectedPaths.has(entry.path) ? "bg-sky-500/20" : "hover:bg-ink-800/60"
          } ${entry.isDir ? "cursor-pointer" : ""}`}
        >
          <FileIcon entry={entry} className="h-4 w-4" />
          <div className="min-w-0">
            <div
              className={`truncate text-sm ${
                entry.isDir ? "text-slate-100" : "text-slate-300"
              }`}
            >
              {entry.name}
            </div>
            <EntryLocation entry={entry} root={props.searchRoot} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Large icons: tiles with a big icon, name, and size for files. */
function GridView(props: Props) {
  const { entries, selectedPaths } = props;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 p-3">
      {entries.map((entry) => (
        <div
          key={entry.path}
          {...rowHandlers(entry, props)}
          title={entry.name}
          className={`flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center ${
            selectedPaths.has(entry.path) ? "bg-sky-500/20" : "hover:bg-ink-800/60"
          } ${entry.isDir ? "cursor-pointer" : ""}`}
        >
          <FileIcon entry={entry} className="h-12 w-12" />
          <span className="line-clamp-2 w-full break-words text-xs leading-tight text-slate-200">
            {entry.name}
          </span>
          <EntryLocation
            entry={entry}
            root={props.searchRoot}
            className="max-w-full text-center"
          />
          {!entry.isDir && (
            <span className="text-2xs text-slate-500">
              {formatSize(entry.size, entry.isDir)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function EntryLocation({
  entry,
  root,
  className = "",
}: {
  entry: FileEntry;
  root?: string | null;
  className?: string;
}) {
  if (!root) return null;
  const slash = entry.path.lastIndexOf("/");
  const parent = slash <= 0 ? "/" : entry.path.slice(0, slash);
  const normalizedRoot = root === "/" ? "/" : root.replace(/\/+$/, "");
  const location =
    parent === normalizedRoot
      ? "."
      : normalizedRoot === "/" && parent.startsWith("/")
        ? parent.slice(1)
        : parent.startsWith(normalizedRoot + "/")
          ? parent.slice(normalizedRoot.length + 1)
          : parent;
  return (
    <div
      className={`truncate text-2xs text-slate-600 ${className}`}
      title={entry.path}
    >
      {location || "."}
    </div>
  );
}

/** Shared file/folder/symlink glyph, sized by `className`. */
function FileIcon({
  entry,
  className,
}: {
  entry: FileEntry;
  className: string;
}) {
  if (entry.isDir) {
    return (
      <svg
        className={`shrink-0 text-sky-400 ${className}`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
      </svg>
    );
  }
  return (
    <svg
      className={`shrink-0 ${entry.isSymlink ? "text-symlink" : "text-slate-500"} ${className}`}
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
