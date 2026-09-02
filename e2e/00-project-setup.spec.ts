import { test } from '@playwright/test';
import { runSeedDb } from './helpers/seedDb';

/**
 * Per-project data isolation.
 *
 * Playwright runs the `desktop` project before the `mobile` project against a
 * single shared PostgreSQL database. The suite creates many folders/files at
 * the admin root, and the app caps initial rendering at 50 items (folders
 * first). Once the root accumulates 50+ folders, a file uploaded later in the
 * mobile project sorts past the cap and is never rendered (no scroll →
 * IntersectionObserver never fires). Re-running the seed at the start of each
 * project truncates all app tables and re-seeds the deterministic baseline
 * (admin + user1/2/3 home nodes), so every project starts from a clean root.
 *
 * This spec is NOT matched by the mode-prefixed test projects. It runs from
 * dedicated setup projects (`<mode>-desktop-setup` / `<mode>-mobile-setup`)
 * declared as Playwright `dependencies` of the corresponding test project, so
 * it executes once per dependent project — never from one shared setup project
 * (a `dependencies` setup runs once per run, which would leave the second
 * project on a dirty DB). See docs/TESTING_STRATEGY.md "Per-project data
 * isolation via setup projects".
 *
 * Mirrors `e2e/global-setup.ts` via the shared `e2e/helpers/seedDb.ts`
 * `runSeedDb()`: a spawned `node` child process, direct to PostgreSQL,
 * idempotent, and safe while the app server is running (the server holds a
 * pool but reads per request; global-setup does the same after the server
 * boots).
 */

test.describe('project data isolation', () => {
  test('E2E-SETUP-005: Resets PostgreSQL data for a clean project state', () => {
    runSeedDb();
  });
});
