/**
 * Test utilities for server tests.
 * Provides helpers for creating isolated test data: users, tokens, permissions.
 * @see docs/TEST_GIT_GUIDE.md
 * @see docs/TESTING_STRATEGY.md
 */
const crypto = require('crypto');
const fs = require('fs');

const User = require('./models/User');
const userStore = require('./store/userStore');
const permissionStore = require('./store/permissionStore');
const { generateToken } = require('./utils/auth');
const { initMetadataStore } = require('./store/bootstrap');
const storage = require('./store/storage');
const { createFileNodesStore } = require('./store/fileNodesStore');
const { createAncestryHelper } = require('./service/_ancestryHelper');
const { dbQuery, dbRun, truncateAllTables } = require('./testing/dbUtils');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');

/**
 * True when the active test backend is SQLite. Use with Jest's
 * describe.skipIf(...) / test.skipIf(...) to gate suites that can only run on
 * SQLite (e.g. because a production PostgreSQL path is not yet functional).
 * @returns {boolean}
 */
function isSqliteBackend() {
  return storage.getBackend() === 'sqlite';
}

/**
 * Create an isolated test database.
 * For SQLite: creates a unique file-based DB per test suite (no shared :memory:).
 * For PostgreSQL: the real-PG test leg is driven by the dedicated WEA_TEST_PG_*
 * namespace (see test-setup.js). A pg Pool is built from it and injected through
 * storage.setTestBackend so the harness never touches production WEA_DB_* env.
 * Use in beforeAll; call cleanup() in afterAll.
 * @returns {Promise<{ dir: string|null, cleanup: () => Promise<void> }>}
 */
const TEST_PG_KEYS = ['WEA_TEST_PG_HOST', 'WEA_TEST_PG_PORT', 'WEA_TEST_PG_USER', 'WEA_TEST_PG_PASSWORD', 'WEA_TEST_PG_DATABASE'];

function wantsRemoteTestPg() {
  return TEST_PG_KEYS.some((key) => !!process.env[key]) || storage.isTestBackendOverridden();
}

async function createTestDatabase() {
  if (!wantsRemoteTestPg()) {
    const dbPath = `/tmp/wea-test-${crypto.randomUUID()}.db`;
    const prevSqlitePath = process.env.WEA_SQLITE_PATH;

    // Close any connection left open by a previous suite sharing this
    // worker process before pointing WEA_SQLITE_PATH at the new DB.
    try {
      await storage.closeSqliteDb();
    } catch {
      /* ignore */
    }

    process.env.WEA_SQLITE_PATH = dbPath;
    await initMetadataStore();

    return {
      dir: dbPath,
      cleanup: async () => {
        process.env.WEA_SQLITE_PATH = prevSqlitePath;
        try {
          storage.closeSqliteDb();
        } catch {
          /* ignore */
        }
        try {
          await fs.promises.unlink(dbPath);
        } catch {
          /* ignore cleanup errors */
        }
      },
    };
  }

  // PostgreSQL path: build a pool from the WEA_TEST_PG_* namespace and inject it
  // through the storage test-only override, then apply the (idempotent) schema
  // and wipe every table so each suite starts clean. Suites run serially
  // (--runInBand) which is what makes per-suite truncation safe.
  if (!storage.isTestBackendOverridden()) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const dbName = process.env.WEA_TEST_PG_DATABASE || 'webdav_test';
    // Self-provision the disposable test database when it does not exist yet
    // (the jest PG leg targets `webdav_test`, which no compose file creates).
    // Requires a connection user with CREATEDB — the e2e compose user has it.
    try {
      const probe = new Pool({
        host: process.env.WEA_TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.WEA_TEST_PG_PORT || 5433),
        database: 'postgres',
        user: process.env.WEA_TEST_PG_USER || 'e2etest',
        password: process.env.WEA_TEST_PG_PASSWORD || 'e2etest',
      });
      try {
        const res = await probe.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (res.rows.length === 0) {
          // Identifier quoting: DB names in the allowlist are plain, but quote
          // defensively. CREATE DATABASE cannot use bound parameters.
          const safeName = dbName.replace(/[^A-Za-z0-9_]/g, '');
          if (safeName !== dbName || safeName.length === 0) {
            throw new Error(`Refusing to create test database with unsafe name: ${dbName}`);
          }
          await probe.query(`CREATE DATABASE ${safeName}`);
        }
      } finally {
        await probe.end();
      }
    } catch {
      // Probe failures (no CREATEDB, unreachable) fall through — the schema
      // init below fails with a clear error if the DB really is missing.
    }
    const pool = new Pool({
      host: process.env.WEA_TEST_PG_HOST || '127.0.0.1',
      port: Number(process.env.WEA_TEST_PG_PORT || 5433),
      database: dbName,
      user: process.env.WEA_TEST_PG_USER || 'e2etest',
      password: process.env.WEA_TEST_PG_PASSWORD || 'e2etest',
    });
    storage.setTestBackend('postgresql', pool);
  }
  await initMetadataStore();
  await truncateAllTables();

  return {
    dir: null,
    cleanup: async () => {
      // Suites run serially (--runInBand); closing the shared pool here lets
      // the final suite release the event loop so Jest can exit cleanly. The
      // pool is recreated lazily by the next suite that needs it.
      try {
        await storage.closePgPool();
      } catch {
        /* ignore */
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
 * Grant a permission to a user for a node.
 * @param {Object} opts
 * @param {number|string} opts.userId
 * @param {number|string} opts.fileNodeId
 * @param {string} [opts.permission='read'] - 'read' | 'write' | 'admin'
 * @returns {Promise<Object>}
 */
async function grantTestPermissionByNodeId({ userId, fileNodeId, permission = PERMISSIONS.READ }) {
  return permissionStore.grant(userId, fileNodeId, permission);
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
    isAdmin: opts.grantRoot ? true : (opts.isAdmin ?? false),
  });
  const full = await getFullTestUser(user.id);
  const token = createTestToken(full || user);

  return { user, token };
}

/**
 * Create a test file-node in the DB and build its ancestor-chain entries.
 * Resolves the display path by walking the ancestor chain back to root.
 * @param {Object} opts
 * @param {string} opts.name - Node name (file or directory name segment)
 * @param {'file'|'directory'} [opts.type='file']
 * @param {number|null} [opts.parentId=null] - Parent node ID; null for root-level nodes
 * @returns {Promise<{ nodeId: number, path: string }>}
 */
async function createTestFileNode({ name, type = 'file', parentId = null }) {
  const store = createFileNodesStore();
  const ancestry = createAncestryHelper(store);

  const node = await store.createNode(parentId, name, type);
  await ancestry.buildAncestorsForNode(node.id, parentId);

  // Resolve display path by walking ancestor chain from root to this node.
  const chain = await store.getAncestorChain(node.id);
  const segments = [];
  for (const entry of chain) {
    const anc = await store.getNode(entry.ancestorId);
    if (anc) {
      segments.push(anc.name);
    }
  }

  return { nodeId: node.id, path: `/${segments.join('/')}` };
}

/**
 * Set up a user's root directory node named after their username.
 * @param {Object} opts
 * @param {number|string} opts.userId
 * @returns {Promise<{ nodeId: number }>}
 */
async function createUserRootNode({ userId }) {
  const user = await userStore.findById(Number(userId));
  if (!user || !user.username) {
    throw new Error(`User ${userId} not found; cannot create root node`);
  }
  const result = await createTestFileNode({
    name: user.username,
    type: 'directory',
    parentId: null,
  });
  return { nodeId: result.nodeId };
}

/**
 * Create a chain of nested directories from an array of segment names.
 * Each segment becomes a child directory of the previous one.
 * @param {Object} opts
 * @param {number|null} [opts.parentId=null] - Starting parent node ID
 * @param {string[]} opts.segments - Array of directory name segments
 * @returns {Promise<{ nodeIds: number[], paths: string[] }>}
 */
async function createNestedStructure({ parentId = null, segments }) {
  const nodeIds = [];
  const paths = [];
  let currentParentId = parentId;

  for (const segment of segments) {
    const result = await createTestFileNode({
      name: segment,
      type: 'directory',
      parentId: currentParentId,
    });
    nodeIds.push(result.nodeId);
    paths.push(result.path);
    currentParentId = result.nodeId;
  }

  return { nodeIds, paths };
}

/**
 * Create a file-node with an object_map entry and S3 mock blob in one call.
 * @param {Object} opts
 * @param {number|string} opts.userId - Used to look up user root if parentId is omitted
 * @param {string} opts.name - File name
 * @param {number|null} [opts.parentId] - Parent node ID (optional; falls back to user root)
 * @param {string|Buffer} opts.content - File content
 * @param {string} [opts.mimeType='text/plain']
 * @param {Object} opts.s3Mock - S3 mock instance with putObject({ input: { Bucket, Key, Body, ContentType } })
 * @returns {Promise<{ nodeId: number, s3Key: string, path: string }>}
 */
async function createTestFileWithBlob({
  userId,
  name,
  parentId,
  content,
  mimeType = 'text/plain',
  s3Mock,
}) {
  // If no parentId provided, use the user's root node.
  if (parentId == null) {
    const rootResult = await createUserRootNode({ userId });
    parentId = rootResult.nodeId;
  }

  const fileResult = await createTestFileNode({ name, type: 'file', parentId });
  const s3Key = crypto.randomUUID();

  // Insert object_map entry directly via the backend-neutral helper.
  await dbRun(
    `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
     VALUES (?, ?, 's3', 1, 'active')`,
    [Number(fileResult.nodeId), s3Key]
  );

  // Store content in the S3 mock.
  await s3Mock.putObject({
    input: {
      Bucket: 'test-bucket',
      Key: s3Key,
      Body: Buffer.from(content),
      ContentType: mimeType,
    },
  });

  return { nodeId: fileResult.nodeId, s3Key, path: fileResult.path };
}

module.exports = {
  createTestDatabase,
  createTestUser,
  createTestToken,
  getFullTestUser,
  grantTestPermissionByNodeId,
  createAuthenticatedTestUser,
  PERMISSIONS,
  USER_STATUS,
  // Phase 4 Wave 5 — nodeId-based test utilities
  createTestFileNode,
  createUserRootNode,
  createNestedStructure,
  createTestFileWithBlob,
  // Backend-neutral DB helpers (dispatch on storage.getBackend())
  dbQuery,
  dbRun,
  isSqliteBackend,
};
