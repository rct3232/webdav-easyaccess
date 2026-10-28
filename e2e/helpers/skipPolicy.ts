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

const EMBED_DISABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** Mirrors the server's built-in embed-model test/ops seam. */
export function isEmbedModelDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return EMBED_DISABLED_VALUES.has(
    String(env.WEA_SKIP_EMBED_MODEL || '')
      .trim()
      .toLowerCase()
  );
}

/**
 * Intentional model-free run (not a missing resource): skip even in CI because
 * the operator explicitly disabled the model. Cases that require the model must
 * opt out with `WEA_SKIP_EMBED_MODEL=0` and call this before boot.
 */
export function skipWhenEmbedModelDisabled(
  reason = 'built-in embed model disabled by WEA_SKIP_EMBED_MODEL'
): void {
  if (!isEmbedModelDisabled()) return;
  test.skip(true, reason);
}
