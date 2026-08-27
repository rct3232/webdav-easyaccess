import { APIRequestContext, expect, Page } from '@playwright/test';

/**
 * Resolve a server-side absolute path to a nodeId via `POST /api/files/resolve-path`.
 * The endpoint is token-gated, so an authenticated bearer token is required.
 * `/` (the top-level root) is not resolvable — use the acting user's home path instead.
 */
export async function resolveNodeId(
  request: APIRequestContext,
  bearerToken: string,
  path: string
): Promise<number> {
  const res = await request.post('/api/files/resolve-path', {
    headers: { Authorization: `Bearer ${bearerToken}` },
    data: { path },
  });

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

/**
 * Real-folder URL scheme: `/files/node/<nodeId>`.
 * Virtual roots `/files/__recent__` and `/files/__shared__` are intentionally unchanged.
 */
export function nodeUrl(nodeId: number | string): string {
  return `/files/node/${nodeId}`;
}

/** Navigate the browser directly to a real folder by nodeId. */
export async function gotoNodePage(page: Page, nodeId: number | string): Promise<void> {
  await page.goto(nodeUrl(nodeId));
}

/** Read the bearer token the client stored for the currently logged-in user. */
export async function getSessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.sessionStorage.getItem('token'));
  if (!token) {
    throw new Error('No auth token found in sessionStorage');
  }
  return token;
}

/**
 * Navigate to a real folder by its server-side absolute path, resolving it through
 * the path->nodeId endpoint first. `/` maps to the `/files` root navigation.
 */
export async function gotoFilesPath(
  page: Page,
  request: APIRequestContext,
  serverPath: string
): Promise<void> {
  if (serverPath === '/') {
    await page.goto('/files');
    return;
  }
  const bearerToken = await getSessionToken(page);
  const nodeId = await resolveNodeId(request, bearerToken, serverPath);
  await page.goto(nodeUrl(nodeId));
}
