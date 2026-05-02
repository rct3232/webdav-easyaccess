const bcrypt = require('bcryptjs');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

const {
  META_ROOT,
  USERS_DIR,
  EMAIL_INDEX_DIR,
  LOCKS_DIR,
  PERMISSIONS_DIR,
  PERMISSIONS_USERS_DIR,
} = require('./metaPaths');
const { ensureDir, isSqliteBackend } = require('./storage');
const { initSqliteSchema } = require('../scripts/initSqliteSchema');
const userStore = require('./userStore');
const settingsStore = require('./settingsStore');
const permissionStore = require('./permissionStore');
const permissionRequestStore = require('./permissionRequestStore');

async function ensureDirs() {
  await ensureDir(META_ROOT);
  await ensureDir(USERS_DIR);
  await ensureDir(EMAIL_INDEX_DIR);
  await ensureDir(LOCKS_DIR);
  await ensureDir(PERMISSIONS_DIR);
  await ensureDir(PERMISSIONS_USERS_DIR);
}

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

  // Keep compatibility with prior behavior where admin had explicit root permission
  try {
    await permissionStore.grant(admin.id, '/', PERMISSIONS.ADMIN);
  } catch {
    // best-effort
  }

  // Keep console output consistent with previous behavior
  // eslint-disable-next-line no-console
  console.log('Default admin account created. Please change the default password after first login.');

  return admin;
}

async function initMetadataStore() {
  if (isSqliteBackend()) {
    await initSqliteSchema();
  } else {
    await ensureDirs();
    await userStore.ensureUserIndexFile();
    await settingsStore.ensureSettingsFile();
    await permissionRequestStore.ensurePermissionRequestsFile();
  }
  await ensureDefaultAdmin();
}

module.exports = {
  initMetadataStore,
  ensureDefaultAdmin,
  ensureDirs,
};

