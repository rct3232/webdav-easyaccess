import { APIRequestContext, expect } from '@playwright/test';

import { TEST_USERS } from '../fixtures/test-data';
import { createFolderAt } from './files';
import { resolvePathOrNull } from './resolvePath';

/** Credentials of a scratch-provisioned regular (non-admin) E2E user. */
export interface ScratchUserCreds {
  username: string;
  password: string;
  email: string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Login of the scratch-bootstrapped admin (`ADMIN_DEFAULT_PASSWORD`). The
 * shared-pool helpers in `auth.ts` hard-code `TEST_USERS.admin` credentials,
 * but every hermetic scratch server boots with its own admin password, so the
 * operator login must pass it explicitly. The `request` fixture's baseURL
 * scopes every call to the scratch instance (collections-desktop: `:5013`).
 *
 * ADMIN-OPERATOR PIVOT (PLAN §14): this identity is OPERATOR-ONLY — user
 * provisioning (`POST /api/admin/users`) and permanent-delete maintenance.
 * Collections/file-likes/dashboard routes 403 for admin sessions behind the
 * U1 gates, so suite ACTIVITY always runs as a provisioned regular user.
 */
export async function loginScratchAdmin(
  request: APIRequestContext,
  adminPassword: string
): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.admin.username, password: adminPassword },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

/**
 * Create-or-reuse a REGULAR (non-admin) user on the scratch instance through
 * the admin API — the `ensureApprovedUser` pattern from `helpers/auth.ts`
 * (which is hard-wired to the shared pool's `TEST_USERS` and its admin
 * password), scoped here to the caller's `request` baseURL + operator token.
 *
 * Home folder: `POST /api/admin/users` creates and ACL-grants the user's home
 * node `/<username>` including the WebDAV MKCOL
 * (`server/domains/admin/services/userService.js::ensureUserHomeNode`). The
 * post-creation ensure covers a user that survived from an earlier attempt
 * where creation returned taken-duplicate before the home was created.
 *
 * Returns a fresh bearer token for the user (API-side convenience; UI
 * sessions log in through `loginWithCredentials` with the same credentials).
 */
export async function ensureScratchRegularUser(
  request: APIRequestContext,
  adminToken: string,
  creds: ScratchUserCreds
): Promise<string> {
  const createRes = await request.post('/api/admin/users', {
    headers: auth(adminToken),
    data: { username: creds.username, email: creds.email, password: creds.password },
  });
  if (createRes.status() !== 201) {
    const body = await createRes.json().catch(() => ({}));
    const duplicate =
      createRes.status() === 409 ||
      (createRes.status() === 400 &&
        ['serverErrors.admin.usernameTaken', 'serverErrors.admin.emailTaken'].includes(
          body?.errorCode
        ));
    expect(
      duplicate,
      `user provisioning failed: ${createRes.status()} ${JSON.stringify(body)}`
    ).toBeTruthy();
  }

  const homePath = `/${creds.username}`;
  if ((await resolvePathOrNull(request, adminToken, homePath)) === null) {
    // Admin is the only identity allowed root-level creation — the home node
    // is by definition a root-level directory named after the user.
    await createFolderAt(request, adminToken, null, creds.username);
  }

  const loginRes = await request.post('/api/auth/login', {
    data: { username: creds.username, password: creds.password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const body = await loginRes.json();
  return body.token as string;
}
