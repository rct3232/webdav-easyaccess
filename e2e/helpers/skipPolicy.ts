import { test } from '@playwright/test';

/**
 * Resource-availability policy for E2E cases that need an external resource
 * (pre-seeded AI weights, the real WebDAV server, the scratch PostgreSQL
 * instance).
 *
 * A local run may skip when the resource is absent. CI must fail instead: a
 * silently skipped release-gate case shrinks coverage, so a missing CI resource
 * is an infrastructure error rather than a legitimate skip. The caller's reason
 * string is preserved either way.
 */
export function skipWhenUnavailable(unavailable: boolean, reason: string): void {
  if (!unavailable) return;
  if (process.env.CI) {
    throw new Error(`CI-required E2E resource unavailable: ${reason}`);
  }
  test.skip(true, reason);
}
