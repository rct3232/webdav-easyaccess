/**
 * flagEmoji tests: getFlagEmoji.
 * Pure function; verify return string per lang/country.
 * @see docs/spec/client/utils/flagEmoji.md
 * @see docs/TESTING_STRATEGY.md
 */
import { getFlagEmoji } from '../flagEmoji';

describe('flagEmoji', () => {
  describe('getFlagEmoji', () => {
    it('returns Korean flag for "ko"', () => {
      expect(getFlagEmoji('ko')).toBe('🇰🇷');
    });

    it('returns US flag for "en"', () => {
      expect(getFlagEmoji('en')).toBe('🇺🇸');
    });

    it('accepts 2-char country code (e.g. KR) and returns same flag as ko', () => {
      expect(getFlagEmoji('KR')).toBe('🇰🇷');
    });

    it('returns empty string for empty input', () => {
      expect(getFlagEmoji('')).toBe('');
    });

    it('returns empty string for null or undefined', () => {
      expect(getFlagEmoji(null)).toBe('');
      expect(getFlagEmoji(undefined)).toBe('');
    });

    it('returns empty string for invalid length (1 or 3+ chars)', () => {
      expect(getFlagEmoji('K')).toBe('');
      expect(getFlagEmoji('KOR')).toBe('');
    });
  });
});
