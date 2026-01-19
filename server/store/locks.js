const crypto = require('crypto');

const { ensureDir, writeFile, readFile, deletePath } = require('./storage');
const { LOCKS_DIR, lockPathByKey, sha256HexLower } = require('./metaPaths');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function getErrorStatus(err) {
  return err?.status || err?.response?.status;
}

/**
 * Acquire a distributed lock on WebDAV by creating a lockfile using conditional PUT.
 *
 * This relies on server-side evaluation of If-None-Match: * (412 on exists).
 * TTL is stored in the lock file to allow stale-lock recovery.
 *
 * @param {string} lockName - logical resource name (e.g. "users-index", "settings", `perm:${userId}`)
 * @param {object} options
 * @param {number} [options.ttlMs=30000]
 * @param {number} [options.waitMs=30000]
 * @param {number} [options.retryDelayMs=250]
 * @param {string} [options.owner] - identifier for debugging (hostname/pid)
 * @returns {Promise<{token: string, lockPath: string, release: function(): Promise<void>}>}
 */
async function acquireLock(lockName, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 30_000;
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 30_000;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 250;
  const owner = options.owner || `${process.env.HOSTNAME || 'host'}:${process.pid}`;

  const lockKey = sha256HexLower(lockName);
  const lockPath = lockPathByKey(lockKey);
  const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // Best-effort ensure lock directory exists
  try {
    await ensureDir(LOCKS_DIR);
  } catch (e) {
    // ignore "already exists" and other transient errors
  }

  const deadline = Date.now() + waitMs;

  while (true) {
    const payload = Buffer.from(JSON.stringify({ token, owner, createdAt, expiresAt }), 'utf8');

    try {
      await writeFile(lockPath, payload, {
        overwrite: false,
        ifNoneMatchStar: true,
        contentType: 'application/json; charset=utf-8',
      });

      // Acquired
      return {
        token,
        lockPath,
        release: async () => {
          try {
            // Only delete if we still own it
            const current = await readFile(lockPath);
            const currentObj = safeJsonParse(Buffer.from(current).toString('utf8'));
            if (currentObj?.token && currentObj.token !== token) return;
          } catch (e) {
            // If read fails, still attempt delete (best effort)
          }
          try {
            await deletePath(lockPath);
          } catch (e) {
            // Best effort: ignore
          }
        },
      };
    } catch (err) {
      const status = getErrorStatus(err);
      const isAlreadyLocked = status === 412 || status === 409;
      if (!isAlreadyLocked) {
        // If parent dirs are missing, it could be 404/409; caller should see the error
        throw err;
      }

      // Check for stale lock and clear it if expired
      try {
        const buf = await readFile(lockPath);
        const lockObj = safeJsonParse(Buffer.from(buf).toString('utf8'));
        if (lockObj?.expiresAt) {
          const exp = Date.parse(lockObj.expiresAt);
          if (Number.isFinite(exp) && exp < Date.now()) {
            try {
              await deletePath(lockPath);
            } catch {
              // ignore: races are expected
            }
          }
        }
      } catch {
        // ignore: if we can't read lockfile, we just wait/retry
      }

      if (Date.now() >= deadline) {
        const e = new Error(`Failed to acquire lock "${lockName}" within ${waitMs}ms`);
        e.code = 'LOCK_TIMEOUT';
        e.lockName = lockName;
        e.lockPath = lockPath;
        throw e;
      }

      await sleep(retryDelayMs);
    }
  }
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

