'use strict';

/**
 * Content-change re-embed integration (aiJobService.md §2.2 idempotency,
 * aiJobsStore.md §2.3 content-aware conflict rule).
 *
 * Real queue + real commit seams (no enqueue mock): an overwrite/restore of
 * CHANGED bytes must reset the existing `(node, kind, generation)` row to a
 * fresh `pending` attempt, while identical bytes stay a `null` dedupe (one
 * row, no re-pay).
 */

const crypto = require('crypto');
const { createTestDatabase, dbRun } = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const { createFileNodeService } = require('@server/service/fileNodeService');
const { createBlobStorageService } = require('@server/service/blobStorageService');
const { createUploadService } = require('@server/service/uploadService');
const { createVersionsService } = require('@server/domains/files/services/versionsService');
const { createNodeContentHook } = require('@server/domains/ai/nodeContentHook');
const aiJobsStore = require('@server/store/aiJobsStore');
const { createInMemoryBlobStore, createAclServiceMock } = require('@testing/mocks/serviceMocks');

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

describe('content-change re-embed (real queue + commit seams)', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStore;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createInMemoryBlobStore();
  });

  const uniqueName = (filename) => {
    const dot = filename.lastIndexOf('.');
    const suffix = `${Date.now()}-${(seq += 1)}`;
    return dot <= 0
      ? `${filename}-${suffix}`
      : `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`;
  };

  const buildHook = () =>
    createNodeContentHook({
      aiJobsRepository: aiJobsStore,
      fileNodesStore,
      capabilityProbe: async () => false,
    });

  const buildUploadService = () =>
    createUploadService({
      fileNodeService,
      blobStorageService: createBlobStorageService({ blobStore, fileNodesStore }),
      blobStore,
      fileNodesStore,
      nodeContentHook: buildHook(),
    });

  const buildVersionsService = () =>
    createVersionsService({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode: 's3',
      aclService: createAclServiceMock(),
      nodeContentHook: buildHook(),
    });

  const embedJobs = async (nodeId) =>
    (await aiJobsStore.listByNode(nodeId)).filter((job) => job.kind === 'embed');

  it('overwrite with changed bytes re-arms the same embed row; identical bytes dedupe', async () => {
    await dbRun('DELETE FROM ai_jobs');
    const uploadSvc = buildUploadService();
    const v1 = Buffer.from('reembed-overwrite-v1');
    const uploaded = await uploadSvc.uploadFile(null, uniqueName('reembed.txt'), v1, 'text/plain');

    let [job] = await embedJobs(uploaded.nodeId);
    expect(job).toMatchObject({
      kind: 'embed',
      generation: 1,
      status: 'pending',
      contentHash: sha256(v1),
    });
    let claimed = await aiJobsStore.claimNext();
    expect(claimed.id).toBe(Number(job.id));
    await aiJobsStore.markDone(claimed.id);

    // Changed content: same generation, same row, fresh work.
    const v2 = Buffer.from('reembed-overwrite-v2-different-bytes');
    await uploadSvc.overwriteFile(uploaded.nodeId, v2, 'text/plain');

    let jobs = await embedJobs(uploaded.nodeId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: Number(job.id),
      status: 'pending',
      attempt: 0,
      contentHash: sha256(v2),
      startedAt: null,
      finishedAt: null,
      nextRetryAt: null,
      lastError: null,
    });

    claimed = await aiJobsStore.claimNext();
    expect(claimed.id).toBe(Number(job.id));
    expect(claimed.contentHash).toBe(sha256(v2));
    await aiJobsStore.markDone(claimed.id);

    // Identical content: no reset, no second row, nothing claimable.
    await uploadSvc.overwriteFile(uploaded.nodeId, v2, 'text/plain');
    jobs = await embedJobs(uploaded.nodeId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: Number(job.id),
      status: 'done',
      contentHash: sha256(v2),
    });
    await expect(aiJobsStore.claimNext()).resolves.toBeNull();
  });

  it('restore to an older version with different bytes re-arms the same embed row', async () => {
    await dbRun('DELETE FROM ai_jobs');
    const node = await fileNodeService.createFile(null, uniqueName('reembed-restore.txt'));
    const v1 = Buffer.from('restore-v1-content');
    const v2 = Buffer.from('restore-v2-content-longer');
    const keyV1 = `reembed-v1-${Date.now()}-${(seq += 1)}`;
    const keyV2 = `reembed-v2-${Date.now()}-${(seq += 1)}`;

    await fileNodesStore.upsertObjectMap(node.id, keyV1, 'pending');
    await blobStore.uploadBlob(keyV1, v1);
    await fileNodesStore.activateObject(keyV1);
    await fileNodeService.updateSyncStatus(node.id, 'active');

    await fileNodesStore.upsertObjectMap(node.id, keyV2, 'pending');
    await blobStore.uploadBlob(keyV2, v2);
    await fileNodesStore.activateObject(keyV2);
    await fileNodeService.updateSyncStatus(node.id, 'active');
    await fileNodesStore.upsertCache(node.id, v2.length, 'text/plain', sha256(v2));

    // Current content already embedded.
    const current = await aiJobsStore.enqueue(node.id, 'embed', 1, sha256(v2));
    const claimed = await aiJobsStore.claimNext();
    expect(claimed.id).toBe(Number(current.id));
    await aiJobsStore.markDone(claimed.id);

    const versionsSvc = buildVersionsService();
    await versionsSvc.restoreVersion('user-1', node.id, 1, { is_admin: 1 });

    const jobs = await embedJobs(node.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: Number(current.id),
      status: 'pending',
      attempt: 0,
      contentHash: sha256(v1),
      startedAt: null,
      finishedAt: null,
    });

    const reclaimed = await aiJobsStore.claimNext();
    expect(reclaimed.id).toBe(Number(current.id));
    expect(reclaimed.contentHash).toBe(sha256(v1));
    await aiJobsStore.markDone(reclaimed.id);
  });
});
