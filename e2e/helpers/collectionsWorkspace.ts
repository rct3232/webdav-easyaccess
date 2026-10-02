import { APIRequestContext, Page, TestInfo } from '@playwright/test';

import { TEST_FILES } from '../fixtures/test-data';
import { loginWithCredentials } from './auth';
import {
  buildName,
  createFolderAt,
  readTestFileFixture,
  trackWorkspaceCleanup,
  uploadFileAt,
} from './files';
import { getSessionToken, gotoFilesPath, resolveNodeId } from './resolvePath';
import type { ScratchUserCreds } from './scratchUser';

/**
 * Shared workspace scaffolding for the hermetic collections suites
 * (`collections.spec.ts` desktop, `collections.mobile.spec.ts`). Hoisted from
 * the desktop spec (P0 closeout item 2) so the mobile twin provisions the
 * IDENTICAL regular-user world without duplicating the mechanics.
 */

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

/**
 * P-3/P-4 preview coverage + the admin-operator pivot (PLAN §14): log in as
 * the provisioned REGULAR USER and open the case folder under their HOME node
 * (`/<username>/<name>`). Home-based for two binding reasons: root-level case
 * folders would be foreign-owned per the ancestry ownership model
 * (`ownerNodeResolver.isOwnerNode`) and their members legitimately render
 * `shared_excluded` and get EXCLUDED from card previews
 * (`routes/collections.md` preview_items), while members inside the user's
 * home subtree resolve as owner-owned through the home-root ADMIN closure
 * grant — the 2×2 preview and the unshared pending-badge paths need that.
 * Cleanup registers the user session token; the physical folder purge falls
 * back to the OPERATOR token because perm-delete is an admin-only maintenance
 * route (dual-token cleanup — see `helpers/files.ts`).
 */
export async function loginAndOpenUserWorkspace(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  creds: ScratchUserCreds
): Promise<{ base: string; token: string; userCreds: ScratchUserCreds }> {
  const name = buildName(testInfo, 'workspace');
  await loginWithCredentials(page, creds.username, creds.password);
  const token = await getSessionToken(page);
  const homeId = await resolveNodeId(request, token, `/${creds.username}`);
  await createFolderAt(request, token, homeId, name);
  const base = `${creds.username}/${name}`;
  trackWorkspaceCleanup(token, `/${base}`);
  await gotoFilesPath(page, request, `/${base}`);
  return { base, token, userCreds: creds };
}

/** Seed `<workspace>/<prefix file>` via the stable upload API; returns nodeId + path. */
export async function seedFile(
  request: APIRequestContext,
  token: string,
  base: string,
  testInfo: TestInfo,
  prefix: string
): Promise<{ nodeId: number; path: string }> {
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const name = buildName(testInfo, prefix, '.txt');
  const nodeId = await uploadFileAt(
    request,
    token,
    parentNodeId,
    name,
    'text/plain',
    textFixtureBuffer
  );
  return { nodeId, path: `/${base}/${name}` };
}
