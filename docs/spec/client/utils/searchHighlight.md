# searchHighlight Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Pure helper computing client-side highlight ranges: multi-term, per-color range computation against the RENDERED name string, plus the single-substring match tests used for zone membership and live promotion. COSMETIC-ONLY for rendering; membership/promotion decisions use the match tests. |
| Used by      | `useSearchResults` (committed + live ranges on result rows), `useExplorerSession` (live browse-filter ranges — `useExplorerSession.md` §3), row components re-computing ranges after name truncation (`FileListItem.md`, `FileGridItem.md`, `FileDetail.md`).                                     |
| Does not own | The server's dialect-specific matching (sqlite `lower()` is ASCII-folded only); correctness never depends on these ranges.                                                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/searchHighlight.js`
- **Test file:** `client/src/utils/__tests__/searchHighlight.test.js`
- **Ranges are computed client-side** (`useSearchResults.md` §2.4); the server never returns markup offsets (`routes/search.md` §2.4).

### 2.2 Main Functions

| Function                                    | Input ⇒ Return                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeHighlightRanges(name, terms, kind)` | `(string, string[], 'committed' \| 'live') => Array<{ start, end, kind }>` — case-insensitive all-occurrence ranges of EVERY term, merged non-overlapping, ascending by start; empty/whitespace terms skipped. |
| `applyHighlightRanges(name, ranges)`        | `(string, Array) => Array<{ text, kind \| null }>` — segment list for span rendering; unchanged name produces one `kind: null` segment.                                                                        |
| `matchesTerm(name, term)`                   | `(string, string) => boolean` — single-substring case-insensitive containment; the promotion/live-filter test.                                                                                                 |
| `matchesAllTerms(name, terms)`              | `(string, string[]) => boolean` — AND of `matchesTerm` over the committed chain terms; the Zone A membership test.                                                                                             |

### 2.3 Rules

- **Two colors, one slot:** each range carries its `kind`; the row renders `kind:'committed'` in the secondary.light color (`data-testid="search-highlight-range"`) and `kind:'live'` in the theme `highlight` yellow token (`data-testid="filter-highlight-range"`). Committed and live ranges may overlap in offsets — merging keeps both kinds visible by splitting at range boundaries (no nested spans).
- **Ranges index the RENDERED string:** row name slots middle-truncate with `pixelMiddleTruncate`; the highlight segments are computed against the TRUNCATED display text (recompute after truncation), rendered inside the SAME Typography, with the full-name `Tooltip` and truncation behavior unchanged.
- Case-insensitive matching: both sides lowercased; offsets index the ORIGINAL (or truncated) input string (JS `toLowerCase` mirroring is acceptable — highlights are cosmetic-only).
- All occurrences of each term (plain whole-string containment per term — no token split; multi-word terms legitimately match nothing as whole strings while membership is per-term AND).
- Empty/whitespace-only terms, empty name, or no match ⇒ `[]` / one unchanged segment (a row whose match cannot be located simply renders unhighlighted).
- A term longer than the name yields no range (no negative/zero-length spans).
- The match tests are the single-substring rule used everywhere (`includes` after case folding) — for a single term they must stay consistent with the server's whole-query containment rule (`routes/search.md`).

### 2.4 Verification Scenarios

- [ ] Two committed terms over one name produce per-term ranges merged without overlaps, each tagged `kind:'committed'`.
- [ ] A committed range and a live range that partially overlap split at boundaries; no span nests another.
- [ ] `matchesAllTerms` is AND across terms and case-insensitive; `matchesTerm` is single-substring.
- [ ] No match / empty term list / empty name ⇒ `[]`; `applyHighlightRanges` returns the name as one unhighlighted segment.
- [ ] Ranges are ascending, non-overlapping, and end-exclusive.
- [ ] Ranges computed against a truncated string align with the truncated render (segment concatenation equals the truncated name).
