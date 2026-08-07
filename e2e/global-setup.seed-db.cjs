'use strict';

/**
 * Standalone PostgreSQL seed for E2E global-setup.
 *
 * Runs as a spawned `node` child process because the global-setup hook executes
 * AFTER Playwright's webServer has booted the app server (Playwright 1.58 task
 * order: plugins/webServer -> globalSetup). The seed therefore talks directly
 * to Postgres (no HTTP, no app composition graph) and MUST NOT restart the
 * stack: it TRUNCATEs every app table (preserving `_schema_migrations` so the
 * schema is not re-applied mid-run) and then re-seeds a deterministic baseline,
 * leaving the running server's Postgres pool untouched.
 *
 * Steps (all idempotent):
 *   1. Apply the pending Postgres DDL migrations (a no-op when the schema is
 *      already in place, tracked in `_schema_migrations`).
 *   2. TRUNCATE all app tables except `_schema_migrations` (RESTART IDENTITY
 *      CASCADE) so each run starts from clean data without dropping the schema
 *      out from under the running server.
 *   3. Ensure the default admin account exists (same bootstrap as the server).
 *   4. For each base E2E user: create as APPROVED if missing, then resolve-or-
 *      create their home `file_nodes` root directory and grant them `admin` on
 *      it (mirrors `createAdminUser`/`ensureHomeOwnerAdminForAllUsers`).
 *
 * Users are passed as a JSON array on argv (global-setup builds it from
 * `e2e/fixtures/test-data.ts` values): [{ username, password, email }].
 *
 * Requires PG env vars (WEA_PG_*, WEA_STORAGE_BACKEND=postgresql) in process
 * env; global-setup passes them explicitly.
 */

const bcrypt = require('bcryptjs');

const storage = require('../server/store/storage');
const { applyPendingMigrations } = require('../server/infrastructure/schemaManager');
const { ensureDefaultAdmin } = require('../server/store/bootstrap');
const { truncateAllTables } = require('../server/testing/dbUtils');
const userStore = require('../server/store/userStore');
const { createFileNodesStore } = require('../server/store/fileNodesStore');
const { createFileNodeService } = require('../server/service/fileNodeService');
const permissionStore = require('../server/store/permissionStore');
const { createBlobStore } = require('../server/infrastructure/adapters/blobstore');

async function main() {
  const users = JSON.parse(process.argv[2] || '[]');
  if (!Array.isArray(users)) {
    throw new Error('Seed users must be a JSON array passed as argv[2]');
  }

  await applyPendingMigrations('postgresql');
  await truncateAllTables();
  await ensureDefaultAdmin();

  const fileNodesStore = createFileNodesStore();
  const fileNodeService = createFileNodeService({ fileNodesStore });

  // WebDAV blob-storage mode: materialize each seeded user's home directory on
  // the WebDAV server (recursive, idempotent MKCOL) so uploads to it succeed.
  // `createBlobStore()` reads WEA_FILE_STORAGE from the process env; it is a
  // no-op (S3 mode) when WEA_FILE_STORAGE is not 'webdav'.
  const blobStore = process.env.WEA_FILE_STORAGE === 'webdav' ? createBlobStore() : null;

  let createdUsers = 0;
  let ensuredHomes = 0;

  // The server's startup `ensureHomeOwnerAdminForAllUsers()` creates the
  // admin's home node, but the seed's TRUNCATE above wipes it. Re-create it
  // here (mirroring the base-user loop below) so the admin home view has a
  // rootNodeId and create-folder/upload receive a real parentNodeId.
  const admin = await userStore.findByUsername('admin');
  if (admin) {
    let adminHome = await fileNodeService.resolvePath('/admin');
    if (!adminHome) {
      adminHome = await fileNodeService.createDirectory(null, 'admin');
    }
    if (!adminHome) {
      throw new Error('Failed to create home node for admin');
    }
    if (blobStore) {
      await blobStore.createDirectory('/admin');
    }
    const hasAdminPerm = await permissionStore.checkPermission(admin.id, adminHome.id, 'admin');
    if (!hasAdminPerm) {
      await permissionStore.grant(admin.id, adminHome.id, 'admin');
    }
    ensuredHomes += 1;
  }

  for (const { username, password, email } of users) {
    if (!username || !password || !email) {
      throw new Error(`Invalid seed user entry: ${JSON.stringify({ username, password, email })}`);
    }

    let user = await userStore.findByUsername(username);
    if (!user) {
      const passwordHash = await bcrypt.hash(password, 10);
      user = await userStore.createUser({ username, email, passwordHash, isAdmin: false });
      // 'approved' matches the users.status CHECK constraint
      // (USER_STATUS.APPROVED in shared/constants).
      await userStore.updateStatus(user.id, 'approved');
      createdUsers += 1;
    }

    let homeNode = await fileNodeService.resolvePath(`/${username}`);
    if (!homeNode) {
      homeNode = await fileNodeService.createDirectory(null, username);
    }
    if (!homeNode) {
      throw new Error(`Failed to create home node for ${username}`);
    }

    if (blobStore) {
      await blobStore.createDirectory(`/${username}`);
    }

    const hasAdmin = await permissionStore.checkPermission(user.id, homeNode.id, 'admin');
    if (!hasAdmin) {
      await permissionStore.grant(user.id, homeNode.id, 'admin');
    }
    ensuredHomes += 1;
  }

  console.log(
    `[e2e seed] tables truncated (schema preserved), admin ensured; created ${createdUsers} user(s); home nodes granted for ${ensuredHomes} user(s).`
  );

  await storage.closePgPool();
}

main().catch((err) => {
  console.error('[e2e seed] FAILED:', err);
  process.exit(1);
});
