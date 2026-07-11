import { FormEvent, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { connect } from "../api";
import { useAppStore } from "../store";
import { useSettings } from "../lib/settings";

type AuthKind = "password" | "key";

export default function ConnectScreen() {
  const enterFiles = useAppStore((s) => s.enterFiles);
  const notice = useAppStore((s) => s.connectNotice);
  const clearNotice = useAppStore((s) => s.clearNotice);
  const settingsLoaded = useSettings((s) => s.loaded);
  const lastConnection = useSettings((s) => s.settings.lastConnection);
  const saveSetting = useSettings((s) => s.set);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface a "connection dropped" notice once, then clear it from the store.
  useEffect(() => {
    if (notice) {
      setError(notice);
      clearNotice();
    }
  }, [notice, clearNotice]);

  // Pre-fill the form from the last successful connection (secrets excluded)
  // once settings finish loading. Only once, so it never clobbers user typing.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || prefilledRef.current || !lastConnection) return;
    prefilledRef.current = true;
    setHost(lastConnection.host);
    setPort(String(lastConnection.port));
    setUsername(lastConnection.username);
    setAuthKind(lastConnection.authKind);
    setKeyPath(lastConnection.keyPath);
  }, [settingsLoaded, lastConnection]);

  async function pickKeyFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "개인키 파일 선택",
    });
    if (typeof selected === "string") setKeyPath(selected);
  }

  function validate(): string | null {
    if (!host.trim()) return "서버 주소를 입력해주세요.";
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      return "포트 번호는 1부터 65535 사이여야 해요.";
    if (!username.trim()) return "사용자명을 입력해주세요.";
    if (authKind === "password" && !password)
      return "비밀번호를 입력해주세요.";
    if (authKind === "key" && !keyPath)
      return "개인키 파일을 선택해주세요.";
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await connect({
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        auth:
          authKind === "password"
            ? { type: "password", password }
            : {
                type: "key",
                path: keyPath,
                passphrase: passphrase || undefined,
              },
      });
      // Remember this connection for next time — never the password/passphrase.
      saveSetting("lastConnection", {
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        authKind,
        keyPath: authKind === "key" ? keyPath : "",
      });
      enterFiles({ host: host.trim(), username: username.trim(), home: result.home });
    } catch (err) {
      // Commands reject with a friendly Korean string.
      setError(typeof err === "string" ? err : "접속에 실패했어요. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  const keyFileName = keyPath ? keyPath.split(/[\\/]/).pop() : null;

  return (
    <div className="flex h-full items-center justify-center bg-ink-900 p-6 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-ink-700/60 bg-ink-800 p-7 shadow-2xl"
      >
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">SSHland</h1>
          <p className="mt-1 text-sm text-slate-400">SSH 서버에 접속해요</p>
        </div>

        <div className="space-y-4">
          <Field label="서버 주소">
            <input
              className={inputClass}
              placeholder="예: 192.168.0.10 또는 example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              autoFocus
              spellCheck={false}
            />
          </Field>

          <div className="flex gap-3">
            <div className="w-24">
              <Field label="포트">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={port}
                  onChange={(e) =>
                    setPort(e.target.value.replace(/[^0-9]/g, ""))
                  }
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="사용자명">
                <input
                  className={inputClass}
                  placeholder="예: root"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-400">
              인증 방식
            </span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink-900 p-1">
              <SegButton
                active={authKind === "password"}
                onClick={() => setAuthKind("password")}
              >
                비밀번호
              </SegButton>
              <SegButton
                active={authKind === "key"}
                onClick={() => setAuthKind("key")}
              >
                개인키 파일
              </SegButton>
            </div>
          </div>

          {authKind === "password" ? (
            <Field label="비밀번호">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </Field>
          ) : (
            <div className="space-y-3">
              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-400">
                  개인키 파일
                </span>
                <button
                  type="button"
                  onClick={pickKeyFile}
                  className="w-full truncate rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/50"
                  title={keyPath || undefined}
                >
                  {keyFileName ? (
                    <span className="text-slate-100">{keyFileName}</span>
                  ) : (
                    <span className="text-slate-500">파일 선택…</span>
                  )}
                </button>
              </div>
              <Field label="키 암호 (없으면 비워두세요)">
                <input
                  className={inputClass}
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Spinner />}
          {busy ? "접속하는 중…" : "접속하기"}
        </button>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-ink-700 text-white shadow"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-white"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
