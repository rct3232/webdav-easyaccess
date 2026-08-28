const crypto = require('crypto');

const { getBackend, getPgPool, isSqliteBackend, withSqliteTransaction, sqliteRun } = require('../store/storage');
const { sha256HexLower } = require('../utils/hash');
const { getSharedResolver } = require('./configResolver');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeTimeoutError(lockName, waitMs) {
  const err = new Error(`Failed to acquire lock "${lockName}" within ${waitMs}ms`);
  err.code = 'LOCK_TIMEOUT';
  err.lockName = lockName;
  return err;
}

function createPostgresqlLockRelease(lockKey, token) {
  let released = false;
  return async () => {
    if (released) return;
    released = true;

    try {
      const pool = getPgPool();
      await pool.query(
        'DELETE FROM locks WHERE lock_name_hash = $1 AND token = $2',
        [lockKey, token]
      );
    } catch {
      // Best effort: ignore.
    }
  };
}

function createSqliteLockRelease(lockKey, token) {
  let released = false;
  return async () => {
    if (released) return;
    released = true;

    try {
      await sqliteRun(
        'DELETE FROM locks WHERE lock_name_hash = ? AND token = ?',
        [lockKey, token]
      );
    } catch {
      // Best effort: ignore.
    }
  };
}

async function acquirePostgresqlLock(lockName, lockKey, token, owner, ttlMs, waitMs, retryDelayMs) {
  const deadline = Date.now() + waitMs;
  while (true) {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);

    const pool = getPgPool();
    await pool.query(
      'DELETE FROM locks WHERE lock_name_hash = $1 AND expires_at < NOW()',
      [lockKey]
    );
    const insertResult = await pool.query(
      `INSERT INTO locks (lock_name_hash, token, owner, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (lock_name_hash) DO NOTHING
        RETURNING lock_name_hash`,
      [lockKey, token, owner, createdAt, expiresAt]
    );

    if (insertResult.rowCount > 0) {
      return {
        token,
        release: createPostgresqlLockRelease(lockKey, token),
      };
    }

    if (Date.now() >= deadline) {
      throw makeTimeoutError(lockName, waitMs);
    }
    await sleep(retryDelayMs);
  }
}

async function acquireSqliteLock(lockName, lockKey, token, owner, ttlMs, waitMs, retryDelayMs) {
  const deadline = Date.now() + waitMs;
  while (true) {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);

    try {
      const lock = await withSqliteTransaction(async (client) => {
        await client.query(
          'DELETE FROM locks WHERE lock_name_hash = ? AND expires_at < CURRENT_TIMESTAMP',
          [lockKey]
        );
        // client.query uses db.all() and never returns .changes, so use
        // sqliteRun (same connection, inside the serialize transaction) for
        // the INSERT to detect a successful acquire via changes > 0.
        const insertResult = await sqliteRun(
          `INSERT INTO locks (lock_name_hash, token, owner, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [lockKey, token, owner, createdAt, expiresAt]
        );

        if (insertResult.changes > 0) {
          return {
            token,
            release: createSqliteLockRelease(lockKey, token),
          };
        }
        return null;
      });
      if (lock) return lock;
    } catch {
      // Insert failed (lock held); retry loop handles contention.
    }

    if (Date.now() >= deadline) {
      throw makeTimeoutError(lockName, waitMs);
    }
    await sleep(retryDelayMs);
  }
}

/**
 * Acquire a distributed lock with backend-specific strategy.
 *
 * postgresql: lock row + stale row cleanup + ON CONFLICT retry.
 * sqlite: lock row + stale row cleanup + INSERT-or-fail retry.
 *
 * @param {string} lockName - logical resource name (e.g. "users-index", "settings", `perm:${userId}`)
 * @param {object} options
 * @param {number} [options.ttlMs=30000]
 * @param {number} [options.waitMs=30000]
 * @param {number} [options.retryDelayMs=250]
 * @param {string} [options.owner] - identifier for debugging (hostname/pid)
 * @returns {Promise<{token: string, release: function(): Promise<void>}>}
 */
async function acquireLock(lockName, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 30_000;
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 30_000;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 250;
  // HOSTNAME is T2 (hot) and read per lock acquisition (debug owner label only).
  const hostname = getSharedResolver().getConfigSync('HOSTNAME') || 'host';
  const owner = options.owner || `${hostname}:${process.pid}`;

  const lockKey = sha256HexLower(lockName);
  const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const backend = getBackend();

  if (backend === 'postgresql') {
    return acquirePostgresqlLock(lockName, lockKey, token, owner, ttlMs, waitMs, retryDelayMs);
  }

  if (isSqliteBackend()) {
    return acquireSqliteLock(lockName, lockKey, token, owner, ttlMs, waitMs, retryDelayMs);
  }

  throw new Error(`No lock strategy for backend: ${backend}`);
}

async function withLock(lockName, fn, options = {}) {
  const lock = await acquireLock(lockName, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

module.exports = {
  acquireLock,
  withLock,
};
