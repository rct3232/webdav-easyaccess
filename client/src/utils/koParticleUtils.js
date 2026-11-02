/**
 * koParticleUtils — pure Korean postpositional-particle picker
 * (docs/spec/client/utils/koParticleUtils.md). Locale copy interpolates the
 * chosen variant instead of string-concatenating particles in components
 * (i18n.md particle/counter rule). NFC-normalizes first, then reads the final
 * code point: a Hangul syllable with a batchim (final consonant) takes the
 * voiced-block variants 을/은/과; everything else (vowel-final syllables,
 * Latin/digit loanwords, jamo without final consonant) takes 를/는/와.
 */

const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;

/**
 * True iff the word's last character is a Hangul syllable carrying a final
 * consonant (batchim). The batchim slot of a composed syllable is
 * `(code - 0xAC00) % 28`; slot 0 means no final consonant.
 */
export const hasKoreanFinalConsonant = (word) => {
  if (typeof word !== 'string' || word.length === 0) return false;
  const normalized = word.normalize('NFC');
  const last = normalized.charCodeAt(normalized.length - 1);
  if (Number.isNaN(last) || last < HANGUL_SYLLABLE_START || last > HANGUL_SYLLABLE_END) {
    return false;
  }
  return (last - HANGUL_SYLLABLE_START) % 28 !== 0;
};

/** Object particle variant for the word: 을 (batchim) / 를. */
export const koObjectParticle = (word) => (hasKoreanFinalConsonant(word) ? '을' : '를');

/** Topic particle variant for the word: 은 (batchim) / 는. */
export const koTopicParticle = (word) => (hasKoreanFinalConsonant(word) ? '은' : '는');

/** Comitative particle variant for the word: 과 (batchim) / 와. */
export const koWithParticle = (word) => (hasKoreanFinalConsonant(word) ? '과' : '와');
