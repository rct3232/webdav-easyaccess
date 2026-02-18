const {
  PERMISSIONS,
  PERMISSION_REQUEST_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../utils/errorHandler');
const { META_ROOT } = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile } = require('./storage');
const { withLock } = require('./locks');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

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
  if (p === PERMISSIONS.READ || p === PERMISSIONS.WRITE) return p;
  return null;
}

function normalizeStatus(s) {
  return PERMISSION_REQUEST_STATUS.isValid(s) ? s : null;
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

const TARGET_TYPE = { FOLDER: 'folder', FILE: 'file' };

function sanitizeRequest(r) {
  if (!r || typeof r !== 'object') return null;
  const id = Number.isInteger(r.id) ? r.id : null;
  const requester_id = Number.isInteger(r.requester_id) ? r.requester_id : null;
  const owner_id = Number.isInteger(r.owner_id) ? r.owner_id : null;
  const folder_path = typeof r.folder_path === 'string' ? normalizePath(r.folder_path) : null;
  const file_path = typeof r.file_path === 'string' ? normalizePath(r.file_path) : null;
  const target_type = r.target_type === TARGET_TYPE.FILE ? TARGET_TYPE.FILE : TARGET_TYPE.FOLDER;
  const requested_permission = normalizePermission(r.requested_permission);
  const status = normalizeStatus(r.status);

  if (!id || !requester_id || !owner_id || !requested_permission || !status) return null;
  if (!folder_path && !file_path) return null;

  return {
    id,
    requester_id,
    requester_username: typeof r.requester_username === 'string' ? r.requester_username : '',
    owner_id,
    owner_username: typeof r.owner_username === 'string' ? r.owner_username : '',
    folder_path: folder_path || null,
    file_path: file_path || null,
    target_type,
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
  filePath,
  requestedPermission,
  message = '',
}) {
  const perm = normalizePermission(requestedPermission);
  if (!perm) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidPermission, 400);
  }

  const isFileRequest = typeof filePath === 'string' && filePath.trim() !== '';
  const folder_path = isFileRequest ? null : (folderPath ? normalizePath(folderPath) : null);
  const file_path = isFileRequest ? normalizePath(filePath) : null;
  const target_type = isFileRequest ? TARGET_TYPE.FILE : TARGET_TYPE.FOLDER;

  if (!isFileRequest && !folder_path) {
    throw createError(SERVER_ERROR_CODES.permissionRequests.folderOrFileRequired, 400);
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
          r.status === PERMISSION_REQUEST_STATUS.PENDING &&
          r.requester_id === requesterId &&
          r.owner_id === ownerId &&
          r.requested_permission === perm &&
          (isFileRequest
            ? r.file_path === file_path
            : r.folder_path === folder_path)
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
      file_path: file_path || null,
      target_type,
      requested_permission: perm,
      status: PERMISSION_REQUEST_STATUS.PENDING,
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
    throw createError(SERVER_ERROR_CODES.permissionRequests.invalidStatus, 400);
  }

  return await withLock('permission_requests', async () => {
    const doc = await readDoc();
    doc.requests = Array.isArray(doc.requests) ? doc.requests : [];

    const idx = doc.requests.findIndex((r) => r && Number(r.id) === Number(id));
    if (idx === -1) {
      throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, 404);
    }

    const current = sanitizeRequest(doc.requests[idx]);
    if (!current) {
      // If corrupted entry, treat as not found
      throw createError(SERVER_ERROR_CODES.permissionRequests.requestNotFound, 404);
    }

    const updated = {
      ...current,
      status: nextStatus,
      resolved_at: nextStatus === PERMISSION_REQUEST_STATUS.PENDING ? '' : nowIso(),
      resolved_by: nextStatus === PERMISSION_REQUEST_STATUS.PENDING ? null : (Number.isInteger(resolvedBy) ? resolvedBy : null),
    };

    doc.requests[idx] = updated;
    await writeDoc(doc);
    return updated;
  });
}

async function deleteByRequesterId(userId) {
  return await withLock('permission_requests', async () => {
    const doc = await readDoc();
    doc.requests = Array.isArray(doc.requests) ? doc.requests : [];

    const initialCount = doc.requests.length;
    doc.requests = doc.requests.filter((r) => {
      const sanitized = sanitizeRequest(r);
      return !sanitized || sanitized.requester_id !== Number(userId);
    });

    const deletedCount = initialCount - doc.requests.length;
    if (deletedCount > 0) {
      await writeDoc(doc);
    }

    return { deletedCount };
  });
}

async function rejectByOwnerId(userId, resolvedBy = null) {
  return await withLock('permission_requests', async () => {
    const doc = await readDoc();
    doc.requests = Array.isArray(doc.requests) ? doc.requests : [];

    let rejectedCount = 0;
    const now = nowIso();

    for (let i = 0; i < doc.requests.length; i++) {
      const sanitized = sanitizeRequest(doc.requests[i]);
      if (sanitized && sanitized.owner_id === Number(userId) && sanitized.status === PERMISSION_REQUEST_STATUS.PENDING) {
        doc.requests[i] = {
          ...sanitized,
          status: PERMISSION_REQUEST_STATUS.REJECTED,
          resolved_at: now,
          resolved_by: Number.isInteger(resolvedBy) ? resolvedBy : null,
        };
        rejectedCount++;
      }
    }

    if (rejectedCount > 0) {
      await writeDoc(doc);
    }

    return { rejectedCount };
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
  deleteByRequesterId,
  rejectByOwnerId,
};

