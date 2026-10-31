#!/usr/bin/env node
/**
 * Static guardrail for the E2E structure conventions.
 *
 * Enforces docs/TESTING_STRATEGY.md §Naming, IDs, and hygiene:
 * - specs are flat: no `test.describe(...)` except `test.describe.configure(...)`
 * - every top-level `test('...')` title carries exactly one E2E case ID
 * - case IDs are unique across specs and ascending per family in each file
 * - docs/E2E_COVERAGE_PLAN.md registers every ID with no gaps in `001..max`
 *
 * Limitations:
 * - Comments are stripped by a small lexical scanner that understands strings,
 *   but not template `${}` expressions or regex literals. No current spec
 *   embeds a `test(` call in either construct.
 * - Only line-leading, top-level `test('...')` / `test("...")` declarations are
 *   collected. `test.only`, `test.skip`, and dynamically built titles are not
 *   linted; the ID must appear in the first quoted title literal.
 * - Only `e2e/*.spec.ts` is scanned (the e2e tree is intentionally flat).
 *
 * @see docs/TESTING_STRATEGY.md §Naming, IDs, and hygiene
 * @see docs/E2E_COVERAGE_PLAN.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const E2E_DIR = path.join(ROOT, 'e2e');
const PLAN_REL = 'docs/E2E_COVERAGE_PLAN.md';
const PLAN_PATH = path.join(ROOT, PLAN_REL);

const ID_PATTERN = /\bE2E-[A-Z0-9-]+-\d{3}\b/g;
const ID_PARTS = /^(E2E-[A-Z0-9-]+)-(\d{3})$/;

/**
 * Replace comments with spaces while preserving offsets and newlines, so the
 * line numbers reported to the user still match the on-disk file.
 */
function stripComments(source) {
  const out = source.split('');
  let state = 'code';
  let quote = '';

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        state = 'line-comment';
      } else if (char === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        state = 'block-comment';
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char;
        state = 'string';
      }
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
      } else {
        out[i] = ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (char !== '\n' && char !== '\r') {
        out[i] = ' ';
      }
      continue;
    }

    if (state === 'string') {
      if (char === '\\') {
        i += 1;
      } else if (char === quote) {
        state = 'code';
      }
    }
  }

  return out.join('');
}

function lineNumberAt(source, index) {
  let line = 1;

  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') line += 1;
  }

  return line;
}

/** Read a quoted string, returning null when it is unterminated. */
function readQuotedString(source, quoteIndex, quote) {
  let value = '';

  for (let i = quoteIndex + 1; i < source.length; i += 1) {
    const char = source[i];

    if (char === '\\') {
      value += char;
      if (i + 1 < source.length) {
        i += 1;
        value += source[i];
      }
      continue;
    }

    if (char === quote) return value;

    value += char;
  }

  return null;
}

function collectTestCalls(source) {
  const clean = stripComments(source);
  const calls = [];
  const callPattern = /^[ \t]*test\s*\(\s*(['"])/gm;
  let match;

  while ((match = callPattern.exec(clean)) !== null) {
    const quote = match[1];
    const quoteIndex = match.index + match[0].length - 1;
    const title = readQuotedString(clean, quoteIndex, quote);

    calls.push({
      line: lineNumberAt(clean, match.index),
      title,
    });
  }

  return calls;
}

function collectDescribeCalls(source) {
  const clean = stripComments(source);
  const calls = [];
  // `test.describe.configure(` has `.configure` before the parenthesis, so it
  // cannot match this pattern.
  const describePattern = /(?<![\w$.])test\.describe\s*\(/g;
  let match;

  while ((match = describePattern.exec(clean)) !== null) {
    calls.push(lineNumberAt(clean, match.index));
  }

  return calls;
}

function collectInventory(source) {
  const ids = new Set();
  const families = new Map();
  const rowPattern = /^\|\s*(E2E-[A-Z0-9-]+-\d{3})\s*\|/gm;
  let match;

  while ((match = rowPattern.exec(source)) !== null) {
    const id = match[1];
    const parts = ID_PARTS.exec(id);

    if (!parts) continue;

    const family = parts[1];
    const number = Number(parts[2]);
    const line = lineNumberAt(source, match.index);

    ids.add(id);

    if (!families.has(family)) {
      families.set(family, { numbers: new Set(), max: 0, maxLine: line });
    }

    const entry = families.get(family);
    entry.numbers.add(number);

    if (number > entry.max) {
      entry.max = number;
      entry.maxLine = line;
    }
  }

  return { ids, families };
}

function formatNumber(number) {
  return String(number).padStart(3, '0');
}

function displayTitle(title) {
  const collapsed = title.replace(/\s+/g, ' ').trim();

  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

function lint() {
  const violations = [];

  if (!fs.existsSync(E2E_DIR)) {
    throw new Error(`E2E directory not found: ${path.relative(ROOT, E2E_DIR)}`);
  }

  if (!fs.existsSync(PLAN_PATH)) {
    throw new Error(`coverage plan not found: ${PLAN_REL}`);
  }

  const specFiles = fs
    .readdirSync(E2E_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => entry.name)
    .sort();

  if (specFiles.length === 0) {
    throw new Error(`no e2e/*.spec.ts files found in ${path.relative(ROOT, E2E_DIR)}`);
  }

  const inventory = collectInventory(fs.readFileSync(PLAN_PATH, 'utf8'));
  const seenIds = new Map();
  const codeFamilies = new Set();
  let testCount = 0;

  for (const fileName of specFiles) {
    const file = path.join(E2E_DIR, fileName);
    const relFile = path.relative(ROOT, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');

    for (const line of collectDescribeCalls(source)) {
      violations.push({
        file: relFile,
        line,
        message:
          'test.describe(...) is not allowed; specs are flat (only test.describe.configure(...) may be used)',
      });
    }

    const familyOrder = new Map();
    const fileIds = new Set();
    const calls = collectTestCalls(source);
    testCount += calls.length;

    for (const call of calls) {
      if (call.title === null) {
        violations.push({
          file: relFile,
          line: call.line,
          message: 'test title is not a closed single- or double-quoted string',
        });
        continue;
      }

      const ids = call.title.match(ID_PATTERN) || [];

      if (ids.length === 0) {
        violations.push({
          file: relFile,
          line: call.line,
          message: `test title has no E2E case ID: "${displayTitle(call.title)}"`,
        });
        continue;
      }

      if (ids.length > 1) {
        violations.push({
          file: relFile,
          line: call.line,
          message: `test title has ${ids.length} E2E case IDs (${ids.join(', ')}); exactly one is required`,
        });
        continue;
      }

      const id = ids[0];
      const parts = ID_PARTS.exec(id);

      if (!parts) {
        violations.push({
          file: relFile,
          line: call.line,
          message: `malformed E2E case ID: ${id}`,
        });
        continue;
      }

      const family = parts[1];
      const number = Number(parts[2]);
      codeFamilies.add(family);

      const isFileDuplicate = fileIds.has(id);
      fileIds.add(id);

      const firstSeen = seenIds.get(id);

      if (firstSeen) {
        violations.push({
          file: relFile,
          line: call.line,
          message: `duplicate E2E case ID ${id} (first declared at ${firstSeen.file}:${firstSeen.line})`,
        });
      } else {
        seenIds.set(id, { file: relFile, line: call.line });
      }

      if (!inventory.ids.has(id)) {
        violations.push({
          file: relFile,
          line: call.line,
          message: `E2E case ID ${id} has no row in ${PLAN_REL}`,
        });
      }

      const previous = familyOrder.get(family);

      if (previous && number <= previous.number && !isFileDuplicate) {
        violations.push({
          file: relFile,
          line: call.line,
          message: `${family} is not ascending: ${id} follows ${previous.id} at line ${previous.line}`,
        });
      }

      if (!previous || number > previous.number) {
        familyOrder.set(family, { id, number, line: call.line });
      }
    }
  }

  for (const [family, entry] of inventory.families) {
    const missing = [];

    for (let number = 1; number <= entry.max; number += 1) {
      if (!entry.numbers.has(number)) missing.push(formatNumber(number));
    }

    if (missing.length > 0) {
      violations.push({
        file: PLAN_REL,
        line: entry.maxLine,
        message: `${family} inventory is not contiguous: missing ${missing.join(', ')} (expected 001..${formatNumber(entry.max)})`,
      });
    }
  }

  const families = new Set([...inventory.families.keys(), ...codeFamilies]);

  return {
    fileCount: specFiles.length,
    testCount,
    familyCount: families.size,
    violations,
  };
}

function main() {
  let result;

  try {
    result = lint();
  } catch (error) {
    console.error(`E2E lint failed to run: ${error.message}`);
    process.exit(1);
  }

  const { fileCount, testCount, familyCount, violations } = result;

  console.log(`files scanned: ${fileCount}`);
  console.log(`tests scanned: ${testCount}`);
  console.log(`families checked: ${familyCount}`);

  if (violations.length === 0) {
    console.log('OK: no E2E structure violations.');
    process.exit(0);
  }

  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message)
  );

  console.log(`violations: ${violations.length}`);

  for (const violation of violations) {
    console.log(`  ${violation.file}:${violation.line} ${violation.message}`);
  }

  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectDescribeCalls,
  collectInventory,
  collectTestCalls,
  lint,
  stripComments,
};
