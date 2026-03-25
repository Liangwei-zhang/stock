import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import zhTW from './locales/zh-TW';
import en from './locales/en';

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      en:      { translation: en },
    },
    fallbackLng: 'zh-TW',
    supportedLngs: ['zh-TW', 'en'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18n_language',
    },
  });

export default i18next;
