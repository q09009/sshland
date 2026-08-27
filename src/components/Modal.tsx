import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-ink-700 bg-surface-dialog p-6 shadow-dialog">
        {children}
      </div>
    </div>
  );
}

/** A yes/no confirmation, used for destructive actions like delete. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
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
  const { t } = useI18n();
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
          {t("common.cancel")}
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-lg px-3.5 py-2 text-sm font-medium text-on-accent ${
            danger ? "bg-red-600 hover:bg-red-500" : "bg-sky-600 hover:bg-sky-500"
          }`}
        >
          {confirmLabel ?? t("common.confirm")}
        </button>
      </div>
    </Backdrop>
  );
}

/** SSH server identity prompt shown before any login credentials are sent. */
export function HostKeyDialog({
  kind,
  host,
  port,
  algorithm,
  fingerprint,
  busy,
  onTrust,
  onForget,
  onCancel,
}: {
  kind: "unknownHost" | "hostKeyChanged";
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  busy?: boolean;
  onTrust: () => void;
  onForget: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const changed = kind === "hostKeyChanged";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <Backdrop>
      <div role="dialog" aria-modal="true" aria-labelledby="host-key-title">
        <h2
          id="host-key-title"
          className={`text-base font-semibold ${changed ? "text-red-300" : "text-slate-100"}`}
        >
          {t(changed ? "modal.hostKey.changedTitle" : "modal.hostKey.unknownTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {t(changed ? "modal.hostKey.changedMessage" : "modal.hostKey.unknownMessage")}
        </p>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 text-xs">
          <dt className="text-slate-500">{t("modal.hostKey.server")}</dt>
          <dd className="min-w-0 break-all font-mono text-slate-200">
            {host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`}
          </dd>
          <dt className="text-slate-500">{t("modal.hostKey.algorithm")}</dt>
          <dd className="font-mono text-slate-200">{algorithm}</dd>
          <dt className="text-slate-500">{t("modal.hostKey.fingerprint")}</dt>
          <dd className="min-w-0 select-all break-all font-mono text-sky-300">
            {fingerprint}
          </dd>
        </dl>

        <p className="mt-3 text-xs leading-5 text-slate-400">
          {t(changed ? "modal.hostKey.changedHelp" : "modal.hostKey.unknownHelp")}
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700 disabled:opacity-50"
          >
            {changed ? t("common.close") : t("common.cancel")}
          </button>
          {changed ? (
            <button
              type="button"
              onClick={onForget}
              disabled={busy}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              {busy ? t("modal.hostKey.forgetting") : t("modal.hostKey.forget")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onTrust}
              disabled={busy}
              className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? t("connect.connecting") : t("modal.hostKey.trust")}
            </button>
          )}
        </div>
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
  const { t } = useI18n();
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
        {t("modal.unsaved.title")}
      </h2>
      <div className="mt-2 text-sm text-slate-300">
        {t("modal.unsaved.message", { name: fileName })}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onDiscard}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20"
        >
          {t("modal.unsaved.discard")}
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
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
  const { t } = useI18n();
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
        {t("modal.conflict.title")}
      </h2>
      <div className="mt-2 text-sm text-slate-300">
        {t("modal.conflict.message", { name: fileName })}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700 disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onReload}
          disabled={busy}
          className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-sky-500 disabled:opacity-50"
        >
          {t("modal.conflict.reload")}
        </button>
        <button
          onClick={onOverwrite}
          disabled={busy}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        >
          {busy ? t("common.saving") : t("modal.conflict.overwrite")}
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
  const { t } = useI18n();
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
        {t("modal.kill.title")}
      </h2>
      <div className="mt-2 text-sm text-slate-300">
        <span className="font-mono text-slate-100">PID {pid}</span>
        <span className="mx-1 text-slate-500">·</span>
        <span className="break-all font-mono text-slate-100">{name}</span>
        <p className="mt-2 text-slate-400">
          {t("modal.kill.help")}
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-300 hover:bg-ink-700"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onForceKill}
          disabled={busy}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        >
          {t("modal.kill.force")}
        </button>
        <button
          onClick={onKill}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? t("modal.kill.killing") : t("modal.kill.kill")}
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
  confirmLabel,
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
  const { t } = useI18n();

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
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-sky-500 disabled:opacity-50"
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
