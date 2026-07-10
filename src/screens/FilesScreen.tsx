import { disconnect } from "../api";
import { useAppStore } from "../store";

// Placeholder shell for the file manager. The directory listing, navigation,
// and file operations are built in later steps.
export default function FilesScreen() {
  const connection = useAppStore((s) => s.connection);
  const returnToConnect = useAppStore((s) => s.returnToConnect);

  async function handleDisconnect() {
    try {
      await disconnect();
    } finally {
      returnToConnect();
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-ink-700/60 bg-ink-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {connection?.username}@{connection?.host}
          </p>
          <p className="truncate text-xs text-slate-400">{connection?.home}</p>
        </div>
        <button
          onClick={handleDisconnect}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500/50 hover:text-red-300"
        >
          접속 끊기
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center text-slate-500">
        파일 목록은 다음 단계에서 표시됩니다.
      </div>
    </div>
  );
}
