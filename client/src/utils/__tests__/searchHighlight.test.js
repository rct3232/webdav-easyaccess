/**
 * searchHighlight util tests.
 * @see docs/spec/client/utils/searchHighlight.md
 */
import {
  applyHighlightRanges,
  computeHighlightRanges,
  matchesAllTerms,
  matchesTerm,
} from '../searchHighlight';

describe('computeHighlightRanges', () => {
  it('finds case-insensitive all-occurrence ranges at the right offsets, tagged with the kind', () => {
    const ranges = computeHighlightRanges('Fun-MOVIE-notes movie.pdf', ['movie'], 'live');

    expect(ranges).toEqual([
      { start: 4, end: 9, kind: 'live' },
      { start: 16, end: 21, kind: 'live' },
    ]);
  });

  it('two committed terms over one name produce per-term ranges merged without overlaps, each tagged committed', () => {
    const ranges = computeHighlightRanges('report_notes.txt', ['report', 'NOTES'], 'committed');

    expect(ranges).toEqual([
      { start: 0, end: 6, kind: 'committed' },
      { start: 7, end: 12, kind: 'committed' },
    ]);
  });

  it('merges overlapping same-kind ranges into one span', () => {
    expect(computeHighlightRanges('aaaa', ['aa', 'aaa'], 'live')).toEqual([
      { start: 0, end: 4, kind: 'live' },
    ]);
  });

  it('defaults the kind to committed (single-term callers passing a string)', () => {
    expect(computeHighlightRanges('ab-AB-cd', 'ab')).toEqual([
      { start: 0, end: 2, kind: 'committed' },
      { start: 3, end: 5, kind: 'committed' },
    ]);
  });

  it('is ascending, non-overlapping and end-exclusive', () => {
    const ranges = computeHighlightRanges('cat category catnip', ['cat'], 'committed');

    expect(ranges).toEqual([
      { start: 0, end: 3, kind: 'committed' },
      { start: 4, end: 7, kind: 'committed' },
      { start: 13, end: 16, kind: 'committed' },
    ]);
    for (const range of ranges) {
      expect(range.end).toBeGreaterThan(range.start);
    }
  });

  it('skips empty/whitespace-only terms', () => {
    expect(computeHighlightRanges('report.txt', ['', '   '], 'live')).toEqual([]);
    expect(computeHighlightRanges('report.txt', ['report', ' '], 'committed')).toEqual([
      { start: 0, end: 6, kind: 'committed' },
    ]);
  });

  it('returns [] for no match, no terms and empty name', () => {
    expect(computeHighlightRanges('report.txt', ['vacation'], 'committed')).toEqual([]);
    expect(computeHighlightRanges('report.txt', [], 'live')).toEqual([]);
    expect(computeHighlightRanges('', ['report'], 'live')).toEqual([]);
  });

  it('returns no range when a term is longer than the name', () => {
    expect(computeHighlightRanges('ab.txt', ['abcdefghij'], 'live')).toEqual([]);
  });
});

describe('applyHighlightRanges', () => {
  it('splits the name into kind-tagged segments', () => {
    const segments = applyHighlightRanges('Fun-MOVIE-notes.pdf', [
      { start: 4, end: 9, kind: 'live' },
    ]);

    expect(segments).toEqual([
      { text: 'Fun-', kind: null },
      { text: 'MOVIE', kind: 'live' },
      { text: '-notes.pdf', kind: null },
    ]);
  });

  it('returns the name as one kind-null segment when there are no ranges', () => {
    expect(applyHighlightRanges('report.txt', [])).toEqual([{ text: 'report.txt', kind: null }]);
  });

  it('splits a committed and a live range that partially overlap at the boundaries — committed wins, no span nests another', () => {
    const segments = applyHighlightRanges('0123456789', [
      { start: 5, end: 9, kind: 'live' },
      { start: 2, end: 7, kind: 'committed' },
    ]);

    expect(segments).toEqual([
      { text: '01', kind: null },
      { text: '23456', kind: 'committed' },
      { text: '78', kind: 'live' },
      { text: '9', kind: null },
    ]);
  });

  it('treats ranges without a kind as committed (legacy rows)', () => {
    expect(applyHighlightRanges('abc', [{ start: 0, end: 3 }])).toEqual([
      { text: 'abc', kind: 'committed' },
    ]);
  });

  it('clamps out-of-bounds and invalid ranges, dropping zero-length ones', () => {
    expect(
      applyHighlightRanges('abc', [
        { start: -2, end: 2, kind: 'live' },
        { start: 5, end: 9, kind: 'live' },
        { start: 'x', end: 2, kind: 'live' },
      ])
    ).toEqual([
      { text: 'ab', kind: 'live' },
      { text: 'c', kind: null },
    ]);
  });

  it('segments computed against a truncated string concatenate back to it', () => {
    const rendered = 'movie...night.mkv';
    const segments = applyHighlightRanges(
      rendered,
      computeHighlightRanges(rendered, ['movie', 'night'], 'live')
    );

    expect(segments.map((segment) => segment.text).join('')).toBe(rendered);
    expect(segments.filter((segment) => segment.kind === 'live').map((s) => s.text)).toEqual([
      'movie',
      'night',
    ]);
  });
});

describe('matchesTerm', () => {
  it('is the single-substring case-insensitive containment test', () => {
    expect(matchesTerm('Report.txt', 'report')).toBe(true);
    expect(matchesTerm('Report.txt', 'PORT')).toBe(true);
    expect(matchesTerm('Report.txt', 'photo')).toBe(false);
  });

  it('never matches an empty name or an empty/whitespace-only term', () => {
    expect(matchesTerm('', 'a')).toBe(false);
    expect(matchesTerm(undefined, 'a')).toBe(false);
    expect(matchesTerm('a.pdf', '   ')).toBe(false);
    expect(matchesTerm('a.pdf', '')).toBe(false);
  });
});

describe('matchesAllTerms', () => {
  it('is the case-insensitive AND over the terms', () => {
    expect(matchesAllTerms('Movie-Night-2024.mkv', ['movie', 'NIGHT', '2024'])).toBe(true);
    expect(matchesAllTerms('Movie-Night-2024.mkv', ['movie', '2025'])).toBe(false);
  });

  it('an empty term list is vacuously true; whitespace-only terms are skipped', () => {
    expect(matchesAllTerms('anything.txt', [])).toBe(true);
    expect(matchesAllTerms('anything.txt', ['   '])).toBe(true);
    expect(matchesAllTerms('anything.txt', ['THING', ''])).toBe(true);
    expect(matchesAllTerms('', ['a'])).toBe(false);
  });
});
