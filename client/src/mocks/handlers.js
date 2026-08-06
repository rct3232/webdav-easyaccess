/**
 * MSW handlers aligned with docs/api.md and actual server routes.
 * File mutations use the batch endpoints (batch-move/batch-copy/batch-delete,
 * PUT /rename) as well as the single-node POST /files/move, POST /files/copy,
 * DELETE /files/delete routes exposed by server/domains/files/routes/crud.js.
 * @see docs/api.md
 * @see docs/shared-contracts.md
 */
import { http, HttpResponse } from 'msw';

const API_BASE = '/api';

// Mock in-memory state for file operations (shared across handlers)
const mockFiles = new Map();
const mockBulkJobs = new Map();
let jobIdCounter = 0;

// Controlled delay seam for batch-job completion. Tests may set this to 0 to
// avoid real-time waits (docs/TESTING_STRATEGY.md "Avoid real-time waits").
let bulkJobDelayMs = 50;

export function __setBatchDelayForTests(ms) {
  bulkJobDelayMs = ms;
}

// Mock state for permission requests and share links (tests may override via server.use)
export const mockPermissionRequests = {
  inbox: [],
  outbox: [],
};
export const mockShareLinks = [];

// Mock admin state (tests may override via server.use)
export const mockAdminSettings = { registration_enabled: 'false' };
export const mockAdminUsers = {
  pending: [
    { id: 'p1', username: 'pending1', email: 'pending1@example.com', status: 'pending', created_at: new Date().toISOString(), is_admin: false },
  ],
  approved: [
    { id: '1', username: 'user1', email: 'user1@example.com', status: 'approved', created_at: new Date().toISOString(), is_admin: false },
  ],
};

// Restore module-level mock state between tests so POST-handler mutations
// (bulk jobs, permission requests, share links, admin users) do not leak.
// Wired into client/src/setupTests.js beforeEach (docs/TESTING_STRATEGY.md).
export function __resetHandlersState() {
  mockFiles.clear();
  mockBulkJobs.clear();
  jobIdCounter = 0;
  mockPermissionRequests.inbox.length = 0;
  mockPermissionRequests.outbox.length = 0;
  mockShareLinks.length = 0;
  for (const key of Object.keys(mockAdminSettings)) {
    delete mockAdminSettings[key];
  }
  mockAdminSettings.registration_enabled = 'false';
  mockAdminUsers.pending.splice(0, mockAdminUsers.pending.length,
    { id: 'p1', username: 'pending1', email: 'pending1@example.com', status: 'pending', created_at: new Date().toISOString(), is_admin: false });
  mockAdminUsers.approved.splice(0, mockAdminUsers.approved.length,
    { id: '1', username: 'user1', email: 'user1@example.com', status: 'approved', created_at: new Date().toISOString(), is_admin: false });
}

function nextJobId() {
  jobIdCounter += 1;
  return `job_${jobIdCounter}_${Date.now()}`;
}

// Helper: standard error response per shared-contracts.md
function errorResponse(errorCode, status = 400, params = {}) {
  return HttpResponse.json(
    { errorCode, params },
    { status }
  );
}

// Public share tokens considered valid by the shared /share/:token/* mocks
// (mirrors the invalid/expired 404 behaviour of the /info handler).
const publicShareIsValid = (token) => token !== 'invalid' && token !== 'expired';

export const handlers = [
  // --- Auth ---
  http.post(`${API_BASE}/auth/register`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.username || !body.email || !body.password) {
      return errorResponse('serverErrors.auth.requiredFields', 400);
    }
    return HttpResponse.json({
      messageCode: 'serverMessages.auth.registerSuccess',
      status: 'pending',
      user: { id: '1', username: body.username, email: body.email, status: 'pending' },
    }, { status: 201 });
  }),

  http.post(`${API_BASE}/auth/login`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.username || !body.password) {
      return errorResponse('serverErrors.auth.loginRequiredFields', 400);
    }
    return HttpResponse.json({
      messageCode: 'serverMessages.auth.loginSuccess',
      token: 'mock-jwt-token',
      refreshToken: 'mock-refresh-token',
      user: {
        id: '1',
        username: body.username,
        email: 'user@example.com',
        is_admin: false,
        status: 'approved',
      },
    });
  }),

  http.post(`${API_BASE}/auth/refresh`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.refreshToken) {
      return errorResponse('serverErrors.auth.refreshTokenInvalid', 401);
    }
    return HttpResponse.json({ token: 'mock-jwt-token-refreshed' });
  }),

  http.get(`${API_BASE}/auth/me`, () => {
    return HttpResponse.json({
      id: '1',
      username: 'testuser',
      email: 'user@example.com',
      is_admin: false,
      status: 'approved',
    });
  }),

  // --- Files: list, download, upload ---
  http.get(`${API_BASE}/files/list`, ({ request }) => {
    const url = new URL(request.url);
    const nodeIdParam = url.searchParams.get('nodeId');
    const custom = mockFiles.get(nodeIdParam);
    if (custom) return HttpResponse.json(custom);
    const rootItems = [
      { nodeId: 1, name: 'test.txt', type: 'file', display_path: '/testuser/test.txt', size: 0, mimeType: 'text/plain', modifiedAt: '2024-01-01T10:00:00Z', hasReadPermission: true, hasWritePermission: true, isHidden: false },
      { nodeId: 2, name: 'docs', type: 'directory', display_path: '/testuser/docs', size: 0, mimeType: null, modifiedAt: '2024-01-01T10:00:00Z', hasReadPermission: true, hasWritePermission: true, isHidden: false },
      { nodeId: 3, name: 'folder', type: 'directory', display_path: '/testuser/folder', size: 0, mimeType: null, modifiedAt: '2024-01-01T10:00:00Z', hasReadPermission: true, hasWritePermission: true, isHidden: false },
    ];
    const folderItems = [
      { nodeId: 4, name: 'sub.txt', type: 'file', display_path: '/testuser/folder/sub.txt', size: 0, mimeType: 'text/plain', modifiedAt: '2024-01-01T10:00:00Z', hasReadPermission: true, hasWritePermission: true, isHidden: false },
      { nodeId: 5, name: 'nested', type: 'directory', display_path: '/testuser/folder/nested', size: 0, mimeType: null, modifiedAt: '2024-01-01T10:00:00Z', hasReadPermission: true, hasWritePermission: true, isHidden: false },
    ];
    if (nodeIdParam === '3') {
      return HttpResponse.json(folderItems);
    }
    if (nodeIdParam === '2' || nodeIdParam === '5') {
      return HttpResponse.json([]);
    }
    return HttpResponse.json(rootItems);
  }),

  // --- Files: legacy-URL resolver (nodeId-first navigation bootstrap) ---
  http.post(`${API_BASE}/files/resolve-path`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const path = body.path;
    if (typeof path !== 'string' || path.length === 0) {
      return errorResponse('serverErrors.files.invalidPath', 400);
    }
    const pathToNodeId = {
      '/': null,
      '/testuser': 1,
      '/testuser/test.txt': 1,
      '/testuser/docs': 2,
      '/testuser/folder': 3,
      '/testuser/folder/sub.txt': 3,
      '/testuser/folder/nested': 5,
    };
    const nodeId = pathToNodeId[path];
    if (nodeId == null) {
      return errorResponse('serverErrors.files.notFound', 404);
    }
    return HttpResponse.json({ nodeId });
  }),

  // --- Files: ancestor chain (breadcrumbs) — root→current, self last ---
  http.get(`${API_BASE}/files/ancestors`, ({ request }) => {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    if (!nodeId) {
      return errorResponse('serverErrors.files.invalidPath', 400);
    }
    const chains = {
      1: [{ nodeId: 1, name: 'testuser' }],
      2: [{ nodeId: 1, name: 'testuser' }, { nodeId: 2, name: 'docs' }],
      3: [{ nodeId: 1, name: 'testuser' }, { nodeId: 3, name: 'folder' }],
      4: [{ nodeId: 1, name: 'testuser' }, { nodeId: 3, name: 'folder' }, { nodeId: 4, name: 'sub.txt' }],
      5: [{ nodeId: 1, name: 'testuser' }, { nodeId: 3, name: 'folder' }, { nodeId: 5, name: 'nested' }],
    };
    const ancestors = chains[nodeId] || [{ nodeId: Number(nodeId), name: 'folder' }];
    return HttpResponse.json({ ancestors });
  }),

  // --- Permissions (nodeId-based, matching server/domains/permissions/routes) ---
  http.get(`${API_BASE}/permissions/check`, ({ request }) => {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    if (!nodeId) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ nodeId: Number(nodeId), hasRead: true, hasWrite: true, source: 'path' });
  }),

  http.get(`${API_BASE}/permissions/user/:userId`, ({ params }) => {
    const userId = params.userId;
    if (userId === '1') {
      return HttpResponse.json([
        { nodeId: 2, permission: 'admin' },
        { nodeId: 3, permission: 'admin' },
      ]);
    }
    return HttpResponse.json([
      { nodeId: 20, permission: 'read' },
      { nodeId: 21, permission: 'write' },
    ]);
  }),

  http.get(`${API_BASE}/permissions/folder`, ({ request }) => {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    const fileNodeId = url.searchParams.get('fileNodeId');
    if (!nodeId) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    const perms = [
      { id: 1, username: 'testuser', email: 'user@example.com', is_admin: false, permission: 'admin', node_id: Number(nodeId) },
      { id: 2, username: 'user2', email: 'user2@example.com', is_admin: false, permission: 'read', node_id: Number(nodeId) },
    ];
    if (fileNodeId) {
      return HttpResponse.json(perms.map((p) => ({ ...p, file_permission: p.permission })));
    }
    return HttpResponse.json(perms);
  }),

  http.post(`${API_BASE}/permissions/grant`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { userId, nodeId, permission } = body;
    if (!userId || !nodeId || !permission) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.permissions.permissionGranted' });
  }),

  http.delete(`${API_BASE}/permissions/revoke`, ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const nodeId = url.searchParams.get('nodeId');
    const includeDescendants = url.searchParams.get('includeDescendants');
    if (!userId || !nodeId) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    if (includeDescendants === 'true') {
      return HttpResponse.json({ messageCode: 'serverMessages.permissions.permissionRevoked', deletedCount: 1 });
    }
    return HttpResponse.json({ messageCode: 'serverMessages.permissions.permissionRevoked' });
  }),

  http.get(`${API_BASE}/permissions/file/list`, () => {
    return HttpResponse.json([
      { file_node_id: 4, permission: 'read' },
      { file_node_id: 5, permission: 'write' },
    ]);
  }),

  http.post(`${API_BASE}/permissions/file/grant`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { userId, fileNodeId, permission } = body;
    if (!userId || !fileNodeId || !permission) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.permissions.filePermissionGranted' });
  }),

  http.delete(`${API_BASE}/permissions/file/revoke`, ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const fileNodeId = url.searchParams.get('fileNodeId');
    if (!userId || !fileNodeId) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.permissions.filePermissionRevoked' });
  }),

  http.get(`${API_BASE}/permissions/file/check`, ({ request }) => {
    const url = new URL(request.url);
    const fileNodeId = url.searchParams.get('fileNodeId');
    if (!fileNodeId) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ nodeId: Number(fileNodeId), hasRead: true, hasWrite: true, source: 'path' });
  }),

  http.patch(`${API_BASE}/permissions/file`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { userId, fileNodeId, permission } = body;
    if (!userId || !fileNodeId || !permission) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.permissions.filePermissionUpdated' });
  }),

  // --- Recent files (required for FolderTree / FileManager) ---
  http.get(`${API_BASE}/recent-files`, () => HttpResponse.json([])),

  http.post(`${API_BASE}/recent-files`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (body?.fileNodeId == null) {
      return errorResponse('serverErrors.recentFiles.pathRequired', 400);
    }
    return HttpResponse.json([
      { fileNodeId: body.fileNodeId, name: `file-${body.fileNodeId}`, type: 'file', lastAccessed: new Date().toISOString(), displayPath: `/file-${body.fileNodeId}` },
    ]);
  }),

  http.delete(`${API_BASE}/recent-files`, () =>
    HttpResponse.json({ messageCode: 'serverMessages.recentFiles.clearedSuccess' })
  ),

  http.delete(`${API_BASE}/recent-files/:fileNodeId`, ({ params }) =>
    HttpResponse.json([])
  ),

  http.get(`${API_BASE}/files/download`, ({ request }) => {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    if (!nodeId) {
      return errorResponse('serverErrors.permissionsMiddleware.nodeIdRequired', 400);
    }
    return new HttpResponse(new Blob(['mock file content']), {
      headers: { 'Content-Disposition': 'attachment; filename="file"' },
    });
  }),

  http.post(`${API_BASE}/files/upload`, async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file');
    const parentNodeId = formData.get('parentNodeId') || '1';
    const onConflict = formData.get('onConflict') || 'error';
    if (!file) {
      return errorResponse('serverErrors.files.invalidParentNodeId', 400);
    }
    const name = file.name;
    const exists = mockFiles.has(parentNodeId) && (mockFiles.get(parentNodeId) ?? []).some((i) => i.basename === name);
    if (exists && onConflict === 'skip') {
      return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSkipped', parentNodeId, skipped: true });
    }
    if (exists && onConflict !== 'overwrite') {
      return errorResponse('serverErrors.files.duplicateFile', 409);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSuccess', nodeId: Date.now(), parentNodeId, basename: name });
  }),

  // --- Files: rename (PUT /files/rename) ---
  http.put(`${API_BASE}/files/rename`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeId, newName } = body;
    if (!nodeId || !newName) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.renameSuccess', nodeId, newName });
  }),

  // --- Files: single-node move (POST /files/move, body: { nodeId, destinationParentNodeId }) ---
  // server/domains/files/routes/crud.js + api.md "Files and Folders".
  http.post(`${API_BASE}/files/move`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeId, destinationParentNodeId } = body;
    if (!nodeId || !destinationParentNodeId) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.moveSuccess', nodeId, newParentId: destinationParentNodeId });
  }),

  // --- Files: single-node copy (POST /files/copy, body: { nodeId, destinationParentNodeId, newName? }) ---
  http.post(`${API_BASE}/files/copy`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeId, destinationParentNodeId } = body;
    if (!nodeId || !destinationParentNodeId) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.copySuccess', sourceNodeId: nodeId, copiedNodeId: `${nodeId}_copy` });
  }),

  // --- Files: single-node delete (DELETE /files/delete, body: { nodeId }) ---
  http.delete(`${API_BASE}/files/delete`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeId } = body;
    if (!nodeId) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.deleteSuccess', nodeId, deletedCount: 1 });
  }),

  // --- Files: batch-move (POST, body: { moves, onConflict }) ---
  http.post(`${API_BASE}/files/batch-move`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { moves, onConflict } = body;
    if (!moves || !Array.isArray(moves) || moves.length === 0) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    const jobId = nextJobId();
    mockBulkJobs.set(jobId, { status: 'pending', progress: 0, total: moves.length, results: [], userId: '1' });
    // Simulate async completion
    setTimeout(() => {
      const job = mockBulkJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = moves.length;
        job.results = moves.map((m) => ({ sourceNodeId: m.sourceNodeId, destinationParentNodeId: m.destinationParentNodeId, status: 'succeeded' }));
      }
    }, bulkJobDelayMs);
    return HttpResponse.json({ jobId }, { status: 202 });
  }),

  // --- Files: batch-copy (POST, body: { copies, onConflict }) ---
  http.post(`${API_BASE}/files/batch-copy`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { copies, onConflict } = body;
    if (!copies || !Array.isArray(copies) || copies.length === 0) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    const jobId = nextJobId();
    mockBulkJobs.set(jobId, { status: 'pending', progress: 0, total: copies.length, results: [], userId: '1' });
    setTimeout(() => {
      const job = mockBulkJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = copies.length;
        job.results = copies.map((c) => ({ sourceNodeId: c.sourceNodeId, destinationParentNodeId: c.destinationParentNodeId, status: 'succeeded' }));
      }
    }, bulkJobDelayMs);
    return HttpResponse.json({ jobId }, { status: 202 });
  }),

  // --- Files: batch-delete (POST, body: { nodeIds }) ---
  http.post(`${API_BASE}/files/batch-delete`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeIds } = body;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    const jobId = nextJobId();
    mockBulkJobs.set(jobId, { status: 'pending', progress: 0, total: nodeIds.length, results: [], userId: '1' });
    setTimeout(() => {
      const job = mockBulkJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = nodeIds.length;
        job.results = nodeIds.map((n) => ({ nodeId: n, status: 'succeeded' }));
      }
    }, bulkJobDelayMs);
    return HttpResponse.json({ jobId }, { status: 202 });
  }),

  // --- Files: bulk-operation status and cancel ---
  http.get(`${API_BASE}/files/bulk-operation/:jobId`, ({ params }) => {
    const job = mockBulkJobs.get(params.jobId);
    if (!job) {
      return errorResponse('serverErrors.files.jobNotFound', 404);
    }
    return HttpResponse.json({
      status: job.status,
      progress: job.progress,
      total: job.total,
      results: job.results ?? [],
      errorMessage: job.errorMessage,
    });
  }),

  http.post(`${API_BASE}/files/bulk-operation/:jobId/cancel`, ({ params }) => {
    const job = mockBulkJobs.get(params.jobId);
    if (!job) {
      return errorResponse('serverErrors.files.jobNotFound', 404);
    }
    job.cancelled = true;
    return HttpResponse.json({ messageCode: 'serverMessages.files.cancelRequested', jobId: params.jobId });
  }),

  // --- Files: download-multiple, download-progress ---
  http.post(`${API_BASE}/files/download-multiple`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeIds } = body;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    const blob = new Blob(['mock zip content'], { type: 'application/zip' });
    return new HttpResponse(blob, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="download.zip"',
      },
    });
  }),

  http.get(`${API_BASE}/files/download-progress/:id`, ({ params }) => {
    return HttpResponse.json({
      status: 'completed',
      progress: 1,
      total: 1,
      current: '',
      zipName: 'download.zip',
    });
  }),

  // --- Files: check-conflicts, metadata, thumbnails ---
  http.post(`${API_BASE}/files/check-conflicts`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { operations } = body;
    if (!operations || !Array.isArray(operations)) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    return HttpResponse.json({ conflicts: [] });
  }),

  http.post(`${API_BASE}/files/metadata`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const nodeIds = body.nodeIds ?? [];
    const results = nodeIds.map((n) => ({ nodeId: n, size: 0, lastmod: null, mime: null }));
    return HttpResponse.json(results);
  }),

  http.post(`${API_BASE}/thumbnails/batch`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const nodeIds = body.nodeIds;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    return HttpResponse.json({ thumbnails: nodeIds.map((n) => ({ nodeId: n, thumbnailUrl: null })) });
  }),

  // --- Video preview ticket/stream ---
  http.post(`${API_BASE}/files/preview-ticket`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body?.nodeId) {
      return errorResponse('serverErrors.files.nodeIdRequired', 400);
    }
    return HttpResponse.json({ ticket: `ticket_${Date.now()}` });
  }),

  http.get(`${API_BASE}/files/preview-stream`, () => {
    return new HttpResponse(new Blob(['mock video']), {
      headers: { 'Content-Type': 'video/mp4' },
    });
  }),

  // --- Folders ---
  http.post(`${API_BASE}/folders/create`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { parentNodeId, name } = body;
    if (!parentNodeId || !name) {
      return errorResponse('serverErrors.folders.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.folders.createSuccess', nodeId: Date.now(), parentNodeId, basename: name });
  }),

  // --- Folders: recursive stats (GET /folders/stats?nodeId=) ---
  // server/domains/files/routes/folders.js + api.md "Files and Folders".
  // Mirrors the server shape { nodeId, name, totalFiles, totalFolders, totalSize }.
  http.get(`${API_BASE}/folders/stats`, ({ request }) => {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    if (!nodeId) {
      return errorResponse('serverErrors.folders.pathRequired', 400);
    }
    return HttpResponse.json({ nodeId: Number(nodeId), name: 'folder', totalFiles: 2, totalFolders: 1, totalSize: 0 });
  }),

  // --- Health, settings, webdav ---
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({ status: 'ok', messageCode: 'serverMessages.api.healthOk' });
  }),

  http.get(`${API_BASE}/settings/public`, () => {
    return HttpResponse.json({ registration_enabled: true, email_enabled: false });
  }),

  http.get(`${API_BASE}/webdav/info`, () => {
    return HttpResponse.json({ url: 'https://example.com/webdav', basePath: '/' });
  }),

  http.get(`${API_BASE}/webdav/test`, () => {
    return HttpResponse.json({ success: true, messageCode: 'serverMessages.api.webdavTestOk' });
  }),

  // --- Users (basic) ---
  http.get(`${API_BASE}/users`, () => {
    return HttpResponse.json([{ id: '1', username: 'testuser', email: 'user@example.com' }]);
  }),

  http.get(`${API_BASE}/users/approved`, () => {
    return HttpResponse.json([{ id: '1', username: 'testuser', email: 'user@example.com' }]);
  }),

  // --- Users: self-service mutations (PUT /users/:id/password|email|permissions) ---
  // server/domains/admin/routes/users.js + api.md "Users".
  http.put(`${API_BASE}/users/:id/password`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.password) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.users.passwordUpdated' });
  }),

  http.put(`${API_BASE}/users/:id/email`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.email) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.users.emailUpdated' });
  }),

  http.put(`${API_BASE}/users/:id/permissions`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.permissions)) {
      return errorResponse('serverErrors.admin.invalidPermissionList', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.users.permissionUpdated' });
  }),

  // --- Admin ---
  http.get(`${API_BASE}/admin/settings`, () => {
    return HttpResponse.json(mockAdminSettings);
  }),

  http.put(`${API_BASE}/admin/settings`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    Object.assign(mockAdminSettings, body);
    return HttpResponse.json({ messageCode: 'serverMessages.admin.settingsSaved' });
  }),

  http.get(`${API_BASE}/admin/users/pending`, () => {
    return HttpResponse.json(mockAdminUsers.pending);
  }),

  http.get(`${API_BASE}/admin/users`, () => {
    return HttpResponse.json(mockAdminUsers.approved);
  }),

  http.post(`${API_BASE}/admin/users`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.username || !body.email || !body.password) {
      return errorResponse('serverErrors.auth.requiredFields', 400);
    }
    const user = {
      id: `u_${Date.now()}`,
      username: body.username,
      email: body.email,
      status: 'approved',
      created_at: new Date().toISOString(),
      is_admin: false,
    };
    mockAdminUsers.approved.push(user);
    return HttpResponse.json(user, { status: 201 });
  }),

  http.post(`${API_BASE}/admin/users/:id/approve`, ({ params }) => {
    const idx = mockAdminUsers.pending.findIndex((u) => u.id === params.id);
    if (idx === -1) return errorResponse('serverErrors.admin.userNotFound', 404);
    const [user] = mockAdminUsers.pending.splice(idx, 1);
    user.status = 'approved';
    mockAdminUsers.approved.push(user);
    return HttpResponse.json({ messageCode: 'serverMessages.admin.userApproved' });
  }),

  http.post(`${API_BASE}/admin/users/:id/reject`, ({ params }) => {
    const idx = mockAdminUsers.pending.findIndex((u) => u.id === params.id);
    if (idx === -1) return errorResponse('serverErrors.admin.userNotFound', 404);
    mockAdminUsers.pending.splice(idx, 1);
    return HttpResponse.json({ messageCode: 'serverMessages.admin.userRejected' });
  }),

  http.delete(`${API_BASE}/admin/users/:id`, ({ params }) => {
    const approvedIdx = mockAdminUsers.approved.findIndex((u) => u.id === params.id);
    if (approvedIdx !== -1) {
      mockAdminUsers.approved.splice(approvedIdx, 1);
      return HttpResponse.json({ messageCode: 'serverMessages.admin.userDeleted' });
    }
    return errorResponse('serverErrors.admin.userNotFound', 404);
  }),

  http.post(`${API_BASE}/admin/cleanup/orphaned`, () => {
    return HttpResponse.json({ results: [], messageCode: 'serverMessages.admin.cleanupComplete' });
  }),

  http.post(`${API_BASE}/admin/permissions/ensure-home-owner-admin`, () => {
    return HttpResponse.json({ updatedUsers: 0, upgradedPaths: 0, grantedPaths: 0, errors: [] });
  }),

  // --- Permission requests (nodeId-based, matching server/domains/permissions/routes/permissionRequests.js) ---
  http.get(`${API_BASE}/permission-requests/inbox`, () => {
    return HttpResponse.json(mockPermissionRequests.inbox);
  }),
  http.get(`${API_BASE}/permission-requests/outbox`, () => {
    return HttpResponse.json(mockPermissionRequests.outbox);
  }),
  http.get(`${API_BASE}/permission-requests/check-owner`, ({ request }) => {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId') || url.searchParams.get('folderNodeId') || url.searchParams.get('fileNodeId');
    if (!nodeId) {
      return errorResponse('serverErrors.permissionRequests.pathRequired', 400);
    }
    return HttpResponse.json({ ownerExists: true, ownerUsername: 'owner1' });
  }),
  http.post(`${API_BASE}/permission-requests`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { nodeId, fileNodeId, permission, message } = body;
    const targetNodeId = nodeId || fileNodeId;
    if (!targetNodeId) {
      return errorResponse('serverErrors.permissionRequests.folderOrFileRequired', 400);
    }
    if (permission !== 'read' && permission !== 'write') {
      return errorResponse('serverErrors.permissionRequests.invalidPermission', 400);
    }
    const req = {
      id: `pr_${Date.now()}`,
      requester_id: 1,
      requester_username: 'testuser',
      owner_id: 2,
      owner_username: 'owner1',
      file_node_id: Number(targetNodeId),
      requested_permission: permission,
      status: 'pending',
      message: typeof message === 'string' ? message : '',
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      targetType: null,
    };
    mockPermissionRequests.outbox.push(req);
    return HttpResponse.json(req);
  }),
  http.post(`${API_BASE}/permission-requests/:id/approve`, ({ params }) => {
    const req = mockPermissionRequests.inbox.find((r) => r.id === params.id);
    if (!req) return errorResponse('serverErrors.permissionRequests.requestNotFound', 404);
    req.status = 'approved';
    req.resolved_at = new Date().toISOString();
    req.resolved_by = 1;
    return HttpResponse.json(req);
  }),
  http.post(`${API_BASE}/permission-requests/:id/reject`, ({ params }) => {
    const req = mockPermissionRequests.inbox.find((r) => r.id === params.id);
    if (!req) return errorResponse('serverErrors.permissionRequests.requestNotFound', 404);
    req.status = 'rejected';
    req.resolved_at = new Date().toISOString();
    req.resolved_by = 1;
    return HttpResponse.json(req);
  }),
  http.post(`${API_BASE}/permission-requests/:id/cancel`, ({ params }) => {
    const req = mockPermissionRequests.outbox.find((r) => r.id === params.id);
    if (!req) return errorResponse('serverErrors.permissionRequests.requestNotFound', 404);
    req.status = 'cancelled';
    req.resolved_at = new Date().toISOString();
    req.resolved_by = 1;
    return HttpResponse.json(req);
  }),

  // --- Share links (authenticated) ---
  http.get(`${API_BASE}/share-links`, () => {
    return HttpResponse.json(mockShareLinks);
  }),
  http.post(`${API_BASE}/share-links`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { fileNodeId, expiresInDays } = body;
    if (fileNodeId == null) {
      return errorResponse('serverErrors.share.pathRequired', 400);
    }
    const token = `sl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const link = {
      token,
      nodeId: fileNodeId,
      fileName: `file-${fileNodeId}`,
      fileType: 'file',
      isDirectory: false,
      displayPath: `/file-${fileNodeId}`,
      createdAt: new Date().toISOString(),
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
      downloadCount: 0,
      isExpired: false,
    };
    mockShareLinks.push(link);
    return HttpResponse.json(link, { status: 201 });
  }),
  http.delete(`${API_BASE}/share-links/:token`, ({ params }) => {
    const idx = mockShareLinks.findIndex((l) => l.token === params.token);
    if (idx === -1) return errorResponse('serverErrors.share.shareLinkNotFound', 404);
    mockShareLinks.splice(idx, 1);
    return HttpResponse.json({ messageCode: 'serverMessages.shareLinks.shareLinkDeleted' });
  }),

  // --- Share links: get/update one link (GET/PUT /share-links/:token) ---
  // server/domains/sharing/routes/shareLinks.js + api.md "Share Links (authenticated)".
  http.get(`${API_BASE}/share-links/:token`, ({ params }) => {
    const link = mockShareLinks.find((l) => l.token === params.token);
    if (!link) return errorResponse('serverErrors.share.shareLinkNotFound', 404);
    return HttpResponse.json(link);
  }),

  http.put(`${API_BASE}/share-links/:token`, async ({ request, params }) => {
    const link = mockShareLinks.find((l) => l.token === params.token);
    if (!link) return errorResponse('serverErrors.share.shareLinkNotFound', 404);
    const body = await request.json().catch(() => ({}));
    if (body.expiresInDays) {
      link.expiresAt = new Date(Date.now() + body.expiresInDays * 86400000).toISOString();
    }
    return HttpResponse.json(link);
  }),

  // --- Share (public) ---
  http.get(`${API_BASE}/share/:token/info`, ({ params }) => {
    if (params.token === 'invalid' || params.token === 'expired') {
      return errorResponse('serverErrors.share.shareLinkNotFound', 404);
    }
    return HttpResponse.json({
      token: params.token,
      nodeId: 2,
      fileName: 'file.pdf',
      fileType: 'pdf',
      isDirectory: false,
      displayPath: '/testuser/docs/file.pdf',
      createdAt: new Date().toISOString(),
      expiresAt: null,
      downloadCount: 0,
      isExpired: false,
    });
  }),

  http.get(`${API_BASE}/share/:token/check-my-permission`, () =>
    HttpResponse.json({ hasSufficientPermission: true })
  ),

  http.post(`${API_BASE}/share/:token/add-to-my-permissions`, () =>
    HttpResponse.json({ messageCode: 'serverMessages.share.addedToShared' })
  ),

  // --- Share (public): download + preview (GET /share/:token, /share/:token/preview) ---
  // server/domains/sharing/routes/sharePublic.js + api.md "Share (public)".
  http.get(`${API_BASE}/share/:token`, ({ params }) => {
    if (!publicShareIsValid(params.token)) {
      return errorResponse('serverErrors.share.shareLinkNotFound', 404);
    }
    return new HttpResponse(new Blob(['mock shared file content']), {
      headers: {
        'Content-Disposition': `attachment; filename="shared.bin"`,
        'Content-Type': 'application/octet-stream',
      },
    });
  }),

  http.get(`${API_BASE}/share/:token/preview`, ({ params }) => {
    if (!publicShareIsValid(params.token)) {
      return errorResponse('serverErrors.share.shareLinkNotFound', 404);
    }
    return new HttpResponse(new Blob(['mock shared preview content']), {
      headers: {
        'Content-Disposition': `inline; filename="shared.bin"`,
        'Content-Type': 'application/octet-stream',
      },
    });
  }),

  // --- Thumbnails: single image fetch (GET /thumbnails/:hash.:ext?token=) ---
  // server/domains/thumbnails/routes.js + api.md "Thumbnails".
  http.get(`${API_BASE}/thumbnails/:hash.:ext`, ({ request }) => {
    const url = new URL(request.url);
    if (!url.searchParams.get('token')) {
      return errorResponse('serverErrors.thumbnails.invalidOrExpiredToken', 401);
    }
    return new HttpResponse(new Blob(['mock thumbnail'], { type: 'image/jpeg' }), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  }),
];
