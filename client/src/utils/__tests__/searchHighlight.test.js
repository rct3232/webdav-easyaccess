/**
 * searchHighlight util tests.
 * @see docs/spec/client/utils/searchHighlight.md
 */
import { applyHighlightRanges, computeHighlightRanges } from '../searchHighlight';

describe('computeHighlightRanges', () => {
  it('finds a mid-string match with different case at the right offsets', () => {
    const ranges = computeHighlightRanges('Fun-MOVIE-notes.pdf', 'movie');

    expect(ranges).toEqual([{ start: 4, end: 9 }]);
  });

  it('finds all occurrences without overlap', () => {
    const ranges = computeHighlightRanges('note-and-note.bin', 'note');

    expect(ranges).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('returns [] for no match, empty query and empty name', () => {
    expect(computeHighlightRanges('report.txt', 'vacation')).toEqual([]);
    expect(computeHighlightRanges('report.txt', '   ')).toEqual([]);
    expect(computeHighlightRanges('report.txt', '')).toEqual([]);
    expect(computeHighlightRanges('', 'report')).toEqual([]);
  });

  it('returns [] when the query is longer than the name', () => {
    expect(computeHighlightRanges('ab.txt', 'abcdef')).toEqual([]);
  });
});

describe('applyHighlightRanges', () => {
  it('splits the name into highlighted and plain segments', () => {
    const segments = applyHighlightRanges('Fun-MOVIE-notes.pdf', [{ start: 4, end: 9 }]);

    expect(segments).toEqual([
      { text: 'Fun-', highlighted: false },
      { text: 'MOVIE', highlighted: true },
      { text: '-notes.pdf', highlighted: false },
    ]);
  });

  it('returns a single unhighlighted segment when there are no ranges', () => {
    expect(applyHighlightRanges('report.txt', [])).toEqual([
      { text: 'report.txt', highlighted: false },
    ]);
  });
});
