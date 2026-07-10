import { useEffect } from "react";
import { disconnect } from "../api";
import { useAppStore } from "../store";
import { formatDate, formatSize } from "../lib/format";

export default function FilesScreen() {
  const connection = useAppStore((s) => s.connection);
  const currentPath = useAppStore((s) => s.currentPath);
  const entries = useAppStore((s) => s.entries);
  const loading = useAppStore((s) => s.filesLoading);
  const error = useAppStore((s) => s.filesError);
  const loadDir = useAppStore((s) => s.loadDir);
  const returnToConnect = useAppStore((s) => s.returnToConnect);

  // Load the starting directory on entry.
  useEffect(() => {
    if (connection) loadDir(connection.home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect() {
    try {
      await disconnect();
    } finally {
      returnToConnect();
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-900 text-slate-100">
      <header className="flex items-center justify-between gap-3 border-b border-ink-700/60 bg-ink-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {connection?.username}@{connection?.host}
          </p>
          <p className="truncate text-xs text-slate-400">{currentPath}</p>
        </div>
        <button
          onClick={handleDisconnect}
          className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500/50 hover:text-red-300"
        >
          접속 끊기
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <CenterMessage>불러오는 중…</CenterMessage>
        ) : error ? (
          <CenterMessage>
            <span className="text-red-300">{error}</span>
          </CenterMessage>
        ) : entries.length === 0 ? (
          <CenterMessage>이 폴더는 비어 있어요.</CenterMessage>
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
              {entries.map((entry) => (
                <tr
                  key={entry.path}
                  className="border-b border-ink-800/60 hover:bg-ink-800/60"
                >
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <FileIcon
                        isDir={entry.isDir}
                        isSymlink={entry.isSymlink}
                      />
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

function FileIcon({
  isDir,
  isSymlink,
}: {
  isDir: boolean;
  isSymlink: boolean;
}) {
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
