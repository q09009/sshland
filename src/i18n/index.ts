import { useCallback } from "react";
import { useSettings } from "../lib/settings";
import type { TranslationKey } from "./ko";
import {
  resolveLanguage,
  translate,
  type TranslationParams,
} from "./translate";

export type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export * from "./translate";

export function useI18n() {
  const languageSetting = useSettings((state) => state.settings.language);
  const language = resolveLanguage(languageSetting);
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
    [language],
  );

  return { language, languageSetting, t };
}
