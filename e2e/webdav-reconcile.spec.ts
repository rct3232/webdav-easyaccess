import { execFileSync } from 'node:child_process';
import http from 'node:http';

import { ADMIN_STATE, expect, test } from './fixtures/authenticated';
import { TEST_FILES } from './fixtures/test-data';
import {
  buildName,
  flushPrivateWorkspaceCleanups,
  openPrivateWorkspace,
  readTestFileFixture,
  uploadFileAt,
} from './helpers/files';
import { getSessionToken, resolveNodeId } from './helpers/resolvePath';

/**
 * E2E-RECON-001 — DEF-18 WebDAV Tier 2 reconciliation, API level.
 *
 * Rationale (non-destructiveness, not deletion): GC Tier 2 only ages entries
 * into candidacy after GC_ORPHAN_TTL_DAYS (floor 1 day, S2), and every
 * candidate under a KEPT directory is report-only (S1). Nothing freshly
 * created during this run can therefore be deleted — the foreign file PUT
 * raw inside the LIVE workspace dir must survive the reconciliation cycle
 * byte-where-it-lies. Actual delete semantics (bottom-up removal of unkept
 * trees) are unit-tested in server/service/__tests__/gcService.test.js.
 *
 * To prove Tier 2 is genuinely NOT skipped in WebDAV mode, the remote-only
 * orphan dir is backdated (docker exec touch inside the bytemark container)
 * so it becomes an aged candidate, untracked and unkept — the cycle reports
 * it (untrackedKeys >= 1) and reclaims it.
 */

// Raw DAV access to the bytemark container backing the main :5002 server in
// webdav mode (pattern: e2e/trash-admin.spec.ts).
const WEBDAV_HOST = '127.0.0.1';
const WEBDAV_PORT = 8090;
const WEBDAV_AUTH = Buffer.from('e2etest:e2etest123').toString('base64');
// bytemark/webdav serves the DAV root from /var/lib/dav/data inside the
// container (verified: PROPFIND / maps to ./data/webdav/data on the host).
const CONTAINER_DATA_ROOT = '/var/lib/dav/data';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

interface DavResponse {
  status: number;
  body: string;
}

function davRequest(method: string, davPath: string, body?: string): Promise<DavResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: WEBDAV_HOST,
        port: WEBDAV_PORT,
        path: encodeURI(davPath),
        method,
        headers: {
          Authorization: `Basic ${WEBDAV_AUTH}`,
          ...(method === 'PROPFIND' ? { Depth: '1' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function pathExists(davPath: string): Promise<boolean> {
  const res = await davRequest('PROPFIND', davPath);
  return res.status === 207 || res.status === 200;
}

/** Backdate a container-side path so it passes the Tier 2 age cutoff (S2). */
function backdateInContainer(containerPath: string): void {
  execFileSync('docker', ['exec', 'webdav-e2e-test', 'touch', '-d', '202001010000', containerPath]);
}

test.use({ storageState: ADMIN_STATE });

test.afterEach(async ({ request }) => {
  await flushPrivateWorkspaceCleanups(request);
});

test('E2E-RECON-001: webdav Tier 2 reconciles without destructive surprises', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const token = await getSessionToken(page);

  // A live node: workspace folder (kept dir) + app upload (kept file).
  const liveFileName = buildName(testInfo, 'recon-live', '.txt');
  const folderNodeId = await resolveNodeId(request, token, `/${base}`);
  await uploadFileAt(request, token, folderNodeId, liveFileName, 'text/plain', textFixtureBuffer);

  const ts = Date.now();
  const foreignInLivePath = `/${base}/recon-foreign-${ts}.txt`;
  const orphanDir = `reconcile-orphan-${ts}`;
  const orphanPath = `/${orphanDir}/x.txt`;

  // Foreign file INSIDE the live workspace dir. Parent collection exists
  // (the app MKCOL'd it), so a plain PUT works.
  const putForeign = await davRequest('PUT', foreignInLivePath, 'foreign-in-live-tree');
  expect(putForeign.status).toBe(201);

  // Orphan under a REMOTE-ONLY dir. Apache 403s a PUT to a missing parent,
  // so MKCOL first; then backdate the whole orphan subtree so it clears the
  // age cutoff and actually enters the candidate set.
  const mkcol = await davRequest('MKCOL', `/${orphanDir}/`);
  expect(mkcol.status).toBe(201);
  const putOrphan = await davRequest('PUT', orphanPath, 'remote-only-orphan');
  expect(putOrphan.status).toBe(201);
  backdateInContainer(`${CONTAINER_DATA_ROOT}/${orphanDir}/x.txt`);
  backdateInContainer(`${CONTAINER_DATA_ROOT}/${orphanDir}`);

  // Run one GC cycle through the admin cleanup endpoint (docs/spec/server/
  // services/gcService.md §5.2). Tier 2 must be live in WebDAV mode.
  // The smoke projects share one DAV container; a transient mid-list hiccup
  // under parallel load aborts only that cycle (candidates survive, nothing
  // was reclaimed), so retry once with a short settle window (see RCA 2026-09-12).
  const runCleanup = async () => {
    const res = await request.post('/api/admin/cleanup/orphaned', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    return body.results.gc.tier2;
  };

  let tier2 = await runCleanup();
  if (tier2.skipped || tier2.untrackedKeys < 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    tier2 = await runCleanup();
  }

  expect(tier2.skipped).toBe(false);
  // The aged remote-only orphan dir + its file are untracked candidates.
  expect(tier2.untrackedKeys).toBeGreaterThanOrEqual(1);
  // The fresh foreign file inside the LIVE (kept) dir survives the cycle —
  // S1/S2 biases make reconciliation non-destructive to in-flight and
  // in-tree content. (Delete semantics themselves are unit-tested.)
  expect(await pathExists(foreignInLivePath)).toBe(true);
  // ...while the aged, unkept orphan is reconciled away bottom-up.
  expect(await pathExists(orphanPath)).toBe(false);

  // Explicitly remove what may still be out there; GC already reclaimed the
  // orphan, so these tolerate 404/405.
  await davRequest('DELETE', foreignInLivePath);
  await davRequest('DELETE', `/${orphanDir}/`);
});
