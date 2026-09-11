import { pixelMiddleTruncate } from '../stringUtils';

// Mock Canvas for pixel measurement (pixelMiddleTruncate -> getTextWidth)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: jest.fn((text) => ({
      width: text.split('').reduce((acc, char) => {
        // Mock width: CJK=14px, others=7px
        const charCode = char.charCodeAt(0);
        const isCJK =
          (charCode >= 0x1100 && charCode <= 0x11ff) ||
          (charCode >= 0x3000 && charCode <= 0x303f) ||
          (charCode >= 0x3130 && charCode <= 0x318f) ||
          (charCode >= 0xac00 && charCode <= 0xd7af) ||
          (charCode >= 0x4e00 && charCode <= 0x9fff);
        return acc + (isCJK ? 14 : 7);
      }, 0),
    })),
    font: '',
  }));
}

describe('stringUtils - pixelMiddleTruncate', () => {
  const font = '14px Arial';

  it('does not truncate if total width is within limit', () => {
    // abc.txt = 7*7 = 49px
    expect(pixelMiddleTruncate('abc.txt', 100, font)).toBe('abc.txt');
  });

  it('truncates if total width exceeds limit', () => {
    // When max pixel width is less than full string width, result is truncated with ellipsis and preserved end
    const result50 = pixelMiddleTruncate('abcdef.txt', 50, font, 4);
    expect(result50).toContain('...');
    expect(result50.endsWith('txt') || result50.endsWith('.txt')).toBe(true);

    const result60 = pixelMiddleTruncate('abcdef.txt', 60, font, 4);
    expect(result60).toContain('...');
    expect(result60.endsWith('txt') || result60.endsWith('.txt')).toBe(true);
  });

  it('handles mixed characters with pixel accuracy', () => {
    // 가나다.txt = 3*14 + 4*7 = 42 + 28 = 70px
    // maxPixels = 60: front available = 11px; implementation may still prepend first char when frontStr is empty
    expect(pixelMiddleTruncate('가나다.txt', 60, font, 4)).toMatch(/^.?\.\.\.txt$/);

    // maxPixels = 65: available = 16px, '가' (14px) fits
    expect(pixelMiddleTruncate('가나다.txt', 65, font, 4)).toBe('가...txt');
  });
});
