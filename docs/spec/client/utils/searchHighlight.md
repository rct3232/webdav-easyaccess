# searchHighlight Spec

Target-contract spec.

## 1. Overview

| Item         | Description                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | Pure helper computing client-side highlight ranges for `name_matches` rows (§4.6): case-insensitive, all-occurrence ranges of the trimmed submitted query inside the returned node `name`. COSMETIC-ONLY. |
| Used by      | `useSearchResults` (attaches `highlights` to name-section rows at response time) and `SearchBarResultsMode` (renders the ranges as spans).                                                              |
| Does not own | The server's dialect-specific matching (sqlite `lower()` is ASCII-folded only); correctness never depends on these ranges.                                                                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/searchHighlight.js`
- **Test file:** `client/src/utils/__tests__/searchHighlight.test.js`
- **Decision (written at the T0.11 implementation step per `useSearchResults.md` §2.4):** ranges are computed client-side; the server never returns markup offsets (`routes/search.md` §2.4).

### 2.2 Main Functions

| Function                                     | Input ⇒ Return                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `computeHighlightRanges(name, query)`        | `(string, string) => Array<{ start: number, end: number }>` — non-overlapping forward-scan ranges (end exclusive), ascending by start. |
| `applyHighlightRanges(name, ranges)`         | `(string, Array) => Array<{ text: string, highlighted: boolean }>` — segment list for span rendering; unchanged name when no ranges.    |

### 2.3 Rules

- Case-insensitive: both sides lowercased for matching; offsets index the ORIGINAL `name` (JS `toLowerCase` mirroring is acceptable — highlights are cosmetic, §4.6).
- All occurrences of the FULL trimmed query inside the name (plain containment, same shape as the server §1 semantics — no token split).
- Empty/whitespace-only query, empty name, or no match ⇒ `[]` / unchanged segments (a row whose match cannot be located simply renders unhighlighted).
- A query longer than the name yields no range (no negative/zero-length spans).

### 2.4 Verification Scenarios

- [ ] Mid-string, mixed-case match produces exactly one range covering the query length at the right offsets.
- [ ] Multiple occurrences produce all ranges (forward scan, no overlaps).
- [ ] No match / empty query / empty name ⇒ `[]`; `applyHighlightRanges` then returns the name as a single unhighlighted segment.
- [ ] Ranges are ascending, non-overlapping, and end-exclusive with `end - start === query.length`.
