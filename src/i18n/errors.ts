import { isTranslationKey, translate, type SupportedLanguage } from "./translate";

const ERROR_PREFIX = "sshland:error:";

function currentLanguage(): SupportedLanguage {
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  if (typeof navigator !== "undefined") {
    return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  return "en";
}

/** Convert a backend error code into the current interface language. */
export function localizeBackendError(error: unknown): string {
  const raw = typeof error === "string" ? error : String(error);
  if (!raw.startsWith(ERROR_PREFIX)) return raw;

  const payload = raw.slice(ERROR_PREFIX.length);
  const separator = payload.indexOf("|");
  const key = separator >= 0 ? payload.slice(0, separator) : payload;
  const detail = separator >= 0 ? payload.slice(separator + 1) : "";
  if (!isTranslationKey(key)) return raw;
  return translate(currentLanguage(), key, detail ? { detail } : undefined);
}
