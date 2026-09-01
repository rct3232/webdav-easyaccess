# stringUtils Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Pixel- and character-based middle truncation for display. Handles CJK character width (approx. 2 units) and NFC normalization. Used by FileDetail, FileGridItem, FileListItem, and RecentFilesSection for long filenames with tooltip. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/stringUtils.js`
- **Test file:** `client/src/utils/__tests__/stringUtils.test.js`

### 2.2 Function Signatures

| Function            | (input) => return                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| getVisibleLength    | (str) => number. Length in display units (CJK ≈ 2, others 1). Empty/falsy → 0.                                                     |
| middleTruncate      | (text, maxVisibleLength, backLength = 6) => string. Middle ellipsis by character-width; keeps end (e.g. extension).                |
| getTextWidth        | (text, font?) => number. Pixel width via canvas measureText. Non-browser env or no context → getVisibleLength(text) \* 8 fallback. |
| pixelMiddleTruncate | (text, maxPixelWidth, font, backLength = 6) => string. Middle ellipsis by pixel width; keeps end.                                  |

### 2.3 Dependencies

- Browser: uses `document.createElement('canvas')` and `getContext('2d')` for getTextWidth when available.
- Non-browser (e.g. JSDOM): getTextWidth falls back to getVisibleLength-based estimate (8px per unit).
- String normalization: NFC used for Hangul/macOS NFD compatibility.

### 2.4 Verification Scenarios

- [ ] getVisibleLength: empty/falsy → 0; ASCII length; CJK counts as 2 units.
- [ ] middleTruncate: short text unchanged; long text has middle ellipsis and preserved end; backLength respected.
- [ ] getTextWidth: returns number; in JSDOM without canvas-mock, uses fallback.
- [ ] pixelMiddleTruncate: short text unchanged; long text truncated by pixel width with ellipsis and preserved end.
- [ ] Edge: empty string, NFD input, boundary values.

### 2.5 Edge Cases

- Null/undefined input: getVisibleLength returns 0; middleTruncate/pixelMiddleTruncate return ''.
- backLength larger than half length: safeBackLength = floor(chars.length/2).
- availableFrontWidth < 5 in pixelMiddleTruncate: returns ellipsis + back only.
