'use strict';

/**
 * Docs state-purity gate (AGENTS §2.1.5, PLAN.md §8, AI_FEATURE_PLAN §12 preamble).
 *
 * `docs/spec/**` and `docs/features/**` carry decided/implemented STATE only.
 * Dated rulings, rationale, retracted proposals, task/phase provenance, and
 * design-doc pointers must live only in AI_FEATURE_PLAN.md / PLAN.md / POC.md.
 * This test codifies the PLAN §8 mechanical sweep (previously a manual grep)
 * plus a §-pointer resolution check: every `§X.Y` citation in a scoped doc must
 * resolve to a numbered heading in a known reference document.
 *
 * WARN-tier markers (rollout labels like `(target)` on contract-spec checklists)
 * are printed, not asserted — they are sanctioned target-contract notation.
 *
 * @see PLAN.md §8 (Docs gate)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCOPED_DIRS = [
  path.join(REPO_ROOT, 'docs', 'spec'),
  path.join(REPO_ROOT, 'docs', 'features'),
];

const FORBIDDEN_PATTERNS = [
  ['dated-ruling', /2026-1[01]-\d{2}/],
  ['dissolution-narration', /\bdissolv\w*\b/],
  ['withdrawal-narration', /\bwithdraw\w*\b/],
  ['supersession-narration', /\bsupersed\w*\b/],
  ['retracted-proposal', /initially proposed/],
  ['purge-narration', /purge state/],
  ['evidence-trail', /evidence trail/],
  ['pending-task-provenance', /\bpending T\d\b/],
  ['task-provenance', /\bT[0-4]\.\d+b?\b/],
  ['design-doc-pointer', /\bAI_FEATURE_PLAN\b/, /PLAN\.md\b/],
  ['rationale-theater', /would be theater/],
  ['decision-vocab', /\brulings?\b/],
  ['failure-direction-rationale', /failure direction|stays conservative|\bpoison\w*\b/],
  ['rationale-clause', /\bThis is how\b|\bwhat makes\b/],
  [
    'owner-attribution',
    /\bowner[- ](decision|ruling|confirmed|approved|sign-off)\b|\(owner \d{4}/i,
  ],
  ['retirement-narration', /\bretir\w+ (the|this|proposal|earlier|initially)\b/i],
];

const WARN_PATTERNS = [
  ['rollout-marker', /\((target|target only)\)/],
  ['deferral-vocab', /\bout of scope\b|future extension/],
  ['deliberate-vocab', /\bdeliberate\w*\b/],
];

function listMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}

function scopedFiles() {
  return SCOPED_DIRS.flatMap(listMarkdown);
}

function rel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function headingNumbers(text) {
  const numbers = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^#{2,6}\s+§?(\d+(?:\.\d+)*)[\s.)]/);
    if (m) numbers.add(m[1]);
    const t = line.match(/^#{1,6}\s+§?(\d+(?:\.\d+)*)\.?\s/);
    if (t) numbers.add(t[1]);
  }
  return numbers;
}

function allRepoMarkdown() {
  const out = [...scopedFiles()];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.git')
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    const full = path.join(REPO_ROOT, entry.name);
    if (entry.isDirectory()) {
      if (['docs', 'client', 'server', 'shared', 'e2e'].includes(entry.name)) walk(full);
    } else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function knownHeadingNumbers() {
  const numbers = new Set();
  for (const file of allRepoMarkdown()) {
    for (const n of headingNumbers(fs.readFileSync(file, 'utf8'))) numbers.add(n);
  }
  return numbers;
}

describe('docs state-purity gate (PLAN §8 sweep)', () => {
  it('scoped docs contain no decision-narration patterns', () => {
    const violations = [];
    for (const file of scopedFiles()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        for (const [name, ...res] of FORBIDDEN_PATTERNS) {
          if (res.some((re) => re.test(line))) {
            violations.push(`${rel(file)}:${idx + 1} [${name}] ${line.trim().slice(0, 100)}`);
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('every §X.Y citation resolves to a known numbered heading', () => {
    const numbers = knownHeadingNumbers();
    const fileHeadings = new Map();
    for (const file of allRepoMarkdown()) {
      fileHeadings.set(path.basename(file), headingNumbers(fs.readFileSync(file, 'utf8')));
    }
    const unresolved = new Set();
    for (const file of scopedFiles()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        for (const m of line.matchAll(
          /([A-Za-z][A-Za-z0-9_-]*)(?:\.md)?[`' \t]+§(\d+(?:\.\d+)+|\d+\.\d+)/g
        )) {
          const basename = `${m[1]}.md`;
          const local = fileHeadings.get(basename);
          if (local) {
            if (!local.has(m[2])) unresolved.add(`${rel(file)}:${idx + 1} ${basename} §${m[2]}`);
          } else if (!numbers.has(m[2])) {
            unresolved.add(`${rel(file)}:${idx + 1} §${m[2]}`);
          }
        }
      });
    }
    for (const file of scopedFiles()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        for (const m of line.matchAll(/§(\d+(?:\.\d+)+|\d+\.\d+)/g)) {
          if (!numbers.has(m[1])) unresolved.add(`${rel(file)}:${idx + 1} §${m[1]}`);
        }
      });
    }
    expect([...unresolved].sort()).toEqual([]);
  });

  it('reports warn-tier markers without failing', () => {
    const warnCounts = WARN_PATTERNS.map(([name]) => [name, 0]);
    for (const file of scopedFiles()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line) => {
        WARN_PATTERNS.forEach(([, re], i) => {
          if (re.test(line)) {
            warnCounts[i][1] += 1;
          }
        });
      });
    }
    for (const [name, count] of warnCounts) {
      if (count > 0)
        console.warn(
          `docsStatePurity WARN [${name}] ${count} hit(s) — review when touching these docs`
        );
    }
    expect(Array.isArray(warnCounts)).toBe(true);
  });
});
