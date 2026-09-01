const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { asyncLimit } = require('../../../utils/asyncUtils');
const { pathExists } = require('../../../utils/webdav');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

const existenceIndex = new Map(); // normalizedPath -> { state: 'exists'|'missing', checkedAt: number }
const queuedReconciliationPaths = new Set();

let reconciliationLoopPromise = null;
let existenceIndexVersion = 0;

function normalizedExistencePath(path) {
  return normalizePath(path || '/');
}

function getIndexVersion() {
  return existenceIndexVersion;
}

function makeUserPermissionsEtag(userId, updatedAt) {
  return `"permissions-user-${userId}-${updatedAt || 'na'}-${getIndexVersion()}"`;
}

function setExistenceState(path, state, checkedAt = Date.now()) {
  const normalizedPath = normalizedExistencePath(path);
  existenceIndex.set(normalizedPath, { state, checkedAt });
  existenceIndexVersion++;
}

// PERMISSIONS_EXISTENCE_INDEX_TTL_MS is T2 (lazy): read the effective value per
// call so DB-sourced edits apply without a restart.
async function getExistenceState(path, now = Date.now()) {
  const normalizedPath = normalizedExistencePath(path);
  const entry = existenceIndex.get(normalizedPath);
  if (!entry || typeof entry.checkedAt !== 'number') return 'unknown';
  const ttlMs =
    parseInt(await getSharedResolver().getConfig('PERMISSIONS_EXISTENCE_INDEX_TTL_MS'), 10) ||
    30000;
  if (now - entry.checkedAt > ttlMs) {
    existenceIndex.delete(normalizedPath);
    return 'unknown';
  }
  return entry.state;
}

function invalidateExistenceIndexByPrefix(path) {
  const normalizedPath = normalizedExistencePath(path);
  const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
  let changed = false;

  for (const key of existenceIndex.keys()) {
    if (normalizedPath === '/' || key === normalizedPath || key.startsWith(prefix)) {
      existenceIndex.delete(key);
      changed = true;
    }
  }

  for (const queuedPath of Array.from(queuedReconciliationPaths)) {
    if (normalizedPath === '/' || queuedPath === normalizedPath || queuedPath.startsWith(prefix)) {
      queuedReconciliationPaths.delete(queuedPath);
      changed = true;
    }
  }

  if (changed) {
    existenceIndexVersion++;
  }
}

function invalidateExistenceIndexForAclMutation(pathOrNodeId) {
  if (typeof pathOrNodeId === 'number') return;
  invalidateExistenceIndexByPrefix(pathOrNodeId);
}

function queueReconciliation(path) {
  const normalizedPath = normalizedExistencePath(path);
  if (queuedReconciliationPaths.has(normalizedPath)) return;
  queuedReconciliationPaths.add(normalizedPath);

  if (!reconciliationLoopPromise) {
    reconciliationLoopPromise = runReconciliationLoop().catch((error) => {
      console.error('Permissions reconciliation loop failed:', error);
    });
  }
}

async function runReconciliationLoop() {
  try {
    const resolver = getSharedResolver();
    while (queuedReconciliationPaths.size > 0) {
      // PERMISSIONS_EXISTENCE_RECONCILE_* are T2 (lazy): re-read the effective
      // values each iteration so DB-sourced edits apply without a restart.
      const [batchSize, concurrency] = await Promise.all([
        parseInt(await resolver.getConfig('PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE'), 10),
        parseInt(await resolver.getConfig('PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY'), 10),
      ]);
      const batch = Array.from(queuedReconciliationPaths).slice(0, batchSize || 100);
      for (const path of batch) {
        queuedReconciliationPaths.delete(path);
      }

      await asyncLimit(concurrency || 4, batch, async (path) => {
        try {
          const exists = await pathExists(path);
          setExistenceState(path, exists ? 'exists' : 'missing');
        } catch (error) {
          // Keep unknown semantics on transient reconciliation failures.
          console.error(`Failed to reconcile permission path existence for ${path}:`, error);
        }
      });
    }
  } finally {
    reconciliationLoopPromise = null;
    if (queuedReconciliationPaths.size > 0 && !reconciliationLoopPromise) {
      reconciliationLoopPromise = runReconciliationLoop().catch((error) => {
        console.error('Permissions reconciliation loop retry failed:', error);
      });
    }
  }
}

function getQueuedReconciliationCount() {
  return queuedReconciliationPaths.size;
}

function __resetForTests() {
  existenceIndex.clear();
  queuedReconciliationPaths.clear();
  existenceIndexVersion = 0;
  reconciliationLoopPromise = null;
}

module.exports = {
  getExistenceState,
  makeUserPermissionsEtag,
  queueReconciliation,
  invalidateExistenceIndexForAclMutation,
  getQueuedReconciliationCount,
  __resetForTests,
};
