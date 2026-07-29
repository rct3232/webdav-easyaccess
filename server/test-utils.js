/**
 * Test utilities for server tests.
 * Provides helpers for creating isolated test data: users, tokens, permissions.
 * @see docs/TEST_GIT_GUIDE.md
 * @see docs/TESTING_STRATEGY.md
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const User = require('./models/User');
const userStore = require('./store/userStore');
const PermissionFacade = require('./domains/permissions/services/permissionFacade');
const { generateToken } = require('./utils/auth');
const { initMetadataStore } = require('./store/bootstrap');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');

/**
 * Create an isolated test storage directory and set WEA_FS_DIR.
 * Use in beforeAll; call cleanup() in afterAll.
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
async function createTestDatabase() {
  const base = path.join(os.tmpdir(), `wea-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  await fs.promises.mkdir(base, { recursive: true });
  const prev = process.env.WEA_FS_DIR;
  process.env.WEA_FS_DIR = base;

  await initMetadataStore();

  return {
    dir: base,
    cleanup: async () => {
      process.env.WEA_FS_DIR = prev;
      try {
        await fs.promises.rm(base, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

/**
 * Create a test user via User model.
 * @param {Object} [opts]
 * @param {string} [opts.username='testuser']
 * @param {string} [opts.email='test@example.com']
 * @param {string} [opts.password='password123']
 * @param {boolean} [opts.isAdmin=false]
 * @param {string} [opts.status] - If set, update user status after create (e.g. USER_STATUS.APPROVED)
 * @returns {Promise<Object>} Created user (id, username, email, status, is_admin)
 */
async function createTestUser(opts = {}) {
  const username = opts.username || `testuser-${Date.now()}`;
  const email = opts.email || `test-${Date.now()}@example.com`;
  const password = opts.password || 'password123';
  const isAdmin = opts.isAdmin ?? false;

  const created = await User.create(username, email, password, isAdmin);

  if (opts.status) {
    await User.updateStatus(created.id, opts.status);
    return { ...created, status: opts.status };
  }
  return created;
}

/**
 * Generate a JWT for a user. Accepts partial user object.
 * @param {Object} user - At least { id, username }; token_version and is_admin have defaults
 * @returns {string} JWT token
 */
function createTestToken(user) {
  const full = {
    id: user.id,
    username: user.username,
    token_version: user.token_version ?? 0,
    is_admin: user.is_admin ?? 0,
  };
  return generateToken(full);
}

/**
 * Get full user (including password hash, token_version) for token generation.
 * Use when you need a token for a user created via createTestUser.
 * @param {number|string} userId
 * @returns {Promise<Object|null>}
 */
async function getFullTestUser(userId) {
  return userStore.findById(userId);
}

/**
 * Grant a permission to a user for a folder path.
 * @param {number|string} userId
 * @param {string} folderPath - e.g. '/', '/docs'
 * @param {string} [permission='read'] - 'read' | 'write' | 'admin'
 * @returns {Promise<Object>}
 */
async function grantTestPermission(userId, folderPath, permission = PERMISSIONS.READ) {
  return PermissionFacade.grant(userId, folderPath, permission);
}

/**
 * Create an approved test user with optional root permission.
 * Convenience for route tests that need an authenticated user.
 * @param {Object} [opts]
 * @param {string} [opts.username]
 * @param {string} [opts.password='password123']
 * @param {boolean} [opts.isAdmin=false]
 * @param {boolean} [opts.grantRoot=false] - Grant admin on /
 * @returns {Promise<{ user: Object, token: string }>}
 */
async function createAuthenticatedTestUser(opts = {}) {
  const user = await createTestUser({
    ...opts,
    status: USER_STATUS.APPROVED,
  });
  const full = await getFullTestUser(user.id);
  const token = createTestToken(full || user);

  if (opts.grantRoot) {
    await grantTestPermission(user.id, '/', PERMISSIONS.ADMIN);
  }

  return { user, token };
}

module.exports = {
  createTestDatabase,
  createTestUser,
  createTestToken,
  getFullTestUser,
  grantTestPermission,
  createAuthenticatedTestUser,
  PERMISSIONS,
  USER_STATUS,
};
