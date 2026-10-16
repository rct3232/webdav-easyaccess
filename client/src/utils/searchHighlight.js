/**
 * searchHighlight — pure client-side highlight ranges.
 *
 * Multi-term, per-color ('committed' = submitted/search terms, 'live' = the
 * in-progress browse filter) computation of case-insensitive all-occurrence
 * ranges, merged non-overlapping, ascending, end-exclusive, each tagged with
 * its `kind`. Highlights are COSMETIC-ONLY: membership/promotion decisions use
 * the match tests (`matchesTerm`/`matchesAllTerms`); the server never returns
 * markup offsets. A row whose match cannot be located simply renders
 * unhighlighted.
 *
 * Ranges must index the RENDERED (truncated) string — the row name slots
 * recompute against the `pixelMiddleTruncate` output via the shared
 * `HighlightedName` renderer.
 *
 * @see docs/spec/client/utils/searchHighlight.md
 */

const KIND_LIVE = 'live';
const KIND_COMMITTED = 'committed';

// Overlapping committed/live ranges split at the range boundaries (no nested
// spans); where both kinds cover the same characters the committed color wins.
const KIND_PRIORITY = { [KIND_LIVE]: 0, [KIND_COMMITTED]: 1 };

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTerms(terms) {
  const list = Array.isArray(terms) ? terms : [terms];
  return list.filter(isNonEmptyString).map((term) => term.toLowerCase());
}

function normalizeKind(kind) {
  return kind === KIND_LIVE ? KIND_LIVE : KIND_COMMITTED;
}

/**
 * Case-insensitive all-occurrence ranges (end-exclusive, ascending,
 * non-overlapping — same-kind overlaps merged) of every term inside `name`,
 * each tagged `kind`. Empty name/inputs or no match → []. A term longer than
 * the name yields no range.
 *
 * @param {string} name
 * @param {string | string[]} terms
 * @param {'committed' | 'live'} [kind='committed']
 * @returns {Array<{ start: number, end: number, kind: string }>}
 */
export function computeHighlightRanges(name, terms, kind = KIND_COMMITTED) {
  if (!isNonEmptyString(name)) return [];
  const needles = normalizeTerms(terms);
  if (needles.length === 0) return [];

  const haystack = name.toLowerCase();
  const raw = [];
  for (const needle of needles) {
    if (needle.length > haystack.length) continue;
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      raw.push({ start: from, end: from + needle.length });
      from = haystack.indexOf(needle, from + needle.length);
    }
  }
  if (raw.length === 0) return [];

  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const tagged = normalizeKind(kind);
  const merged = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end, kind: tagged });
    }
  }
  return merged;
}

/**
 * Single-substring case-insensitive containment — the promotion/live-filter
 * test (same rule as the browse-name filter).
 *
 * @param {string} name
 * @param {string} term
 * @returns {boolean}
 */
export function matchesTerm(name, term) {
  if (!isNonEmptyString(name) || !isNonEmptyString(term)) return false;
  return name.toLowerCase().includes(term.toLowerCase());
}

/**
 * AND of `matchesTerm` over the committed chain terms — the Zone A membership
 * test. Empty/whitespace-only terms are skipped; an empty effective term list
 * is vacuously true.
 *
 * @param {string} name
 * @param {string[]} terms
 * @returns {boolean}
 */
export function matchesAllTerms(name, terms) {
  const needles = normalizeTerms(terms);
  if (needles.length === 0) return true;
  if (!isNonEmptyString(name)) return false;
  const haystack = name.toLowerCase();
  return needles.every((needle) => haystack.includes(needle));
}

/**
 * Boundary-split merge of (possibly overlapping, possibly kind-less) ranges:
 * split at every range boundary, keep one kind per atomic interval (committed
 * wins the overlap), then merge adjacent same-kind intervals. Clamps to
 * [0, nameLength] and drops invalid/zero-length ranges.
 */
function mergeHighlightRanges(ranges, nameLength) {
  const list = Array.isArray(ranges) ? ranges : [];
  const valid = [];
  for (const range of list) {
    const rawStart = Number(range?.start);
    const rawEnd = Number(range?.end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(0, Math.min(nameLength, Math.floor(rawStart)));
    const end = Math.max(0, Math.min(nameLength, Math.ceil(rawEnd)));
    if (end <= start) continue;
    valid.push({ start, end, kind: normalizeKind(range.kind) });
  }
  if (valid.length === 0) return [];

  const points = new Set();
  for (const range of valid) {
    points.add(range.start);
    points.add(range.end);
  }
  const sortedPoints = [...points].sort((a, b) => a - b);

  const merged = [];
  for (let i = 0; i < sortedPoints.length - 1; i += 1) {
    const from = sortedPoints[i];
    const to = sortedPoints[i + 1];
    if (to <= from) continue;
    let winner = null;
    for (const range of valid) {
      if (range.start <= from && range.end >= to) {
        if (winner === null || KIND_PRIORITY[range.kind] > KIND_PRIORITY[winner]) {
          winner = range.kind;
        }
      }
    }
    if (winner === null) continue;
    const last = merged[merged.length - 1];
    if (last && last.kind === winner && last.end === from) {
      last.end = to;
    } else {
      merged.push({ start: from, end: to, kind: winner });
    }
  }
  return merged;
}

/**
 * Segment list for span rendering: the name split at the (merged) ranges.
 * An unchanged/unhighlighted name produces one `kind: null` segment; segment
 * texts always concatenate back to the input string.
 *
 * @param {string} name
 * @param {Array<{ start: number, end: number, kind?: string }>} ranges
 * @returns {Array<{ text: string, kind: string | null }>}
 */
export function applyHighlightRanges(name, ranges) {
  const safeName = typeof name === 'string' ? name : '';
  const normalized = mergeHighlightRanges(ranges, safeName.length);
  if (normalized.length === 0) return [{ text: safeName, kind: null }];

  const segments = [];
  let cursor = 0;
  for (const range of normalized) {
    if (range.start > cursor) {
      segments.push({ text: safeName.slice(cursor, range.start), kind: null });
    }
    segments.push({ text: safeName.slice(range.start, range.end), kind: range.kind });
    cursor = range.end;
  }
  if (cursor < safeName.length) {
    segments.push({ text: safeName.slice(cursor), kind: null });
  }
  return segments;
}
