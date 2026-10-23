import type { APIResponse } from '@playwright/test';

/**
 * Fail-fast assertion for E2E HTTP helpers: a 4xx/5xx must surface the status
 * and response body at the call site, never as a later ECONNRESET/404.
 */
export async function expectOk(res: APIResponse, label: string): Promise<void> {
  if (res.ok()) return;
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '<unreadable body>';
  }
  throw new Error(`${label} failed: ${res.status()} ${body.slice(0, 1000)}`);
}
