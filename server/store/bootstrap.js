const bcrypt = require('bcryptjs');

const { isSqliteBackend } = require('./storage');
const { initSqliteSchema } = require('../scripts/initSqliteSchema');
const { applyPendingMigrations } = require('../infrastructure/schemaManager');
const userStore = require('./userStore');

async function ensureDefaultAdmin() {
  if (process.env.WEA_DISABLE_DEFAULT_ADMIN === 'true') return;
  const existing = await userStore.findByUsername('admin');
  if (existing) return;

  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  const admin = await userStore.createUser({
    username: 'admin',
    email: 'admin@webdav.local',
    passwordHash,
    isAdmin: true,
  });

  // Admin users bypass ACL checks (is_admin), so no explicit root grant is
  // needed. The previous path-based grant ('/') was a no-op on nodeId stores.
  // Keep console output consistent with previous behavior
  // eslint-disable-next-line no-console
  console.log(
    'Default admin account created. Please change the default password after first login.'
  );

  return admin;
}

/**
 * Connect the metadata DB and apply the schema/migrations only (no admin
 * seeding). Used by the boot path so the config resolver can be primed and
 * the process.env T1 population can happen BEFORE ensureDefaultAdmin reads
 * ADMIN_DEFAULT_PASSWORD (which may now be a DB-sourced, decrypted value).
 */
async function initMetadataSchema() {
  if (isSqliteBackend()) {
    await initSqliteSchema();
  } else {
    await applyPendingMigrations('postgresql');
  }
}

/**
 * Backward-compatible combined init: schema + default admin seeding. Kept for
 * callers that do not need the config-resolver ordering (test harnesses,
 * scripts) so their behavior is unchanged.
 */
async function initMetadataStore() {
  await initMetadataSchema();
  await ensureDefaultAdmin();
}

module.exports = {
  initMetadataSchema,
  initMetadataStore,
  ensureDefaultAdmin,
};
