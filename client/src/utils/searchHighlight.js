/**
 * searchHighlight — client-side highlight ranges for name_matches rows
 * (§4.6: highlights are COSMETIC-ONLY; the server never returns markup
 * offsets, so the client computes case-insensitive all-occurrence ranges of
 * the trimmed submitted query inside the returned name). A row whose match
 * cannot be located simply renders unhighlighted.
 *
 * @see docs/spec/client/utils/searchHighlight.md
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Case-insensitive all-occurrence ranges (end-exclusive, ascending,
 * non-overlapping) of `query` inside `name`. Empty inputs or no match → [].
 *
 * @param {string} name
 * @param {string} query
 * @returns {Array<{ start: number, end: number }>}
 */
export function computeHighlightRanges(name, query) {
  if (!isNonEmptyString(name) || !isNonEmptyString(query)) return [];

  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  if (needle.length > haystack.length) return [];

  const ranges = [];
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    ranges.push({ start: from, end: from + needle.length });
    from = haystack.indexOf(needle, from + needle.length);
  }
  return ranges;
}

/**
 * Segment list for span rendering: the name split at the given ranges.
 *
 * @param {string} name
 * @param {Array<{ start: number, end: number }>} ranges
 * @returns {Array<{ text: string, highlighted: boolean }>}
 */
export function applyHighlightRanges(name, ranges) {
  const safeName = typeof name === 'string' ? name : '';
  const safeRanges = Array.isArray(ranges) ? ranges : [];
  if (safeRanges.length === 0) return [{ text: safeName, highlighted: false }];

  const segments = [];
  let cursor = 0;
  for (const range of safeRanges) {
    const start = Math.max(cursor, Number(range.start));
    const end = Number(range.end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      start >= safeName.length
    ) {
      continue;
    }
    if (start > cursor) segments.push({ text: safeName.slice(cursor, start), highlighted: false });
    segments.push({ text: safeName.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < safeName.length) {
    segments.push({ text: safeName.slice(cursor), highlighted: false });
  }
  return segments;
}
