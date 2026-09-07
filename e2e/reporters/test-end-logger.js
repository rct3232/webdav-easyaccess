'use strict';

const path = require('node:path');

/**
 * Per-test completion logger. Prints one line per finished case with a
 * timestamp, project, worker, status and duration so suite/group timing can be
 * read straight from CI logs (see PLAN.md hermetic-option-A analysis — the
 * shared E2E server logs also carry `{"ts":...}` request lines).
 *
 * Registered from playwright.config.ts `reporter`; keeps the default `list`
 * reporter intact.
 */
class TestEndLogger {
  onTestEnd(test, result) {
    const ts = new Date().toISOString();
    const file = path.relative(process.cwd(), test.location.file);
    const status = String(result.status);
    const durS = (result.duration / 1000).toFixed(1).padStart(6);
    console.log(
      `[test-end] ${ts} | w${result.workerIndex} | ${status.padEnd(8)} | ${durS}s | ${file}:${test.location.line} | ${test.title}`
    );
  }
}

module.exports = TestEndLogger;
