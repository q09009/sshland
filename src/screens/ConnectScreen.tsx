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
    if (authKind === "password" && !password) return "비밀번호를 입력해주세요.";
    if (authKind === "key" && !keyPath) return "개인키 파일을 선택해주세요.";
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
      enterFiles({
        host: host.trim(),
        username: username.trim(),
        home: result.home,
      });
    } catch (err) {
      // Commands reject with a friendly Korean string.
      setError(
        typeof err === "string" ? err : "접속에 실패했어요. 다시 시도해주세요."
      );
    } finally {
      setBusy(false);
    }
  }

  const keyFileName = keyPath ? keyPath.split(/[\\/]/).pop() : null;

  // Cardless workspace surface: the form sits directly on the page ground
  // (no card), and the auth section cross-slides between password and key.
  const isPassword = authKind === "password";
  const slideBase = "absolute inset-0 transition-[opacity,transform] duration-150";
  const passGroupClass = `${slideBase} ${
    isPassword ? "opacity-100 translate-x-0" : "pointer-events-none -translate-x-2 opacity-0"
  }`;
  const keyGroupClass = `${slideBase} ${
    isPassword ? "pointer-events-none translate-x-2 opacity-0" : "translate-x-0 opacity-100"
  }`;

  return (
    <div className="flex h-full items-center justify-center bg-ink-900 px-10 pb-14 pt-10 text-slate-100">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[440px] flex-col gap-5">
        {/* Wordmark */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg text-sky-500">&gt;_</span>
            <span className="text-lg font-medium">sshland</span>
          </div>
          <hr className="hr m-0" />
        </div>

        <div className="flex flex-col gap-4">
          {/* Destination group */}
          <div>
            <span className="mb-2 block text-2xs text-slate-500">목적지</span>
            <div className="flex gap-3">
              <div className="flex-1">
                <Field label="서버 주소">
                  <input
                    className={inputClass}
                    placeholder="예: 192.168.0.10"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    autoFocus
                    spellCheck={false}
                  />
                </Field>
              </div>
              <div className="w-[92px]">
                <Field label="포트">
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* Username */}
          <Field label="사용자명">
            <input
              className={inputClass}
              placeholder="예: root"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              spellCheck={false}
            />
          </Field>

          {/* Auth method segmented toggle */}
          <div>
            <span id="auth-label" className="mb-1.5 block text-xs font-medium text-slate-400">
              인증 방식
            </span>
            <div
              role="radiogroup"
              aria-labelledby="auth-label"
              className="grid grid-cols-2 gap-1 rounded-lg bg-ink-900 p-1"
            >
              <SegButton active={isPassword} onClick={() => setAuthKind("password")}>
                비밀번호
              </SegButton>
              <SegButton active={!isPassword} onClick={() => setAuthKind("key")}>
                개인키
              </SegButton>
            </div>
          </div>

          {/* Cross-sliding auth credential area */}
          <div className="relative transition-[height] duration-150" style={{ height: isPassword ? 76 : 172 }}>
            <div className={passGroupClass} aria-hidden={!isPassword}>
              <Field label="비밀번호">
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  tabIndex={isPassword ? 0 : -1}
                />
              </Field>
            </div>

            <div className={keyGroupClass} aria-hidden={isPassword}>
              <div className="flex flex-col gap-3.5">
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-slate-400">
                    개인키 파일
                  </span>
                  <button
                    type="button"
                    onClick={pickKeyFile}
                    title={keyPath || undefined}
                    tabIndex={isPassword ? -1 : 0}
                    className="flex w-full items-center gap-2 truncate rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/50"
                  >
                    <FolderIcon />
                    <span className="truncate">
                      {keyFileName ?? (
                        <span className="text-slate-500">파일 선택…</span>
                      )}
                    </span>
                  </button>
                </div>
                <Field label="암호 (선택 사항)">
                  <input
                    className={inputClass}
                    type="password"
                    placeholder="없으면 비워두세요"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    autoComplete="off"
                    tabIndex={isPassword ? -1 : 0}
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* Security note */}
          <p className="m-0 flex items-center gap-2 text-2xs text-slate-500">
            <LockIcon />
            비밀번호는 저장하지 않아요. 다음에는 서버 주소·포트·사용자명만
            자동으로 채워드려요.
          </p>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500 px-4 py-2 font-medium text-sky-500 transition hover:bg-sky-500/10 active:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? (
              <>
                <Spinner />
                접속하는 중…
              </>
            ) : (
              <>
                접속하기
                <ArrowIcon />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-400">{label}</span>
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
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-ink-700 text-sky-400 shadow" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
      <path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 256 256"
      fill="currentColor"
      className="shrink-0 text-slate-500"
    >
      <path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" className="shrink-0">
      <path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96Z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 256 256" fill="none" className="animate-spin">
      <circle cx="128" cy="128" r="96" stroke="currentColor" strokeWidth="20" opacity=".25" />
      <path d="M128,32a96,96,0,0,1,96,96" stroke="currentColor" strokeWidth="20" fill="none" />
    </svg>
  );
}
