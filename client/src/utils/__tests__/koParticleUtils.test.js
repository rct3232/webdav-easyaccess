/**
 * koParticleUtils tests — the pure postpositional-particle picker.
 * @see docs/spec/client/utils/koParticleUtils.md
 */
import {
  hasKoreanFinalConsonant,
  koObjectParticle,
  koTopicParticle,
  koWithParticle,
} from '../koParticleUtils';

describe('koParticleUtils', () => {
  it('detects the final consonant on the last Hangul syllable', () => {
    expect(hasKoreanFinalConsonant('사진')).toBe(true); // 진 carries batchim ㄴ
    expect(hasKoreanFinalConsonant('여행')).toBe(true); // 행 carries batchim ㄱ
    expect(hasKoreanFinalConsonant('유럽')).toBe(true); // 팝 carries batchim ㅍ
    expect(hasKoreanFinalConsonant('바다')).toBe(false); // 다 has no batchim
  });

  it('picks object/topic/comitative variants from the batchim', () => {
    expect(koObjectParticle('사진')).toBe('을'); // 진 has batchim ㄴ — 사진을
    expect(koObjectParticle('바다')).toBe('를'); // 다 has no batchim — 바다를
    expect(koTopicParticle('사진')).toBe('은');
    expect(koTopicParticle('바다')).toBe('는');
    expect(koWithParticle('사진')).toBe('과');
    expect(koWithParticle('바다')).toBe('와');
  });

  it('treats non-Hangul and compatibility-jamo tails as loanwords without batchim', () => {
    expect(koObjectParticle('Europe')).toBe('를');
    expect(koObjectParticle('trip23')).toBe('를');
    expect(koObjectParticle('Paris')).toBe('를');
    expect(koTopicParticle('2026')).toBe('는');
    expect(koWithParticle('ㅎ')).toBe('와');
  });

  it('never throws on empty or absent input (defaults to the no-batchim variants)', () => {
    expect(hasKoreanFinalConsonant('')).toBe(false);
    expect(hasKoreanFinalConsonant(undefined)).toBe(false);
    expect(koObjectParticle('')).toBe('를');
    expect(koObjectParticle(undefined)).toBe('를');
    expect(koTopicParticle(null)).toBe('는');
    expect(koWithParticle(undefined)).toBe('와');
  });

  it('resolves decomposed jamo input the same as precomposed input (NFC-first)', () => {
    const decomposed = '사진'.normalize('NFD');
    expect(hasKoreanFinalConsonant(decomposed)).toBe(true);
    expect(koObjectParticle(decomposed)).toBe('을');
    expect(koObjectParticle('여행'.normalize('NFD'))).toBe('을');
  });
});
