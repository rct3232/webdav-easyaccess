import fs from 'node:fs';
import path from 'node:path';

import { expect, Page, TestInfo, test } from '@playwright/test';

import {
  ensureClientBuild,
  execScratchSqlite,
  killScratch,
  prepareScratchS3,
  queryScratchSqlite,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';
import { e2ePorts } from './helpers/ports';
import { loginWithCredentials } from './helpers/auth';
import {
  ensureScratchRegularUser,
  loginScratchAdmin,
  type ScratchUserCreds,
} from './helpers/scratchUser';
import { flushPrivateWorkspaceCleanups } from './helpers/files';
import { loginAndOpenUserWorkspace, seedFile } from './helpers/collectionsWorkspace';
import { getSessionToken } from './helpers/resolvePath';

/**
 * E2E-S3-STORAGE-001..002 — storage management surfaces: the MyPage Storage
 * usage breakdown + snapshot sparkline and the persisted cleanup-suggestion
 * checklist lifecycle (docs/E2E_COVERAGE_PLAN.md § "Storage management
 * (hermetic)").
 *
 * Split out of `collections.spec.ts` (which keeps E2E-S3-COLLECTION-001..024):
 * both cases exercise storage routes/dashboards, not collection lifecycle, so
 * they own a dedicated spec. The storage projects own dedicated scratch slots
 * (`:5022` desktop / `:5023` mobile): no other project shares them, so the
 * suite never declares a Playwright project dependency.
 *
 * SCRATCH-HERMETIC per the destructive-case policy (docs/TESTING_STRATEGY.md):
 * this suite permanently trashes/restores nodes and reaches the regular user's
 * MyPage Storage dashboard, so it boots its OWN server per Playwright project
 * (own sqlite, project-scoped S3 bucket) and never touches the shared `:5002`
 * pool. One scratch server serves the whole (serial) file per project. The
 * scratch server runs with `WEA_SKIP_AI_WORKER=1`; the persisted-suggestion
 * case seeds hash-duplicates through the upload API — the dup generator leg is
 * hash-first/LLM-free (`routes/storage.md` §2.4), and the ABSENCE of an embed
 * model is part of what 002 pins (§4.12 absent-not-disabled).
 *
 * IDENTITY (admin-operator pivot, PLAN §14): every case authenticates as a
 * REGULAR USER provisioned by `beforeAll` (`ensureScratchRegularUser` — admin
 * API create, which also ensures the `/<username>` home node). The scratch
 * admin stays bootstrapped for OPERATOR duties only: user provisioning and the
 * perm-delete folder-purge fallback (`flushPrivateWorkspaceCleanups`).
 */
const CASE_ID = 'storage';
/** Scratch boot identity (ADMIN_DEFAULT_PASSWORD) — OPERATOR duties only. */
const ADMIN_PASSWORD = 'StorageE2e!123';
/** The provisioned regular user every case acts as (home node: `/storage-e2e-user`). */
const USER_CREDS: ScratchUserCreds = {
  username: 'storage-e2e-user',
  password: 'StorageE2eUser!123',
  email: 'storage-e2e-user@e2etest.com',
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe.configure({ mode: 'serial', timeout: 180_000 });

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile');
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
/** Scratch admin bearer — OPERATOR duties only (provisioning + perm-delete flush). */
let operatorToken = '';

test.beforeAll(async ({ request }, testInfo) => {
  const projectName = testInfo.project.name;
  // Independent desktop/mobile worlds: each project owns its dedicated port
  // slot, its scratch directory and its S3 bucket.
  const port = isMobileProject(testInfo) ? e2ePorts.scratchStorageMobile : e2ePorts.scratchStorage;
  scratch = scratchDirFor(CASE_ID, projectName);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  // S3 is the product's default backend; prepareScratchS3 ensures the
  // project-scoped bucket exists and empties it for a deterministic run.
  const bucket = await prepareScratchS3(projectName);
  writeScratchEnv(scratch, {
    PORT: String(port),
    ...s3ScratchEnv(bucket),
    ...scratchRuntimeEnv(),
    JWT_SECRET: 'storage-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, port);
  await waitForScratchHealth(spawned, port);
  // The lifecycle ACTOR is a regular user, provisioned through the bootstrapped
  // admin (which also creates + grants the `/<username>` home node). The admin
  // token stays for OPERATOR calls.
  operatorToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  await ensureScratchRegularUser(request, operatorToken, USER_CREDS);
});

test.afterAll(async () => {
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test.afterEach(async ({ request }) => {
  // Case containment: perm-delete the case workspace subtree (the physical
  // purge is admin-only, hence the OPERATOR fallback token — dual-token
  // cleanup, admin-operator pivot PLAN §14). Trashed/restored items and
  // dismissed suggestion rows die with the case workspace or the scratch db.
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-S3-STORAGE-001: the Storage dashboard renders the usage breakdown and a two-point sparkline from persisted snapshots, then omits the sparkline after the series loses its second point', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const dbPath = path.join(scratch, 'webdav.db');
  const userIdRows = await queryScratchSqlite<{ id: number }>(
    dbPath,
    `SELECT id FROM users WHERE username = '${USER_CREDS.username}'`
  );
  expect(userIdRows).toHaveLength(1);
  const userId = Number(userIdRows[0].id);

  const utcDay = (offsetDays: number) => {
    const now = new Date();
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays)
    );
    return day.toISOString().slice(0, 10);
  };
  const yesterday = utcDay(1);
  const today = utcDay(0);
  const yesterdayBytes = 1_048_576;
  const todayBytes = 2_097_152;

  const seedSnapshots = async () => {
    await execScratchSqlite(
      dbPath,
      `INSERT OR REPLACE INTO storage_usage_snapshots (user_id, day, bytes)
       VALUES (${userId}, '${yesterday}', ${yesterdayBytes}),
              (${userId}, '${today}', ${todayBytes})`
    );
  };
  const deleteSnapshots = async () => {
    await execScratchSqlite(
      dbPath,
      `DELETE FROM storage_usage_snapshots WHERE user_id = ${userId}`
    );
  };

  await seedSnapshots();
  try {
    await loginWithCredentials(page, USER_CREDS.username, USER_CREDS.password);
    const token = await getSessionToken(page);
    const openStorage = async () => {
      await page.goto('/mypage');
      if (isMobile) {
        const drawer = page.locator('.MuiDrawer-paper');
        await page.locator('button[aria-label="My page"]').click();
        await expect(drawer).toBeVisible();
        await drawer.getByRole('button', { name: /^storage$/i }).click();
        await expect(drawer).not.toBeVisible();
      } else {
        await page.getByRole('button', { name: /^storage$/i }).click();
      }
      await expect(page.getByTestId('storage-dashboard')).toBeVisible();
    };

    await openStorage();
    await expect(page.getByTestId('storage-usage-summary')).toBeVisible();
    // Fresh regular-user home: no live files, no trash, no versions yet.
    await expect(page.getByTestId('storage-usage-total')).toHaveText(/0 B/);
    await expect(page.getByTestId('storage-usage-live')).toHaveText(/0 B/);
    await expect(page.getByTestId('storage-usage-trash')).toHaveText(/0 B/);
    await expect(page.getByTestId('storage-usage-versions')).toHaveText(/0 B/);

    const sparkline = page.getByTestId('storage-usage-sparkline');
    await expect(sparkline).toBeVisible();
    const points = await sparkline.locator('polyline').getAttribute('points');
    expect(points?.trim().split(/\s+/)).toHaveLength(2);

    // One-shot wire contract: exactly the persisted series + the current
    // breakdown (empty workspace), with the dynamic `as_of` echoed verbatim.
    const usageRes = await request.get('/api/storage/usage', { headers: auth(token) });
    expect(usageRes.status()).toBe(200);
    const usage = (await usageRes.json()) as {
      current: Record<string, unknown>;
      series: { points: Array<{ day: string; bytes: number }> };
    };
    expect(usage).toEqual({
      current: {
        total_bytes: 0,
        live_bytes: 0,
        trash_bytes: 0,
        version_bytes: 0,
        version_history_supported: true,
        incomplete: false,
        as_of: usage.current.as_of,
      },
      series: {
        points: [
          { day: yesterday, bytes: yesterdayBytes },
          { day: today, bytes: todayBytes },
        ],
      },
    });
    expect(String(usage.current.as_of)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    // Negative sub-step: one remaining snapshot is below the two-point
    // minimum, so the server returns `{points:[]}` and the UI omits the chart.
    await execScratchSqlite(
      dbPath,
      `DELETE FROM storage_usage_snapshots WHERE user_id = ${userId} AND day = '${today}'`
    );
    // Re-enter the category so the dashboard remounts and re-reads usage.
    await openStorage();
    await expect(page.getByTestId('storage-usage-summary')).toBeVisible();
    await expect(page.getByTestId('storage-usage-sparkline')).toHaveCount(0);

    const singleRes = await request.get('/api/storage/usage', { headers: auth(token) });
    expect(singleRes.status()).toBe(200);
    expect((await singleRes.json()).series).toEqual({ points: [] });
  } finally {
    await deleteSnapshots();
  }
});

// ---------------------------------------------------------------------------
// Persisted cleanup-suggestion lifecycle (T3.3 — routes/storage.md §2.4,
// StorageCleanupSuggestions.md §2.3/§2.7, AI_FEATURE_PLAN §4.12/§4.16/§4.17)
// ---------------------------------------------------------------------------

interface DashboardSuggestionRow {
  id: number;
  node_id: number;
  kind: string;
  path: string;
  size_bytes: number;
  reason: { kind: string; keep_node_id?: number };
  created_at: string;
  expires_at: string | null;
}

interface StorageBody {
  hygiene?: {
    duplicates: { group_count: number; duplicate_count: number; reclaimable_bytes: number };
    near_duplicates?: { group_count: number; duplicate_count: number };
    trash: { item_count: number; total_bytes: number; retention_days: number };
  };
  duplicates?: { group_count: number; duplicate_count: number; reclaimable_bytes: number };
  near_duplicates?: { group_count: number; duplicate_count: number };
  suggestions: DashboardSuggestionRow[];
  trash?: { item_count: number; total_bytes: number; retention_days: number };
}

/** Trash count from the canonical nested payload, tolerating the flat shape. */
function trashCount(body: StorageBody): number {
  return body.hygiene?.trash?.item_count ?? body.trash?.item_count ?? 0;
}

/** The LAST persisted row state for a node (`storage_suggestions` is append-per-
 * kind: the accept→undo→dismiss transitions ride the same row). */
async function fileSuggestionStateForNode(nodeId: number): Promise<string | undefined> {
  const rows = await queryScratchSqlite<{ state: string }>(
    path.join(scratch, 'webdav.db'),
    `SELECT state FROM storage_suggestions WHERE node_id = ${nodeId} ORDER BY id DESC LIMIT 1`
  );
  return rows[0]?.state;
}

/** MyPage category navigation: permanent sidebar (desktop) vs drawer (mobile). */
async function openMyPageStorage(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/mypage');
  if (isMobile) {
    const drawer = page.locator('.MuiDrawer-paper');
    await page.locator('button[aria-label="My page"]').click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /^storage$/i }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    await page.getByRole('button', { name: /^storage$/i }).click();
  }
}

test('E2E-S3-STORAGE-002: the persisted cleanup-suggestion checklist accepts the hash-duplicate row with an undo that restores the node and re-lists the row, dismisses silently and stays AI-block free while the embed model is absent', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  // Two byte-identical uploads: the hash-first pass lists the HIGHER node id
  // under the deterministic keeper rule (`keep_node_id` = smallest id); the
  // upload write side stamps `content_hash` (`fileService` post-commit hook),
  // so the rows materialize on the dashboard read itself.
  const keeper = await seedFile(request, token, base, testInfo, 'sugg-keeper');
  const dup = await seedFile(request, token, base, testInfo, 'sugg-dup');
  const dupName = dup.path.split('/').pop() as string;

  const readDashboard = async (): Promise<StorageBody> => {
    const res = await request.get('/api/storage', { headers: auth(token) });
    expect(res.ok()).toBeTruthy();
    return res.json() as Promise<StorageBody>;
  };

  // (a) Persisted rows: the read materializes the pending set, rows carry ids,
  //     the keeper never lists, and the embed-unconfigured payload omits the
  //     vector section entirely (§4.12 absent-not-disabled).
  let body = await readDashboard();
  const seeded = body.suggestions.find((row) => row.node_id === dup.nodeId);
  expect(seeded).toBeTruthy();
  expect(seeded!.kind).toBe('exact_dup');
  expect(seeded!.id).toBeTruthy();
  expect(seeded!.reason.keep_node_id).toBe(keeper.nodeId);
  expect(body.suggestions.some((row) => row.node_id === keeper.nodeId)).toBe(false);
  expect(body.hygiene?.near_duplicates ?? body.near_duplicates).toBeUndefined();
  expect(body.suggestions.every((row) => row.kind !== 'near_dup')).toBe(true);
  const trashBaseline = trashCount(body);

  await openMyPageStorage(page, isMobile);
  await expect(page.getByTestId('storage-dashboard')).toBeVisible();

  // (b) The checklist row: checkbox + per-row dismiss anchored on the
  //     PERSISTED id; NO accept control before a selection (single-control
  //     rule, StorageCleanupSuggestions.md §2.3).
  const checklistRow = page.locator('#storage-suggestions li').filter({ hasText: dupName });
  await expect(checklistRow).toBeVisible({ timeout: 30_000 });
  await expect(checklistRow.getByTestId('suggestion-checkbox')).toBeVisible();
  await expect(page.getByTestId(`suggestion-dismiss-${seeded!.id}`)).toBeVisible();
  await expect(page.getByTestId('suggestions-accept')).toHaveCount(0);

  // (c) checkbox → accept → trash verify. The trash check runs INSIDE the 8 s
  //     undo-toast window (bounded API reads, not browser navigation).
  await checklistRow.getByTestId('suggestion-checkbox').check();
  await expect(page.getByTestId('suggestions-accept')).toContainText('Accept selected (1)');
  await page.getByTestId('suggestions-accept').click();

  await expect(page.getByText(/Moved 1 items to Trash/i)).toBeVisible();
  const toastUndo = page.getByTestId('undo-toast-action');
  await expect(toastUndo).toBeVisible();
  await expect
    .poll(
      async () => {
        const after = await readDashboard();
        return (
          trashCount(after) === trashBaseline + 1 &&
          !after.suggestions.some((row) => row.node_id === dup.nodeId)
        );
      },
      { timeout: 10_000 }
    )
    .toBe(true);
  await expect(checklistRow).toHaveCount(0);
  await expect.poll(() => fileSuggestionStateForNode(dup.nodeId)).toBe('accepted');

  // (d) undo → the node returns from trash AND the row re-lists (the same
  //     command flips `pending → accepted` back, one journaled command).
  await toastUndo.click();
  await expect(page.getByText(/1 undone/i)).toBeVisible();
  await expect(checklistRow).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => fileSuggestionStateForNode(dup.nodeId)).toBe('pending');
  await expect.poll(async () => trashCount(await readDashboard())).toBe(trashBaseline);

  // (e) dismiss removes the row WITHOUT a toast (self-reversing preference,
  //     no journal row — routes/storage.md §2.4 dismiss).
  body = await readDashboard();
  const relisted = body.suggestions.find((row) => row.node_id === dup.nodeId);
  expect(relisted?.id).toBeTruthy();
  await page.getByTestId(`suggestion-dismiss-${relisted!.id}`).click();
  await expect(checklistRow).toHaveCount(0);
  await expect(page.getByTestId('undo-toast-action')).toHaveCount(0);
  await expect(page.getByText(/items to Trash/i)).toHaveCount(0);
  await expect.poll(() => fileSuggestionStateForNode(dup.nodeId)).toBe('dismissed');
  // Never re-listed and never re-inserted for the same node+kind.
  await expect(async () => {
    const after = await readDashboard();
    expect(after.suggestions.some((row) => row.node_id === dup.nodeId)).toBe(false);
  }).toPass({ timeout: 10_000 });

  // (f) AI-block gate audit (§4.12): embed unconfigured ⇒ no storage-usage
  //     sparkline (no snapshot data) and no near-dup surfaces on the dashboard.
  await expect(page.getByTestId('storage-usage-sparkline')).toHaveCount(0);
  await expect(page.getByText(/near[- ]duplicate/i)).toHaveCount(0);

  // The trashed→restored pair rides the afterEach workspace purge (perm-delete
  // of the case folder; the dismissed suggestion row dies with the scratch db).
});
