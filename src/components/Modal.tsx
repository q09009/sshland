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
