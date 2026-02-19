/**
 * MSW handlers aligned with OpenAPI spec (docs/openapi.yaml) and actual server routes.
 * Routes use batch-move, batch-copy, batch-delete, PUT /rename - NOT the legacy move/delete paths.
 * @see docs/api.md
 * @see docs/openapi.yaml
 * @see docs/shared-contracts.md
 */
import { http, HttpResponse } from 'msw';

const API_BASE = '/api';

// Mock in-memory state for file operations (shared across handlers)
const mockFiles = new Map();
const mockBulkJobs = new Map();
let jobIdCounter = 0;

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
    const path = url.searchParams.get('path') || '/';
    const items = mockFiles.get(path) ?? [
      { path: '/test.txt', basename: 'test.txt', type: 'file', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
      { path: '/folder', basename: 'folder', type: 'directory', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
    ];
    return HttpResponse.json(items);
  }),

  http.get(`${API_BASE}/files/download`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    if (!path) {
      return errorResponse('serverErrors.permissionsMiddleware.pathRequired', 400);
    }
    return new HttpResponse(new Blob(['mock file content']), {
      headers: { 'Content-Disposition': 'attachment; filename="file"' },
    });
  }),

  http.post(`${API_BASE}/files/upload`, async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file');
    const targetPath = formData.get('path') || '/';
    const onConflict = formData.get('onConflict') || 'error';
    if (!file) {
      return errorResponse('serverErrors.files.invalidPath', 400);
    }
    const name = file.name;
    const fullPath = targetPath === '/' ? `/${name}` : `${targetPath.replace(/\/$/, '')}/${name}`;
    const exists = mockFiles.has(targetPath) && (mockFiles.get(targetPath) ?? []).some((i) => i.basename === name);
    if (exists && onConflict === 'skip') {
      return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSkipped', path: fullPath, skipped: true });
    }
    if (exists && onConflict !== 'overwrite') {
      return errorResponse('serverErrors.files.duplicateFile', 409);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSuccess', path: fullPath });
  }),

  // --- Files: rename (PUT /files/rename, NOT POST /files/move) ---
  http.put(`${API_BASE}/files/rename`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { oldPath, newName } = body;
    if (!oldPath || !newName) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    const dir = oldPath.replace(/\/[^/]+$/, '') || '/';
    const newPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`;
    if (oldPath === newPath) {
      return HttpResponse.json({ messageCode: 'serverMessages.files.nameUnchanged', path: newPath });
    }
    return HttpResponse.json({ messageCode: 'serverMessages.files.renameSuccess', path: newPath });
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
        job.results = moves.map((m) => ({ sourcePath: m.sourcePath, destinationPath: m.destinationPath, status: 'succeeded' }));
      }
    }, 50);
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
        job.results = copies.map((c) => ({ sourcePath: c.sourcePath, destinationPath: c.destinationPath, status: 'succeeded' }));
      }
    }, 50);
    return HttpResponse.json({ jobId }, { status: 202 });
  }),

  // --- Files: batch-delete (POST, body: { paths }) ---
  http.post(`${API_BASE}/files/batch-delete`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const { paths } = body;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return errorResponse('serverErrors.files.sourceDestRequired', 400);
    }
    const jobId = nextJobId();
    mockBulkJobs.set(jobId, { status: 'pending', progress: 0, total: paths.length, results: [], userId: '1' });
    setTimeout(() => {
      const job = mockBulkJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = paths.length;
        job.results = paths.map((p) => ({ path: p, status: 'succeeded' }));
      }
    }, 50);
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
    const { paths } = body;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
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
    const paths = body.paths ?? [];
    const results = paths.map((p) => ({ path: p, size: 0, lastmod: null, mime: null }));
    return HttpResponse.json(results);
  }),

  http.post(`${API_BASE}/files/thumbnails/batch`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const paths = body.paths ?? [];
    return HttpResponse.json({ thumbnails: paths.map((p) => ({ path: p, hash: null, url: null })) });
  }),

  // --- Folders ---
  http.post(`${API_BASE}/folders/create`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const folderPath = body.path;
    if (!folderPath) {
      return errorResponse('serverErrors.folders.pathRequired', 400);
    }
    return HttpResponse.json({ messageCode: 'serverMessages.folders.createSuccess', path: folderPath });
  }),

  // --- Health, settings, webdav ---
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({ status: 'ok', messageCode: 'serverMessages.api.healthOk' });
  }),

  http.get(`${API_BASE}/settings/public`, () => {
    return HttpResponse.json({ signupEnabled: true });
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
];
