/**
 * format tests: formatFileSize, formatDate, formatDateOnly
 */
import { formatFileSize, formatDate, formatDateOnly } from '../format';

jest.mock('../../i18n', () => ({
  __esModule: true,
  default: { language: 'en' },
}));

describe('formatFileSize', () => {
  it('returns "0 B" for zero or falsy', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(null)).toBe('0 B');
    expect(formatFileSize(undefined)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatFileSize(100)).toBe('100 B');
    expect(formatFileSize(999)).toBe('999 B');
  });

  it('formats KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats GB', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('formats TB', () => {
    expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
  });

  it('rounds to 1 decimal place', () => {
    expect(formatFileSize(1024 * 1.234)).toBe('1.2 KB');
  });
});

describe('formatDate', () => {
  it('returns "-" for null/undefined/empty', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('returns locale-formatted date string for valid date', () => {
    const result = formatDate('2025-02-19T10:30:00Z');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns passthrough for invalid date string per spec', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateOnly', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatDateOnly(null)).toBe('');
    expect(formatDateOnly(undefined)).toBe('');
    expect(formatDateOnly('')).toBe('');
  });

  it('returns locale-formatted date for valid date', () => {
    const result = formatDateOnly('2025-02-19');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns String(dateString) for invalid date string per spec', () => {
    expect(formatDateOnly('invalid')).toBe('invalid');
  });
});
