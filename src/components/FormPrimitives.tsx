import {
  ButtonHTMLAttributes,
  forwardRef,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useI18n } from "../i18n";

export function FormField({
  id,
  label,
  hint,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        {optional && <span className="text-2xs text-slate-500">{t("common.optional")}</span>}
      </div>
      {children}
      {(error || hint) && (
        <p
          id={`${id}-message`}
          className={`mt-1.5 text-xs ${
            error ? "text-red-300" : "text-slate-500"
          }`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function TextInput({ className = "", invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`w-full rounded-lg border bg-ink-900 px-3.5 py-2.5 text-sm text-slate-100 shadow-control outline-none transition-colors duration-fast ease-spatial placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60 ${
        invalid
          ? "border-red-500/70 focus:border-red-400 focus:ring-2 focus:ring-red-500/20"
          : "border-ink-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
      } ${className}`}
      {...props}
    />
  );
});

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  busy?: boolean;
}) {
  const variantClass =
    variant === "primary"
      ? "bg-sky-600 text-white hover:bg-sky-500 focus-visible:ring-sky-400/50"
      : "border border-ink-700 bg-ink-800 text-slate-300 hover:bg-ink-700 focus-visible:ring-sky-500/40";

  return (
    <button
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-control outline-none transition-colors duration-fast ease-spatial focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-60 ${variantClass} ${className}`}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }

    const next = options[nextIndex];
    onChange(next.value);
    requestAnimationFrame(() => {
      document.getElementById(`${id}-${next.value}`)?.focus();
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-lg border border-ink-700/70 bg-ink-900 p-1"
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            id={`${id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rounded-md px-3 py-2 text-sm font-medium outline-none transition-all duration-fast ease-spatial focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "bg-ink-700 text-slate-100 shadow-control"
                : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function InlineNotice({
  tone,
  children,
}: {
  tone: "error" | "progress";
  children: ReactNode;
}) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
        error
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : "border-sky-500/25 bg-sky-500/10 text-sky-200"
      }`}
    >
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span>{children}</span>
    </div>
  );
}

export function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
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
