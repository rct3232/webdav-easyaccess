import { middleTruncate, getVisibleLength, pixelMiddleTruncate, getTextWidth } from '../stringUtils';

// Mock Canvas for getTextWidth
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: jest.fn((text) => ({
      width: text.split('').reduce((acc, char) => {
        // Mock width: CJK=14px, others=7px
        const charCode = char.charCodeAt(0);
        const isCJK = (charCode >= 0x1100 && charCode <= 0x11ff) ||
          (charCode >= 0x3000 && charCode <= 0x303f) ||
          (charCode >= 0x3130 && charCode <= 0x318f) ||
          (charCode >= 0xac00 && charCode <= 0xd7af) ||
          (charCode >= 0x4e00 && charCode <= 0x9fff);
        return acc + (isCJK ? 14 : 7);
      }, 0)
    })),
    font: '',
  }));
}

describe('stringUtils - getVisibleLength', () => {
  it('counts English characters as 1', () => {
    expect(getVisibleLength('abc')).toBe(3);
  });

  it('counts Hangul characters as 2', () => {
    expect(getVisibleLength('안녕')).toBe(4);
  });

  it('counts mixed characters correctly', () => {
    expect(getVisibleLength('Hi 안녕')).toBe(7); // H(1) i(1) sp(1) 안(2) 녕(2) = 7
  });
});

describe('stringUtils - middleTruncate', () => {
  it('does not truncate short strings', () => {
    expect(middleTruncate('abc.txt', 20)).toBe('abc.txt');
  });

  it('truncates long English filenames', () => {
    // abcdefghijk.docx (11+1+4 = 16 chars)
    // maxVisibleLength = 10, backLength = 6 (k.docx)
    // availableFrontLength = 10 - 6 - 3 = 1
    // frontStr = 'a'
    // Result: 'a...k.docx'
    expect(middleTruncate('abcdefghijk.docx', 10, 6)).toBe('a...k.docx');
  });

  it('truncates long Korean filenames', () => {
    // 가나다라마바사아자차.docx (10*2 + 1 + 4 = 25 units)
    // maxVisibleLength = 15, backLength = 6 (차.docx = 2+1+4=7 units)
    // availableFrontLength = 15 - 7 - 3 = 5
    // frontStr = '가나' (4 units)
    // Result: '가나...차.docx'
    expect(middleTruncate('가나다라마바사아자차.docx', 15, 6)).toBe('가나...차.docx');
  });

  it('handles mixed characters (Eng, Num, Kor) without splitting', () => {
    // 123abc가나다라마바사.docx (3+3+7*2 + 5 = 25 units)
    // maxVisibleLength = 12, backLength = 6 (사.docx = 7 units)
    // availableFrontLength = 12 - 7 - 3 = 2
    // Expected: 12...사.docx
    expect(middleTruncate('123abc가나다라마바사.docx', 12, 6)).toBe('12...사.docx');

    // maxVisibleLength = 13
    // availableFrontLength = 13 - 7 - 3 = 3
    // Expected: 123...사.docx
    expect(middleTruncate('123abc가나다라마바사.docx', 13, 6)).toBe('123...사.docx');

    // Cutting just before a Korean character
    // Front: 123abc (6 units)
    // back: 사.docx (7 units)
    // total: 13 units
    // maxVisibleLength = 15
    // available: 15 - 7 - 3 = 5
    // Actually fits 123ab (5 units)
    expect(middleTruncate('123abc가나다라마바사.docx', 15, 6)).toBe('123ab...사.docx');
  });

  it('handles small maxVisibleLength gracefully', () => {
    expect(middleTruncate('verylongfilename.ext', 5, 3)).toBe('...ext');
  });
});

describe('stringUtils - pixelMiddleTruncate', () => {
  const font = '14px Arial';

  it('does not truncate if total width is within limit', () => {
    // abc.txt = 7*7 = 49px
    expect(pixelMiddleTruncate('abc.txt', 100, font)).toBe('abc.txt');
  });

  it('truncates if total width exceeds limit', () => {
    // abcdef.txt = 10*7 = 70px
    // maxPixels = 50
    // ellipsis = 3*7 = 21px
    // backLength = 4 (.txt) = 4*7 = 28px
    // availableFront = 50 - 28 - 21 = 1px (too small)
    // Result: ...txt
    expect(pixelMiddleTruncate('abcdef.txt', 50, font, 4)).toBe('...txt');

    // maxPixels = 60
    // availableFront = 60 - 28 - 21 = 11px
    // frontStr fits 'a' (7px)
    // Result: a...txt
    expect(pixelMiddleTruncate('abcdef.txt', 60, font, 4)).toBe('a...txt');
  });

  it('handles mixed characters with pixel accuracy', () => {
    // 가나다.txt = 3*14 + 4*7 = 42 + 28 = 70px
    // maxPixels = 60
    // back (.txt) = 28px
    // ellipsis = 21px
    // front available = 60 - 28 - 21 = 11px
    // '가' is 14px, doesn't fit
    // Result: ...txt
    expect(pixelMiddleTruncate('가나다.txt', 60, font, 4)).toBe('...txt');

    // maxPixels = 65
    // available = 65 - 28 - 21 = 16px
    // '가' fits (14px)
    // Result: 가...txt
    expect(pixelMiddleTruncate('가나다.txt', 65, font, 4)).toBe('가...txt');
  });
});
