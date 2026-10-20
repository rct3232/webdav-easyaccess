'use strict';

// textChunking unit tests — pins docs/spec/server/infrastructure/vectorMath.md §4.3.
// RED-first: written before the module exists (AGENTS §2.1).

const { splitSegments, charWindows, chunkPool } = require('../textChunking');

describe('splitSegments (paragraph/heading boundaries)', () => {
  it('splits on blank-line paragraph boundaries', () => {
    expect(splitSegments('Para one.\n\nPara two.')).toEqual(['Para one.', 'Para two.']);
  });

  it('heading lines are their own segment boundaries', () => {
    expect(splitSegments('# Title\nbody text\n\n# Second\nmore')).toEqual([
      '# Title',
      'body text',
      '# Second',
      'more',
    ]);
  });

  it('keeps intra-paragraph line breaks inside one segment', () => {
    expect(splitSegments('line one\nline two')).toEqual(['line one\nline two']);
  });

  it('collapses whitespace-only gaps and trims segments', () => {
    expect(splitSegments('\n  A  \n\n\n   B\n\n')).toEqual(['A', 'B']);
  });

  it('empty text yields no segments', () => {
    expect(splitSegments('')).toEqual([]);
    expect(splitSegments('   \n\n  ')).toEqual([]);
  });
});

describe('charWindows (fallback segmentation)', () => {
  it('cuts fixed windows with a shorter tail', () => {
    expect(charWindows('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('returns one window when the text fits', () => {
    expect(charWindows('abc', 4)).toEqual(['abc']);
  });

  it('empty text yields no windows', () => {
    expect(charWindows('', 4)).toEqual([]);
  });
});

describe('chunkPool (the segmentation ladder)', () => {
  it('returns whole paragraphs when everything fits the budget', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    expect(chunkPool(text, { maxChunkChars: 100, chunkBudget: 4 })).toEqual({
      chunks: ['First paragraph.', 'Second paragraph.'],
      sampled: false,
    });
  });

  it('falls back to char windows for overlong segments', () => {
    const long = 'x'.repeat(10);
    const result = chunkPool(long, { maxChunkChars: 4, chunkBudget: 4 });
    expect(result.chunks).toEqual(['xxxx', 'xxxx', 'xx']);
    expect(result.sampled).toBe(false);
  });

  it('uniform-stride samples exactly chunkBudget chunks and flags it', () => {
    const paragraphs = [];
    for (let i = 0; i < 10; i++) paragraphs.push(`para-${i}`);
    const text = paragraphs.join('\n\n');
    const result = chunkPool(text, { maxChunkChars: 100, chunkBudget: 4 });
    expect(result.chunks).toEqual(['para-0', 'para-3', 'para-6', 'para-9']);
    expect(result.sampled).toBe(true);
  });

  it('mixes paragraphs and window fallbacks in one ladder pass', () => {
    const long = 'y'.repeat(9);
    const text = `short intro.\n\n${long}`;
    const result = chunkPool(text, { maxChunkChars: 6, chunkBudget: 4 });
    expect(result.chunks).toEqual(['short ', 'intro.', 'yyyyyy', 'yyy']);
    expect(result.sampled).toBe(false);
  });

  it('samples AFTER window fallback (windows count as chunks)', () => {
    const windows = 'z'.repeat(16); // 6 windows of 3
    const text = `${windows}\n\nfinal.`;
    const result = chunkPool(text, { maxChunkChars: 3, chunkBudget: 3 });
    expect(result.sampled).toBe(true);
    expect(result.chunks.length).toBe(3);
    expect(result.chunks[0]).toBe('zzz');
    expect(result.chunks[result.chunks.length - 1]).toBe('final.');
  });

  it('empty text yields no chunks', () => {
    expect(chunkPool('', { maxChunkChars: 10, chunkBudget: 4 })).toEqual({
      chunks: [],
      sampled: false,
    });
  });

  it('a budget of 1 keeps exactly one chunk (the first)', () => {
    const text = 'A.\n\nB.\n\nC.';
    expect(chunkPool(text, { maxChunkChars: 100, chunkBudget: 1 })).toEqual({
      chunks: ['A.'],
      sampled: true,
    });
  });
});
