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
  console.log('Default admin account created. Please change the default password after first login.');

  return admin;
}

async function initMetadataStore() {
  if (isSqliteBackend()) {
    await initSqliteSchema();
  } else {
    await applyPendingMigrations('postgresql');
  }
  await ensureDefaultAdmin();
}

module.exports = {
  initMetadataStore,
  ensureDefaultAdmin,
};
