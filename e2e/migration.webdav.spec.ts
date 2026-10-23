import path from 'node:path';

import { expect, test } from '@playwright/test';

import { emptyS3Bucket, listS3Keys } from './helpers/minio';
import { openSystemSettings, queryScratchSqlite } from './helpers/setupScratch';
import {
  S3_ACCESS_KEY,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_KEY,
  assertOnSystemSettings,
  assertPostMigrationBlobState,
  assertRealWebdavPrecondition,
  bootMigrationScratch,
  cleanupMigrationScratch,
  createAdminFolder,
  fillS3Dest,
  loginAsAdminUi,
  loginToken,
  migrationDestBucket,
  observeMigration,
  openBlobMigrationDialog,
  pollJobStatus,
  pollJobStatusUntil,
  startBlobMigrationFromDialog,
  uploadAdminFile,
  waitForGateInactive,
  waitForTerminalModal,
  type MigrationScratchState,
} from './migration.helpers';

/**
 * Unified migration mode WebDAV-source cases
 * (docs/features/migration-mode.md +
 * docs/spec/server/services/metadataMigrationService.md).
 *
 * These cases verify the inherently WebDAV-specific defect path: real webdav
 * uploads stay `pending_upload` and have no `object_map` row, and the
 * source-mode-aware snapshot must still migrate them to the S3 destination.
 *
 * Hermetic by design: every case spawns its own scratch server on the platform
 * port (desktop :5011 / mobile :5018), with a project-scoped scratch dir,
 * project/case-scoped bytemark root, sqlite metadata source and a
 * project-scoped S3 destination bucket (`e2e-migration-<project>`). The
 * migration gate is process-global, so cases are serialized.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

let scratch: MigrationScratchState | null = null;

test.afterEach(async () => {
  if (scratch) {
    await cleanupMigrationScratch(scratch);
    scratch = null;
  }
});

test.describe('unified migration mode (WebDAV source)', () => {
  test('E2E-WEBDAV-MIG-001 (Flow A): Blob dry-run then apply happy path — dialog → /migration → terminal modal → settings', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-a-happy-path';
    scratch = await bootMigrationScratch(testInfo, { caseId, backend: 'webdav' });
    const { baseURL, destBucket } = scratch;

    // Seed the source snapshot with REAL app uploads (webdav mode): the
    // multipart upload flows through fileService.uploadFile's webdav branch →
    // uploadToWebdav, leaving nodes pending_upload with no object_map row.
    const token = await loginToken(baseURL, request);
    const folderName = `migration-a-${Date.now()}`;
    const folderId = await createAdminFolder(baseURL, request, token, folderName);
    const fileNodeIds: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      fileNodeIds.push(await uploadAdminFile(baseURL, request, token, folderId, `file-${i}.txt`));
    }

    // Prove the precondition is the real defect path (no seeded seam).
    const dbPath = path.join(scratch.scratch, 'webdav.db');
    await assertRealWebdavPrecondition(dbPath, fileNodeIds);
    // Deterministic S3 count baseline for the no-extra-objects assertions.
    await emptyS3Bucket(destBucket);

    await loginAsAdminUi(page);
    await openSystemSettings(page);

    // A3: dry-run — starts migration mode, completes, terminal modal, back.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'dry-run');
    await expect(page).toHaveURL(/\/migration/);
    const dryRunObserved = await observeMigration(page);
    const dryRunBody = await waitForTerminalModal(page);
    // A1: dry-run writes nothing; terminal shows the default (no configPersist) guidance.
    expect(dryRunBody).toContain('Migration completed');
    expect(dryRunBody).toContain(
      'Blob migration completed. Restart the server to finish the storage cutover.'
    );
    // The dry-run only enumerated the real snapshot — it copied nothing: no
    // object_map rows and no S3 objects.
    const mapsAfterDryRun = await queryScratchSqlite<{ cnt: number }>(
      dbPath,
      'SELECT COUNT(*) AS cnt FROM object_map'
    );
    expect(Number(mapsAfterDryRun[0].cnt)).toBe(0);
    expect(await listS3Keys(destBucket)).toHaveLength(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);

    // A2/A4: apply — reopens the dialog, copies, persists config, terminal modal.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    const applyJobId = await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    const applyObserved = await observeMigration(page);
    const applyBody = await waitForTerminalModal(page);
    // The S3_* destination keys are DB/default-sourced (not in the scratch .env),
    // so apply persisted them → the persisted guidance, not the manual .env one.
    expect(applyBody).toContain('Migration completed');
    expect(applyBody).toContain('was saved to the server settings');
    expect(applyBody).toContain('S3_BUCKET');
    expect(applyBody).not.toContain('Update them in .env manually');

    const applyJob = await pollJobStatus(baseURL, request, token, applyJobId, [
      'completed',
      'failed',
    ]);
    expect(applyJob.status).toBe('completed');
    expect(applyJob.results).toMatchObject({ failed: 0, errors: [] });

    // Post-migration state (the fix's new behavior): every uploaded webdav file
    // now has an s3/active object_map row, sync_status='active', and its blob
    // exists in the destination bucket.
    await assertPostMigrationBlobState(dbPath, fileNodeIds, destBucket);

    testInfo.annotations.push({
      type: 'e2e-mig-001-running',
      description: `dry-run sawRunning=${dryRunObserved.sawRunning}, apply sawRunning=${applyObserved.sawRunning}`,
    });

    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);
  });

  test('E2E-WEBDAV-MIG-002 (Flow B): Blob cancel mid-copy, resume via shouldSkip, no duplicate blobs', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-b-cancel-resume';
    scratch = await bootMigrationScratch(testInfo, { caseId, backend: 'webdav' });
    const { baseURL, destBucket } = scratch;

    const token = await loginToken(baseURL, request);
    const folderName = `migration-b-${Date.now()}`;
    const folderId = await createAdminFolder(baseURL, request, token, folderName);
    const fileNodeIds: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      fileNodeIds.push(await uploadAdminFile(baseURL, request, token, folderId, `b-${i}.txt`));
    }
    // Real webdav-mode precondition (pending_upload + no object_map), then a
    // deterministic S3 baseline so the final count proves "no duplicates".
    const dbPath = path.join(scratch.scratch, 'webdav.db');
    await assertRealWebdavPrecondition(dbPath, fileNodeIds);
    await emptyS3Bucket(destBucket);

    await loginAsAdminUi(page);
    await openSystemSettings(page);

    // Start apply (real minio dest). 30 nodes keep the copy slow enough to cancel.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);

    // Observe running (or skip if it already reached a terminal state), then cancel
    // mid-copy once the worker reports 'running' and has copied at least one node.
    const statusRes = await request.get(`${baseURL}/api/migration/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gateState = (await statusRes.json()) as { active?: boolean; jobId?: string };
    expect(gateState.active).toBe(true);
    const jobId = gateState.jobId as string;

    // Wait until the copy is genuinely in flight (at least one node copied) and
    // cancel as soon as it is. No fixed sleep: on a fast runner the whole
    // 30-node copy can finish before a 600ms head start elapses, and cancelling
    // a terminal job returns 404 (migrationJobStore.cancel), which made this
    // assertion flaky in CI.
    const runningJob = await pollJobStatusUntil(
      baseURL,
      request,
      token,
      jobId,
      (job) =>
        ['completed', 'cancelled', 'failed'].includes(String(job.status)) ||
        (String(job.status) === 'running' && (job.results?.copied ?? 0) >= 1),
      30_000
    );
    expect(runningJob.status).toBe('running');

    const cancelRes = await request.post(`${baseURL}/api/admin/migration/jobs/${jobId}/cancel`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cancelRes.ok()).toBeTruthy();

    const cancelledJob = await pollJobStatus(
      baseURL,
      request,
      token,
      jobId,
      ['cancelled', 'completed', 'failed'],
      30_000
    );
    expect(cancelledJob.status).toBe('cancelled');
    await waitForGateInactive(baseURL, request);

    const cancelledResults = (cancelledJob.results ?? {}) as { copied?: number };
    // A6: the copy actually made progress before the cancel took effect.
    expect(cancelledResults.copied ?? 0).toBeGreaterThanOrEqual(1);

    // The /migration page surfaced the cancelled terminal modal.
    const cancelBody = await waitForTerminalModal(page);
    expect(cancelBody).toContain('Migration cancelled');

    // Snapshot the post-cancel object_map state (resume marker).
    const keysAfterCancel = await queryScratchSqlite<{
      s3_key: string | null;
      file_node_id: number;
    }>(
      dbPath,
      "SELECT file_node_id, s3_key FROM object_map WHERE status = 'active' ORDER BY file_node_id"
    );

    // A7: resume — rerun apply; already-migrated nodes are skipped.
    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    // Capture the resume jobId while the gate is still active (the copy of the
    // remaining ~20+ nodes keeps the worker busy for a second or more).
    const resumeGate = (await (
      await request.get(`${baseURL}/api/migration/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as {
      jobId?: string;
    };
    expect(resumeGate.jobId).toBeDefined();

    const resumeObserved = await observeMigration(page);
    const resumeBody = await waitForTerminalModal(page);
    expect(resumeBody).toContain('Migration completed');

    const resumedJob = await pollJobStatus(
      baseURL,
      request,
      token,
      resumeGate.jobId as string,
      ['completed', 'failed'],
      60_000
    );
    expect(resumedJob.status).toBe('completed');
    const resumeResults = (resumedJob.results ?? {}) as { skipped?: number; copied?: number };

    // shouldSkip proof: the rerun skipped at least the nodes copied pre-cancel and
    // copied at most the remaining nodes.
    expect(resumeResults.skipped ?? 0).toBeGreaterThanOrEqual(cancelledResults.copied ?? 0);
    expect((resumeResults.copied ?? 0) + (resumeResults.skipped ?? 0)).toBe(fileNodeIds.length);
    testInfo.annotations.push({
      type: 'e2e-mig-002-resume',
      description: `cancelledCopied=${cancelledResults.copied}, resumed: skipped=${resumeResults.skipped} copied=${resumeResults.copied} sawRunning=${resumeObserved.sawRunning}`,
    });

    // No duplicate objects: every file node has exactly one active object_map row
    // and the post-cancel keys were NOT re-rolled on resume.
    const dupRows = await queryScratchSqlite<{ file_node_id: number; cnt: number }>(
      dbPath,
      "SELECT file_node_id, COUNT(*) AS cnt FROM object_map WHERE status = 'active' GROUP BY file_node_id HAVING COUNT(*) > 1"
    );
    expect(dupRows).toHaveLength(0);
    const keysAfterResume = await queryScratchSqlite<{
      s3_key: string | null;
      file_node_id: number;
    }>(
      dbPath,
      "SELECT file_node_id, s3_key FROM object_map WHERE status = 'active' ORDER BY file_node_id"
    );
    // No re-copy: every node that already had an s3_key at the cancel point keeps
    // the exact same key after the resume (nodes that were still null are the
    // remaining ones the resume legitimately copies).
    const copiedBefore = new Map(
      keysAfterCancel.filter((k) => k.s3_key).map((k) => [k.file_node_id, k.s3_key])
    );
    expect(copiedBefore.size).toBeGreaterThanOrEqual(1);
    for (const row of keysAfterResume) {
      const before = copiedBefore.get(row.file_node_id);
      if (before) expect(row.s3_key).toBe(before);
    }

    const migratedCount = await queryScratchSqlite<{ cnt: number }>(
      dbPath,
      "SELECT COUNT(*) AS cnt FROM object_map WHERE status = 'active' AND s3_key IS NOT NULL"
    );
    expect(Number(migratedCount[0].cnt)).toBe(fileNodeIds.length);

    // No duplicate blobs: the destination holds exactly one object per file —
    // the resume/skip (s3_key marker) prevented any re-copy on the rerun. And
    // every node reached the fix's post-migration lifecycle state.
    expect(await listS3Keys(destBucket)).toHaveLength(fileNodeIds.length);
    const postResumeNodes = await queryScratchSqlite<{ id: number; sync_status: string }>(
      dbPath,
      `SELECT id, sync_status FROM file_nodes WHERE id IN (${fileNodeIds.join(', ')})
       ORDER BY id`
    );
    for (const row of postResumeNodes) expect(row.sync_status).toBe('active');
  });

  test('E2E-WEBDAV-MIG-003 (Flow E3): Native webdav file (no object_map) is snapshotted + migrated; rerun is skipped (no duplicate)', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'e3-native-webdav-no-object-map';
    scratch = await bootMigrationScratch(testInfo, { caseId, backend: 'webdav' });
    const { baseURL, destBucket } = scratch;

    const token = await loginToken(baseURL, request);
    const folderName = `migration-e3-${Date.now()}`;
    const folderId = await createAdminFolder(baseURL, request, token, folderName);
    const fileNodeIds: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      fileNodeIds.push(await uploadAdminFile(baseURL, request, token, folderId, `e3-${i}.txt`));
    }
    const dbPath = path.join(scratch.scratch, 'webdav.db');

    // Explicit focus: the node has NO object_map row at all and stays
    // pending_upload — the exact precondition for which the old snapshot
    // silently enumerated 0 nodes. The fix must still include it.
    await assertRealWebdavPrecondition(dbPath, fileNodeIds);
    const globalMaps = await queryScratchSqlite<{ cnt: number }>(
      dbPath,
      'SELECT COUNT(*) AS cnt FROM object_map'
    );
    expect(Number(globalMaps[0].cnt)).toBe(0);
    await emptyS3Bucket(destBucket);

    await loginAsAdminUi(page);
    await openSystemSettings(page);

    // First apply: the native webdav nodes ARE migrated.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    const e3Run1Body = await waitForTerminalModal(page);
    expect(e3Run1Body).toContain('Migration completed');
    const keysAfterRun1 = await assertPostMigrationBlobState(dbPath, fileNodeIds, destBucket);

    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);

    // Rerun apply: every node is skipped via its preserved s3_key resume
    // marker — nothing is re-copied (no duplicate objects, no re-rolled keys).
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    const e3Run2Body = await waitForTerminalModal(page);
    expect(e3Run2Body).toContain('Migration completed');

    const mapsAfterRun2 = await queryScratchSqlite<{ file_node_id: number; s3_key: string }>(
      dbPath,
      "SELECT file_node_id, s3_key FROM object_map WHERE status = 'active' ORDER BY file_node_id"
    );
    expect(mapsAfterRun2).toHaveLength(fileNodeIds.length);
    expect(mapsAfterRun2.map((r) => r.s3_key).sort()).toEqual(
      keysAfterRun1.map((r) => r.s3_key).sort()
    );
    const s3KeysAfterRun2 = await listS3Keys(destBucket);
    expect(s3KeysAfterRun2).toHaveLength(fileNodeIds.length);

    const nodesAfterRun2 = await queryScratchSqlite<{ id: number; sync_status: string }>(
      dbPath,
      `SELECT id, sync_status FROM file_nodes WHERE id IN (${fileNodeIds.join(', ')})
       ORDER BY id`
    );
    for (const row of nodesAfterRun2) expect(row.sync_status).toBe('active');

    testInfo.annotations.push({
      type: 'e2e-mig-008-no-duplicate',
      description: `keysRun1=${keysAfterRun1.map((r) => r.s3_key).join(',')} keysRun2=${mapsAfterRun2.map((r) => r.s3_key).join(',')} s3ObjectsRun2=${s3KeysAfterRun2.length}`,
    });
  });

  test('E2E-WEBDAV-MIG-004 (Flow A5): Env-sourced blob destination → completed modal shows manual .env guidance', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-a5-env-sourced';
    const projectName = testInfo.project.name;
    const destBucket = migrationDestBucket(projectName);
    scratch = await bootMigrationScratch(testInfo, {
      caseId,
      backend: 'webdav',
      extraEnv: {
        S3_BUCKET: destBucket,
        AWS_REGION: S3_REGION,
        AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
        AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
        S3_ENDPOINT,
      },
    });
    const { baseURL } = scratch;

    const token = await loginToken(baseURL, request);
    const folderName = `migration-a5-${Date.now()}`;
    const folderId = await createAdminFolder(baseURL, request, token, folderName);
    // Real webdav-mode uploads (pending_upload, no object_map) now satisfy the
    // source-aware snapshot — no DB seeding needed.
    for (let i = 0; i < 4; i += 1) {
      await uploadAdminFile(baseURL, request, token, folderId, `a5-${i}.txt`);
    }

    await loginAsAdminUi(page);
    await openSystemSettings(page);
    await openBlobMigrationDialog(page);
    // The destination connection is still entered in the dialog (used for the
    // copy); because every S3_* key is env-sourced, persist skips them.
    await fillS3Dest(page, {
      bucket: destBucket,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);

    await observeMigration(page);
    const modalBody = await waitForTerminalModal(page);
    expect(modalBody).toContain('Migration completed');
    // Env-sourced fallback, NOT the persisted variant.
    expect(modalBody).toContain('configured via environment variables');
    expect(modalBody).toContain('S3_BUCKET');
    expect(modalBody).toContain('Update them in .env manually');
    expect(modalBody).not.toContain('was saved to the server settings');
  });
});
