const { META_ROOT } = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile } = require('./storage');
const { withLock } = require('./locks');
const { normalizePath } = require('../utils/pathUtils');

const PERMISSION_REQUESTS_PATH = `${META_ROOT}/permission_requests.json`;

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizePermission(p) {
  if (p === 'read' || p === 'write') return p;
  return null;
}

function normalizeStatus(s) {
  const allowed = new Set(['pending', 'approved', 'rejected', 'cancelled']);
  if (allowed.has(s)) return s;
  return null;
}

async function ensurePermissionRequestsFile() {
  await ensureDir(META_ROOT);
  if (!(await exists(PERMISSION_REQUESTS_PATH))) {
    const initial = {
      nextId: 1,
      requests: [],
      updated_at: nowIso(),
    };
    await writeFile(PERMISSION_REQUESTS_PATH, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }
}

async function readDoc() {
  await ensurePermissionRequestsFile();
  const buf = await readFile(PERMISSION_REQUESTS_PATH);
  const text = Buffer.from(buf).toString('utf8');
  const parsed = safeJsonParse(text);

  if (
    parsed &&
    typeof parsed === 'object' &&
    Number.isInteger(parsed.nextId) &&
    Array.isArray(parsed.requests)
  ) {
    return parsed;
  }

  // Reset if corrupted
  const fallback = {
    nextId: 1,
    requests: [],
    updated_at: nowIso(),
  };
  await writeFile(PERMISSION_REQUESTS_PATH, JSON.stringify(fallback, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  return fallback;
}

async function writeDoc(doc) {
  doc.updated_at = nowIso();
  await writeFile(PERMISSION_REQUESTS_PATH, JSON.stringify(doc, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
}

function sanitizeRequest(r) {
  if (!r || typeof r !== 'object') return null;
  const id = Number.isInteger(r.id) ? r.id : null;
  const requester_id = Number.isInteger(r.requester_id) ? r.requester_id : null;
  const owner_id = Number.isInteger(r.owner_id) ? r.owner_id : null;
  const folder_path = typeof r.folder_path === 'string' ? normalizePath(r.folder_path) : null;
  const requested_permission = normalizePermission(r.requested_permission);
  const status = normalizeStatus(r.status);

  if (!id || !requester_id || !owner_id || !folder_path || !requested_permission || !status) return null;

  return {
    id,
    requester_id,
    requester_username: typeof r.requester_username === 'string' ? r.requester_username : '',
    owner_id,
    owner_username: typeof r.owner_username === 'string' ? r.owner_username : '',
    folder_path,
    requested_permission,
    status,
    message: typeof r.message === 'string' ? r.message : '',
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
    resolved_at: typeof r.resolved_at === 'string' ? r.resolved_at : '',
    resolved_by: Number.isInteger(r.resolved_by) ? r.resolved_by : null,
  };
}

async function createRequest({
  requesterId,
  requesterUsername,
  ownerId,
  ownerUsername,
  folderPath,
  requestedPermission,
  message = '',
}) {
  const folder_path = normalizePath(folderPath);
  const perm = normalizePermission(requestedPermission);
  if (!perm) {
    const e = new Error('Invalid requested permission');
    e.code = 'INVALID_PERMISSION';
    throw e;
  }

  return await withLock('permission_requests', async () => {
    const doc = await readDoc();
    doc.requests = Array.isArray(doc.requests) ? doc.requests : [];

    // De-dupe: existing pending for same tuple
    const existing = doc.requests
      .map(sanitizeRequest)
      .filter(Boolean)
      .find(
        (r) =>
          r.status === 'pending' &&
          r.requester_id === requesterId &&
          r.owner_id === ownerId &&
          r.folder_path === folder_path &&
          r.requested_permission === perm
      );

    if (existing) {
      return existing;
    }

    const id = Number.isInteger(doc.nextId) ? doc.nextId : 1;
    doc.nextId = id + 1;

    const created = {
      id,
      requester_id: requesterId,
      requester_username: requesterUsername || '',
      owner_id: ownerId,
      owner_username: ownerUsername || '',
      folder_path,
      requested_permission: perm,
      status: 'pending',
      message: typeof message === 'string' ? message : '',
      created_at: nowIso(),
      resolved_at: '',
      resolved_by: null,
    };

    doc.requests.push(created);
    await writeDoc(doc);
    return created;
  });
}

async function getById(id) {
  const doc = await readDoc();
  const req = (doc.requests || []).map(sanitizeRequest).filter(Boolean).find((r) => r.id === Number(id));
  return req || null;
}

async function listInbox(ownerId, { status } = {}) {
  const doc = await readDoc();
  const normalizedStatus = status ? normalizeStatus(status) : null;
  return (doc.requests || [])
    .map(sanitizeRequest)
    .filter(Boolean)
    .filter((r) => r.owner_id === Number(ownerId))
    .filter((r) => (normalizedStatus ? r.status === normalizedStatus : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

async function listOutbox(requesterId, { status } = {}) {
  const doc = await readDoc();
  const normalizedStatus = status ? normalizeStatus(status) : null;
  return (doc.requests || [])
    .map(sanitizeRequest)
    .filter(Boolean)
    .filter((r) => r.requester_id === Number(requesterId))
    .filter((r) => (normalizedStatus ? r.status === normalizedStatus : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

async function updateStatus(id, { status, resolvedBy } = {}) {
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) {
    const e = new Error('Invalid status');
    e.code = 'INVALID_STATUS';
    throw e;
  }

  return await withLock('permission_requests', async () => {
    const doc = await readDoc();
    doc.requests = Array.isArray(doc.requests) ? doc.requests : [];

    const idx = doc.requests.findIndex((r) => r && Number(r.id) === Number(id));
    if (idx === -1) {
      const e = new Error('Request not found');
      e.code = 'NOT_FOUND';
      throw e;
    }

    const current = sanitizeRequest(doc.requests[idx]);
    if (!current) {
      // If corrupted entry, treat as not found
      const e = new Error('Request not found');
      e.code = 'NOT_FOUND';
      throw e;
    }

    const updated = {
      ...current,
      status: nextStatus,
      resolved_at: nextStatus === 'pending' ? '' : nowIso(),
      resolved_by: nextStatus === 'pending' ? null : (Number.isInteger(resolvedBy) ? resolvedBy : null),
    };

    doc.requests[idx] = updated;
    await writeDoc(doc);
    return updated;
  });
}

module.exports = {
  PERMISSION_REQUESTS_PATH,
  ensurePermissionRequestsFile,
  createRequest,
  getById,
  listInbox,
  listOutbox,
  updateStatus,
};

