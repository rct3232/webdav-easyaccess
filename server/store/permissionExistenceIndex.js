const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { asyncLimit } = require('../utils/asyncUtils');
const { pathExists } = require('../utils/webdav');

const existenceIndex = new Map(); // normalizedPath -> { state: 'exists'|'missing', checkedAt: number }
const queuedReconciliationPaths = new Set();

let reconciliationLoopPromise = null;
let existenceIndexVersion = 0;

const existenceTtlMs =
  parseInt(process.env.PERMISSIONS_EXISTENCE_INDEX_TTL_MS || '30000', 10) || 30000;
const reconciliationConcurrency =
  parseInt(process.env.PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY || '4', 10) || 4;
const reconciliationBatchSize =
  parseInt(process.env.PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE || '100', 10) || 100;

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

function getExistenceState(path, now = Date.now()) {
  const normalizedPath = normalizedExistencePath(path);
  const entry = existenceIndex.get(normalizedPath);
  if (!entry || typeof entry.checkedAt !== 'number') return 'unknown';
  if (now - entry.checkedAt > existenceTtlMs) return 'unknown';
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
    if (
      normalizedPath === '/' ||
      queuedPath === normalizedPath ||
      queuedPath.startsWith(prefix)
    ) {
      queuedReconciliationPaths.delete(queuedPath);
      changed = true;
    }
  }

  if (changed) {
    existenceIndexVersion++;
  }
}

function invalidateExistenceIndexForAclMutation(path) {
  invalidateExistenceIndexByPrefix(path);
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
    while (queuedReconciliationPaths.size > 0) {
      const batch = Array.from(queuedReconciliationPaths).slice(0, reconciliationBatchSize);
      for (const path of batch) {
        queuedReconciliationPaths.delete(path);
      }

      await asyncLimit(reconciliationConcurrency, batch, async (path) => {
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
