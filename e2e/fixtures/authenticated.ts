import { test as base, expect } from '@playwright/test';

/**
 * L1 (authenticated-session reuse): a `test` whose `page` fixture bootstraps the
 * seeded admin session. globalSetup (`e2e/global-setup.ts`) logs in once as the
 * admin and writes `ADMIN_STATE` (a Playwright storageState carrying NON-app
 * localStorage keys `e2e.accessToken` / `e2e.refreshToken`). Playwright cannot
 * persist sessionStorage through storageState, and the app keeps its real token
 * in sessionStorage (`client/src/services/authTokenStore.js`), so this init
 * script copies the seeded localStorage keys into sessionStorage on every
 * document load — ONLY when sessionStorage lacks a token, so a later real UI
 * login as another user is never overwritten.
 *
 * A file opts in with `test.use({ storageState: ADMIN_STATE })`. Suites that
 * exercise auth-state themselves (login/landing/logout) must not use it, or
 * must keep their own unauthenticated EMPTY_STATE.
 */

export const ADMIN_STATE = 'e2e-data/state/admin.json';
export const EMPTY_STATE = { cookies: [], origins: [] };

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        if (!window.sessionStorage.getItem('token')) {
          const accessToken = window.localStorage.getItem('e2e.accessToken');
          if (accessToken) {
            window.sessionStorage.setItem('token', accessToken);
          }
          const refreshToken = window.localStorage.getItem('e2e.refreshToken');
          if (refreshToken) {
            window.sessionStorage.setItem('refreshToken', refreshToken);
          }
        }
      } catch {
        // Ignore: storage access can throw on non-app origins (e.g. about:blank).
      }
    });
    await use(page);
  },
});

export { expect };
