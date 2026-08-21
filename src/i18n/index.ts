import { useCallback } from "react";
import { useSettings, type AppLanguage } from "../lib/settings";
import { en } from "./en";
import { ko, type TranslationKey } from "./ko";

export type SupportedLanguage = Exclude<AppLanguage, "system">;
export type TranslationParams = Record<string, string | number>;
export type Translator = (key: TranslationKey, params?: TranslationParams) => string;

const dictionaries = { ko, en } as const;

export function resolveLanguage(language: AppLanguage): SupportedLanguage {
  if (language !== "system") return language;
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")) {
    return "ko";
  }
  return "en";
}

export function translate(
  language: SupportedLanguage,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const template = dictionaries[language][key] ?? ko[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function useI18n() {
  const languageSetting = useSettings((state) => state.settings.language);
  const language = resolveLanguage(languageSetting);
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
    [language],
  );

  return { language, languageSetting, t };
}
