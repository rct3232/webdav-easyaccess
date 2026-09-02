/**
 * Calculates the visible length of a string considering character widths.
 * CJK characters are counted as approximately 2 units, others as 1 unit.
 * This is a rough estimation for character-count based truncation.
 */
export const getVisibleLength = (str) => {
  if (!str) return 0;
  // Normalize to NFC to ensure Hangul syllables are treated as single units
  const normalized = str.normalize('NFC');
  const chars = [...normalized];
  let length = 0;
  for (const char of chars) {
    const charCode = char.charCodeAt(0);
    // Rough check for CJK characters (Hangul, Hanja, Symbols)
    if (
      (charCode >= 0x1100 && charCode <= 0x11ff) || // Hangul Jamo
      (charCode >= 0x3000 && charCode <= 0x303f) || // CJK Symbols and Punctuation
      (charCode >= 0x3130 && charCode <= 0x318f) || // Hangul Compatibility Jamo
      (charCode >= 0xac00 && charCode <= 0xd7af) || // Hangul Syllables
      (charCode >= 0x4e00 && charCode <= 0x9fff)
    ) {
      // CJK Unified Ideographs
      length += 2;
    } else {
      length += 1;
    }
  }
  return length;
};

/**
 * Truncates a string in the middle while preserving the beginning and the end.
 * @param {string} text - The text to truncate.
 * @param {number} maxVisibleLength - Max visible length (sum of approximate character widths).
 * @param {number} backLength - Number of characters to keep at the end (including extension).
 * @returns {string} Truncated string.
 */
export const middleTruncate = (text, maxVisibleLength, backLength = 6) => {
  if (!text) return '';
  // Normalize to NFC to handle macOS NFD strings and prevent splitting syllables
  const normalized = text.normalize('NFC');
  const visibleLength = getVisibleLength(normalized);
  if (visibleLength <= maxVisibleLength) return normalized;

  const chars = [...normalized];
  // Ensure backLength isn't too large
  const safeBackLength = Math.min(backLength, Math.floor(chars.length / 2));

  const backChars = chars.slice(-safeBackLength);
  const backStr = backChars.join('');
  const backVisibleLength = getVisibleLength(backStr);

  const ellipsis = '...';
  const ellipsisLength = 3;

  const availableFrontLength = maxVisibleLength - backVisibleLength - ellipsisLength;

  if (availableFrontLength < 1) {
    // If we can't fit even one char in front, just show ellipsis and back
    return `...${backStr}`;
  }

  let frontStr = '';
  let currentFrontLength = 0;
  const frontChars = chars.slice(0, chars.length - safeBackLength);

  for (const char of frontChars) {
    const charLength = getVisibleLength(char);
    if (currentFrontLength + charLength > availableFrontLength) break;
    frontStr += char;
    currentFrontLength += charLength;
  }

  // If frontStr is empty but we had space, at least try to put one char
  if (frontStr === '' && chars.length > safeBackLength) {
    frontStr = chars[0];
  }

  return `${frontStr}${ellipsis}${backStr}`;
};

let canvas = null;
/**
 * Measures the pixel width of a string given a font.
 */
export const getTextWidth = (
  text,
  font = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif'
) => {
  if (typeof document === 'undefined') return 0; // Guard for non-browser env
  if (!canvas) {
    canvas = document.createElement('canvas');
  }
  const context = canvas.getContext('2d');
  if (!context) {
    // Fallback for environments where canvas.getContext('2d') returns null (e.g. JSDOM without jest-canvas-mock)
    // Use getVisibleLength to estimate width (approx 8px per unit)
    return getVisibleLength(text) * 8;
  }
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
};

/**
 * Truncates a string in the middle based on pixel width while preserving the beginning and the end.
 * @param {string} text - The text to truncate.
 * @param {number} maxPixelWidth - Max width in pixels.
 * @param {string} font - Font string for measurement.
 * @param {number} backLength - Number of characters to keep at the end.
 * @returns {string} Truncated string.
 */
export const pixelMiddleTruncate = (text, maxPixelWidth, font, backLength = 6) => {
  if (!text) return '';

  const normalized = text.normalize('NFC');
  const totalWidth = getTextWidth(normalized, font);

  if (totalWidth <= maxPixelWidth) return normalized;

  const chars = [...normalized];
  // We specify a default of 4 characters to keep at the end (including extension)
  const safeBackLength = Math.min(backLength, Math.floor(chars.length / 2));

  const backChars = chars.slice(-safeBackLength);
  const backStr = backChars.join('');
  const backWidth = getTextWidth(backStr, font);

  const ellipsis = '...';
  const ellipsisWidth = getTextWidth(ellipsis, font);

  const availableFrontWidth = maxPixelWidth - backWidth - ellipsisWidth;

  if (availableFrontWidth < 5) {
    // Minimum space for at least one narrow char
    return `${ellipsis}${backStr}`;
  }

  let frontStr = '';
  let currentFrontWidth = 0;
  const frontChars = chars.slice(0, chars.length - safeBackLength);

  for (const char of frontChars) {
    const charWidth = getTextWidth(char, font);
    if (currentFrontWidth + charWidth > availableFrontWidth) break;
    frontStr += char;
    currentFrontWidth += charWidth;
  }

  if (frontStr === '' && chars.length > safeBackLength) {
    frontStr = chars[0];
  }

  return `${frontStr}${ellipsis}${backStr}`;
};
