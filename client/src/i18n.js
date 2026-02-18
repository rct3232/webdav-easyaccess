import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from './locales/ko.json';
import en from './locales/en.json';

const resources = {
  ko: { translation: ko },
  en: { translation: en },
};

const getInitialLanguage = () => {
  if (typeof navigator === 'undefined') return 'ko';
  const lang = navigator.language || navigator.userLanguage;
  if (lang && (lang.startsWith('ko') || lang.startsWith('en'))) {
    return lang.startsWith('ko') ? 'ko' : 'en';
  }
  return 'ko';
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'ko',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
