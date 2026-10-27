'use strict';

/**
 * suggestionsRules — pure LLM-free cleanup matchers + the short-document
 * sentence test (docs/spec/server/services/dashboardService.md §2.5).
 * No DB, no IO: row classification over (name, createdAt) inputs.
 */

const DAY_MS = 86400000;
const {
  classifyCleanup,
  isShortDocument,
  STALE_SCREENSHOT_DAYS,
  OLD_INSTALLER_DAYS,
  TEMP_EXTENSIONS,
  INSTALLER_EXTENSIONS,
  KIND_RANK,
} = require('../suggestionsRules');

const NOW = Date.UTC(2030, 0, 15, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function fileRow(name, ageDays) {
  return { name, createdAt: iso(NOW - ageDays * DAY_MS - 3600000) };
}

describe('classifyCleanup — temp patterns (no age requirement)', () => {
  it('matches the temp extension family at any age', () => {
    for (const ext of TEMP_EXTENSIONS) {
      const verdict = classifyCleanup(fileRow(`scratch${ext}`, 0), { now: NOW });
      expect(verdict).toEqual({
        kind: 'temp_pattern',
        reason: { kind: 'temp_pattern', pattern: 'temp' },
      });
    }
  });

  it('matches Office lock prefixes and temp_ name prefixes', () => {
    expect(classifyCleanup(fileRow('~$report.docx', 0), { now: NOW }).kind).toBe('temp_pattern');
    expect(classifyCleanup(fileRow('temp_data.bin', 0), { now: NOW }).kind).toBe('temp_pattern');
    expect(classifyCleanup(fileRow('tmp_upload.bin', 0), { now: NOW }).kind).toBe('temp_pattern');
  });

  it('never matches ordinary names or a temp-ish substring mid-name', () => {
    expect(classifyCleanup(fileRow('annual_report.pdf', 0), { now: NOW })).toBeNull();
    expect(classifyCleanup(fileRow('template_factory.docx', 0), { now: NOW })).toBeNull();
    expect(classifyCleanup(fileRow('attempt.log', 0), { now: NOW })).toBeNull();
  });
});

describe('classifyCleanup — stale screenshots', () => {
  it('matches the screenshot name family past STALE_SCREENSHOT_DAYS', () => {
    for (const name of [
      'Screenshot 2030-01-01 at 10.11.12.png',
      'screen_shot_001.png',
      'Screen-Shot-01.jpg',
      'snipaste-capture.png',
    ]) {
      const verdict = classifyCleanup(
        { name, createdAt: iso(NOW - (STALE_SCREENSHOT_DAYS + 1) * DAY_MS) },
        { now: NOW }
      );
      expect(verdict.kind).toBe('stale_screenshot');
      expect(verdict.reason.pattern).toBe('screenshot');
    }
  });

  it('is age-gated: a fresh screenshot and a stale photo name contribute nothing', () => {
    expect(classifyCleanup(fileRow('Screenshot_2030-01-14.png', 1), { now: NOW })).toBeNull();
    expect(
      classifyCleanup(fileRow('IMG_2029-12-01.jpg', STALE_SCREENSHOT_DAYS + 5), { now: NOW })
    ).toBeNull();
  });

  it('reports age_days rounded down', () => {
    const verdict = classifyCleanup(fileRow('screenshot-old.png', STALE_SCREENSHOT_DAYS + 3), {
      now: NOW,
    });
    expect(verdict.reason.age_days).toBe(STALE_SCREENSHOT_DAYS + 3);
  });
});

describe('classifyCleanup — old installers', () => {
  it('matches the installer extension family past OLD_INSTALLER_DAYS', () => {
    for (const ext of INSTALLER_EXTENSIONS) {
      const verdict = classifyCleanup(fileRow(`setup-tool${ext}`, OLD_INSTALLER_DAYS + 1), {
        now: NOW,
      });
      expect(verdict.kind).toBe('old_installer');
      expect(verdict.reason.pattern).toBe('installer');
      expect(verdict.reason.age_days).toBe(OLD_INSTALLER_DAYS + 1);
    }
  });

  it('fresh installers and non-installer executables-in-name contribute nothing', () => {
    expect(classifyCleanup(fileRow('tool.exe', 10), { now: NOW })).toBeNull();
    expect(
      classifyCleanup(fileRow('notes.exe.txt', OLD_INSTALLER_DAYS + 10), { now: NOW })
    ).toBeNull();
  });

  it('temp patterns win over installer/stale families when both match', () => {
    const verdict = classifyCleanup(fileRow('~setup~.tmp', OLD_INSTALLER_DAYS + 5), { now: NOW });
    expect(verdict.kind).toBe('temp_pattern');
  });

  it('non-numeric/missing createdAt contributes nothing (no age oracle)', () => {
    expect(
      classifyCleanup({ name: 'Screenshot_old.png', createdAt: null }, { now: NOW })
    ).toBeNull();
    expect(classifyCleanup({ name: 'old.dmg', createdAt: 'not-a-date' }, { now: NOW })).toBeNull();
  });
});

describe('isShortDocument (the §4.17 short-doc cosine exception)', () => {
  it('treats one-sentence-or-less excerpts as short', () => {
    expect(isShortDocument('A single sentence.')).toBe(true);
    expect(isShortDocument('A single sentence!')).toBe(true);
    expect(isShortDocument('One line without punctuation')).toBe(true);
    expect(isShortDocument('한 문장입니다.')).toBe(true);
  });

  it('treats multi-sentence excerpts as documents', () => {
    expect(isShortDocument('First sentence. Second sentence.')).toBe(false);
    expect(isShortDocument('One.\nTwo.\nThree.')).toBe(false);
    expect(isShortDocument('Ends with an ellipsis… maybe? No — two.')).toBe(false);
  });

  it('absence of evidence is not brevity: null/empty ⇒ false', () => {
    expect(isShortDocument(null)).toBe(false);
    expect(isShortDocument('')).toBe(false);
    expect(isShortDocument('   ')).toBe(false);
  });
});

describe('KIND_RANK', () => {
  it('orders exact first, near second, rule kinds last (stable ranks)', () => {
    expect(KIND_RANK.exact_dup).toBeLessThan(KIND_RANK.near_dup);
    expect(KIND_RANK.near_dup).toBeLessThan(KIND_RANK.temp_pattern);
    expect(KIND_RANK.temp_pattern).toBeLessThan(KIND_RANK.stale_screenshot);
    expect(KIND_RANK.stale_screenshot).toBeLessThan(KIND_RANK.old_installer);
  });
});
