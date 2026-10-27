'use strict';

/**
 * suggestionsRules — pure, LLM-free cleanup matchers for the persisted
 * rule-variant generator (docs/spec/server/services/dashboardService.md §2.5,
 * docs/features/collections-platform.md §4.17). Filename/extension patterns +
 * age gates over subtree cache rows and the short-document sentence test that
 * gates the cosine near-dup variant. No IO, no DB: everything is a function
 * of (name, createdAt, summary) inputs.
 */

const DAY_MS = 86400000;

/** Temp family: extensions (lower-cased compare) + name prefixes. */
const TEMP_EXTENSIONS = Object.freeze([
  '.tmp',
  '.temp',
  '.bak',
  '.old',
  '.dmp',
  '.chk',
  '.part',
  '.crdownload',
  '.swp',
  '.~tmp',
]);
const TEMP_NAME_PREFIXES = Object.freeze(['~$', 'temp_', 'tmp_']);

/** Screenshot name family (case-insensitive prefix match). */
const SCREENSHOT_NAME_PATTERN = /^(screen[_ -]?shot|screenshot|snip)/i;
const STALE_SCREENSHOT_DAYS = 30;

/** Installer package extensions (lower-cased compare). */
const INSTALLER_EXTENSIONS = Object.freeze([
  '.exe',
  '.msi',
  '.msp',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.apk',
  '.appimage',
  '.iso',
]);
const OLD_INSTALLER_DAYS = 90;

/**
 * Candidate list order AND per-node kind priority (lowest rank wins a node's
 * single row): exact first, near after, rule patterns last
 * (docs/spec/server/routes/dashboard.md §2.4).
 */
const KIND_RANK = Object.freeze({
  exact_dup: 0,
  near_dup: 1,
  temp_pattern: 2,
  stale_screenshot: 3,
  old_installer: 4,
});

function extensionOf(name) {
  const lower = String(name || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot) : '';
}

function ageDaysOf(createdAt, nowMs) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  return Math.floor((nowMs - created) / DAY_MS);
}

/**
 * Classify one live file row as a rule-variant candidate.
 * @param {{ name: string, createdAt: string|null }} fileRow
 * @param {{ now: number }} opts clock seam (epoch ms)
 * @returns {{ kind: string, reason: Object } | null} — temp wins over the
 *          age-gated families (priority order below).
 */
function classifyCleanup(fileRow, { now } = {}) {
  const name = String(fileRow?.name || '');
  const nowMs = Number(now ?? Date.now());
  const ext = extensionOf(name);

  if (
    TEMP_EXTENSIONS.includes(ext) ||
    TEMP_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return { kind: 'temp_pattern', reason: { kind: 'temp_pattern', pattern: 'temp' } };
  }

  if (SCREENSHOT_NAME_PATTERN.test(name)) {
    const ageDays = ageDaysOf(fileRow?.createdAt, nowMs);
    if (ageDays !== null && ageDays > STALE_SCREENSHOT_DAYS) {
      return {
        kind: 'stale_screenshot',
        reason: { kind: 'stale_screenshot', pattern: 'screenshot', age_days: ageDays },
      };
    }
  }

  if (INSTALLER_EXTENSIONS.includes(ext)) {
    const ageDays = ageDaysOf(fileRow?.createdAt, nowMs);
    if (ageDays !== null && ageDays > OLD_INSTALLER_DAYS) {
      return {
        kind: 'old_installer',
        reason: { kind: 'old_installer', pattern: 'installer', age_days: ageDays },
      };
    }
  }

  return null;
}

/**
 * Short-document exception input: an enrichment summary of at most ONE
 * sentence (§4.17 — edit variants of one-line files score ≈0.55, E2v2 P01).
 * NULL/empty summaries are NOT short ("absence of evidence is not evidence
 * of brevity") — only an observed one-sentence-or-less excerpt excludes.
 * @param {string|null|undefined} summary
 */
function isShortDocument(summary) {
  if (typeof summary !== 'string' || summary.trim() === '') return false;
  const sentences = summary
    .split(/[.!?。！？…]+/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return sentences.length <= 1;
}

module.exports = {
  DAY_MS,
  TEMP_EXTENSIONS,
  TEMP_NAME_PREFIXES,
  SCREENSHOT_NAME_PATTERN,
  STALE_SCREENSHOT_DAYS,
  INSTALLER_EXTENSIONS,
  OLD_INSTALLER_DAYS,
  KIND_RANK,
  classifyCleanup,
  isShortDocument,
};
