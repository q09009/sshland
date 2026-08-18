import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-ink-700 bg-ink-800 p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

/** A yes/no confirmation, used for destructive actions like delete. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "확인",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <Backdrop>
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      <div className="mt-2 text-sm text-slate-300">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
        >
          취소
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-lg px-3.5 py-2 text-sm font-medium text-white ${
            danger ? "bg-red-600 hover:bg-red-500" : "bg-sky-600 hover:bg-sky-500"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Backdrop>
  );
}

/**
 * Three-way prompt shown when closing an editor with unsaved changes:
 * save-and-close, discard-and-close, or cancel.
 */
export function UnsavedChangesDialog({
  fileName,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: {
  fileName: string;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <Backdrop>
      <h2 className="text-base font-semibold text-slate-100">
        저장하지 않은 변경사항이 있어요
      </h2>
      <div className="mt-2 text-sm text-slate-300">
        <span className="font-medium text-slate-100">{fileName}</span> 의 변경사항을
        저장할까요? 저장하지 않으면 변경한 내용이 사라져요.
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
        >
          취소
        </button>
        <button
          onClick={onDiscard}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20"
        >
          저장 안 함
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </Backdrop>
  );
}

/** Prevents a remote file changed elsewhere from being overwritten silently. */
export function FileConflictDialog({
  fileName,
  busy,
  onReload,
  onOverwrite,
  onCancel,
}: {
  fileName: string;
  busy?: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <Backdrop>
      <h2 className="text-base font-semibold text-slate-100">
        서버의 파일이 변경됐어요
      </h2>
      <div className="mt-2 text-sm text-slate-300">
        <span className="font-medium text-slate-100">{fileName}</span> 이 다른
        곳에서 수정됐어요. 서버 버전을 다시 불러오거나, 현재 편집 내용을 서버에
        덮어쓸 수 있어요.
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700 disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={onReload}
          disabled={busy}
          className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          서버 버전 불러오기
        </button>
        <button
          onClick={onOverwrite}
          disabled={busy}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        >
          {busy ? "저장 중…" : "내 내용으로 덮어쓰기"}
        </button>
      </div>
    </Backdrop>
  );
}

/**
 * Confirmation shown before killing a process from the dashboard process
 * manager. Offers a normal kill and a clearly-labeled force kill (-9); both are
 * destructive, so this always precedes sending any signal (like file deletion).
 */
export function KillProcessDialog({
  pid,
  name,
  busy,
  onKill,
  onForceKill,
  onCancel,
}: {
  pid: string;
  name: string;
  busy?: boolean;
  onKill: () => void;
  onForceKill: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <Backdrop>
      <h2 className="text-base font-semibold text-slate-100">
        프로세스를 종료할까요?
      </h2>
      <div className="mt-2 text-sm text-slate-300">
        <span className="font-mono text-slate-100">PID {pid}</span>
        <span className="mx-1 text-slate-500">·</span>
        <span className="break-all font-mono text-slate-100">{name}</span>
        <p className="mt-2 text-slate-400">
          먼저 정상 종료를 시도해보고, 응답이 없을 때만 강제 종료(-9)를 쓰는 걸
          권장해요.
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
        >
          취소
        </button>
        <button
          onClick={onForceKill}
          disabled={busy}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        >
          강제 종료 (-9)
        </button>
        <button
          onClick={onKill}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? "종료 중…" : "종료"}
        </button>
      </div>
    </Backdrop>
  );
}

/** A single-line text input dialog, used for rename / new folder. */
export function PromptDialog({
  title,
  initialValue = "",
  placeholder,
  confirmLabel = "확인",
  onConfirm,
  onCancel,
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus and pre-select the name (minus extension feel: select all is fine).
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <Backdrop>
      <form onSubmit={submit}>
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="mt-4 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
