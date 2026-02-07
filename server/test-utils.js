/**
 * Test utility functions for file-store based tests
 */

const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';

let currentTestDir = null;

async function setupTestStore() {
  process.env.NODE_ENV = 'test';
  process.env.WEA_STORAGE_BACKEND = 'fs';
  process.env.WEA_DISABLE_DEFAULT_ADMIN = 'true';

  if (!currentTestDir) {
    currentTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wea-test-'));
  }
  process.env.WEA_FS_DIR = currentTestDir;

  const { initMetadataStore } = require('./store/bootstrap');
  await initMetadataStore();

  return currentTestDir;
}

async function resetTestStore() {
  await setupTestStore();
  await fs.rm(currentTestDir, { recursive: true, force: true });
  await fs.mkdir(currentTestDir, { recursive: true });
  const { initMetadataStore } = require('./store/bootstrap');
  await initMetadataStore();
}

async function teardownTestStore() {
  if (!currentTestDir) return;
  try {
    await fs.rm(currentTestDir, { recursive: true, force: true });
  } finally {
    currentTestDir = null;
  }
}

async function createTestUser(userData = {}) {
  await setupTestStore();
  const {
    username = 'testuser',
    email = `${userData.username || 'test'}@example.com`,
    password = 'password123',
    isAdmin = false,
    status = 'approved'
  } = userData;
  const User = require('./models/User');

  const created = await User.create(username, email, password, isAdmin);
  if (status && status !== created.status) {
    await User.updateStatus(created.id, status);
  }
  const row = await require('./store/userStore').findById(created.id);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    status: row.status,
    is_admin: row.is_admin,
  };
}

/**
 * Create a test JWT token
 * @param {Object} user - User object
 * @returns {string} JWT token
 */
function createTestToken(user) {
  const is_admin = user?.is_admin ? 1 : 0;
  return jwt.sign(
    { id: user.id, username: user.username, is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function grantTestPermission(userId, folderPath, permission = 'read') {
  await setupTestStore();
  const Permission = require('./models/Permission');
  return await Permission.grant(userId, folderPath, permission);
}

module.exports = {
  setupTestStore,
  resetTestStore,
  teardownTestStore,
  createTestUser,
  createTestToken,
  grantTestPermission,
};

