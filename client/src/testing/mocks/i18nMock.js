export function createI18nModuleMock(overrides = {}) {
  const t = overrides.t || ((key) => key);
  const i18n = {
    language: 'en',
    changeLanguage: jest.fn(),
    ...(overrides.i18n || {}),
  };

  return {
    useTranslation: () => ({ t, i18n }),
  };
}
