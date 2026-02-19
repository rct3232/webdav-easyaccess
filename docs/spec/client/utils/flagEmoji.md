# flagEmoji Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Convert language code (ko, en) to flag emoji (🇰🇷, 🇺🇸) using Unicode Regional Indicator symbols. No external package. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/flagEmoji.js`
- **Test file:** `client/src/utils/__tests__/flagEmoji.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| getFlagEmoji | (langCode) => string |

### 2.3 Mapping

- `ko` → KR → 🇰🇷
- `en` → US → 🇺🇸
- Unknown: uppercase langCode as country code

### 2.4 Dependencies

- None (pure function)
- LANG_TO_COUNTRY: { ko: 'KR', en: 'US' }
- Formula: 0x1F1E6 - 65 + charCode for each letter

### 2.5 Verification Scenarios

- [ ] getFlagEmoji('ko') → 🇰🇷
- [ ] getFlagEmoji('en') → 🇺🇸
- [ ] getFlagEmoji('KR') → 🇰🇷 (2-char passed through)
- [ ] getFlagEmoji('') or invalid (length !== 2) → ''

### 2.6 Edge Cases

- langCode null/undefined → ''
- 1-char or 3+ char country → ''
