'use strict';

const path = require('node:path');

/**
 * Expected-skip budget gate for release runs.
 *
 * A release group may only skip the statically documented cases for that
 * group (see `docs/E2E_COVERAGE_PLAN.md`). Any extra `test.skip` — a new inline
 * platform branch, a resource fallback that slipped past the CI skip policy, a
 * disabled case — silently shrinks the gate. `E2E_EXPECTED_SKIPS` is set by the
 * release npm scripts (default 6, core 3, WebDAV 0); when it is absent the
 * reporter is a no-op, so ordinary local runs keep their current behavior.
 *
 * Registered from playwright.config.ts `reporter`. A thrown reporter error is
 * swallowed by Playwright's reporter multiplexer (the run still exits 0), so
 * `onEnd` converts the budget error into the reporter API's `failed` status,
 * which makes the CLI exit non-zero.
 */
class SkipBudgetReporter {
  constructor(options = {}) {
    this.expectedSkips = parseExpectedSkips(process.env.E2E_EXPECTED_SKIPS);
    this.listMode = options._mode === 'list' || process.argv.includes('--list');
    this.skippedTests = [];
  }

  onTestEnd(test, result) {
    if (result.status !== 'skipped') return;
    this.skippedTests.push({
      title: test.titlePath().join(' › '),
      location: `${path.relative(process.cwd(), test.location.file)}:${test.location.line}`,
    });
  }

  onEnd() {
    if (this.expectedSkips === null || this.listMode) return;

    try {
      this.assertWithinBudget();
    } catch (error) {
      console.error(error.message);
      return { status: 'failed' };
    }
  }

  assertWithinBudget() {
    const actualSkips = this.skippedTests.length;
    if (actualSkips === this.expectedSkips) return;

    const skippedList = this.skippedTests
      .map((entry) => `  - ${entry.title} (${entry.location})`)
      .join('\n');
    const detail = skippedList ? `\nSkipped cases:\n${skippedList}` : '';

    throw new Error(
      `[skip-budget] Expected ${this.expectedSkips} skipped test(s) for this release run, but observed ${actualSkips}. ` +
        `Every skip must be one of the documented static skips for the group; remove the extra test.skip or update the ` +
        `documented budget when the skip set intentionally changes.${detail}`
    );
  }
}

function parseExpectedSkips(rawValue) {
  if (rawValue === undefined || rawValue.trim() === '') return null;
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(
      `[skip-budget] E2E_EXPECTED_SKIPS must be a non-negative integer, received "${rawValue}".`
    );
  }
  return Number(rawValue.trim());
}

module.exports = SkipBudgetReporter;
