export const ko = {
  "settings.language.label": "언어",
  "settings.language.description": "앱 인터페이스에 사용할 언어를 선택합니다.",
  "language.system": "시스템 설정",
  "language.ko": "한국어",
  "language.en": "English",
} as const;

export type TranslationKey = keyof typeof ko;
