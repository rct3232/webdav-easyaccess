# koParticleUtils Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Pure Korean postpositional-particle picker: chooses the object/topic particle variant for a word from its last syllable, so locale copy interpolates particles instead of string-concatenating them in components (`i18n.md` §Rules — particle/counter copy). |
| Used by      | `MergeProposalCard` (ko merge question interpolates the absorbed-name object particle and the survivor-name topic particle).                                                                                                                                  |
| Does not own | EN copy (phrased without particles); translation strings themselves (locale JSON owns them).                                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/koParticleUtils.js`
- **Test file:** `client/src/utils/__tests__/koParticleUtils.test.js`

### 2.2 Function Signatures

| Function                        | Input ⇒ Return                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasKoreanFinalConsonant(word)` | `(string) => boolean` — true iff the word's LAST character is a Hangul syllable with a final consonant (batchim); jamo-only/compat-jamo tails and trailing non-Hangul characters are treated with the same rule where decodable, everything else false. |
| `koObjectParticle(word)`        | `(string) => '을' \| '를'` — object particle variant for the word (batchim ⇒ `을`, else `를`).                                                                                                                                                          |
| `koTopicParticle(word)`         | `(string) => '은' \| '는'` — topic particle variant (batchim ⇒ `은`, else `는`).                                                                                                                                                                        |
| `koWithParticle(word)`          | `(string) => '과' \| '와'` — comitative variant (batchim ⇒ `과`, else `와`); used for the survivor name in the ko merge question.                                                                                                                       |

### 2.3 Rules

- The Hangul syllable block check uses the NFC-normalized last code point (`0xAC00–0xD7A3`);
  batchim presence is `(code - 0xAC00) % 28 !== 0`.
- Non-Hangul and jamo-only tails resolve to the no-batchim variants (loanword convention:
  names ending in a Latin consonant still take `를`/`는`, matching common usage of
  pronunciation-based particles).
- Empty/undefined input resolves to the no-batchim variants (never throws).

### 2.4 Verification Scenarios

- [ ] `hasKoreanFinalConsonant('사진')`/`('여행')`/`('유럽')` true; `('바다')` false;
      `('trip')` false.
- [ ] `koObjectParticle` yields 을/를 per the batchim rule; `koTopicParticle` yields 은/는;
      `koWithParticle` yields 과/와.
- [ ] Boundary: `''`, `undefined`, emoji and digit tails resolve to the no-batchim variants.
- [ ] NFC-normalized decomposed jamo input behaves the same as precomposed input.
