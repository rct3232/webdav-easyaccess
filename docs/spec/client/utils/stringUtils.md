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

| Function            | (input) => return                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| pixelMiddleTruncate | (text, maxPixelWidth, font, backLength = 6) => string. Middle ellipsis by pixel width; keeps end. |

Module-private helpers: `getVisibleLength(str)` (display units; CJK ≈ 2, others 1) and `getTextWidth(text, font?)` (canvas measureText; non-browser/no-context → `getVisibleLength(text) * 8` fallback).

### 2.3 Dependencies

- Browser: uses `document.createElement('canvas')` and `getContext('2d')` for getTextWidth when available.
- Non-browser (e.g. JSDOM): getTextWidth falls back to getVisibleLength-based estimate (8px per unit).
- String normalization: NFC used for Hangul/macOS NFD compatibility.

### 2.4 Verification Scenarios

- [ ] pixelMiddleTruncate: short text unchanged; long text truncated by pixel width with ellipsis and preserved end.
- [ ] Edge: empty string, NFD input, boundary values.

### 2.5 Edge Cases

- Null/undefined input: pixelMiddleTruncate returns ''.
- backLength larger than half length: safeBackLength = floor(chars.length/2).
- availableFrontWidth < 5 in pixelMiddleTruncate: returns ellipsis + back only.
