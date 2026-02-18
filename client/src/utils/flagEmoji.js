const LANG_TO_COUNTRY = { ko: 'KR', en: 'US' };

/**
 * 언어 코드를 국기 이모지로 변환 (패키지 없이 Unicode Regional Indicator 사용)
 * @param {string} langCode - 언어 코드 (ko, en 등)
 * @returns {string} 국기 이모지 (예: 🇰🇷, 🇺🇸)
 */
export function getFlagEmoji(langCode) {
  const country = LANG_TO_COUNTRY[langCode] || String(langCode || '').toUpperCase();
  if (country.length !== 2) return '';
  const codePoints = country
    .toUpperCase()
    .split('')
    .map((char) => 0x1f1e6 - 65 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
