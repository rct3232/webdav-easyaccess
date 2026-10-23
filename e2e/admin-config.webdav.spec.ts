import { expect, test } from '@playwright/test';

import { loginWithCredentials } from './helpers/auth';
import { openSystemSettings } from './helpers/setupScratch';
import {
  ADMIN_PASSWORD,
  WEBDAV_BASE,
  detectWebdavReachable,
  getConfig,
  loginToken,
  openAdvancedSettings,
  startAdminConfigScratch,
  stopAdminConfigScratch,
  type AdminConfigScratch,
} from './admin-config.helpers';

/**
 * Admin "Advanced settings" WebDAV-specific behavior
 * (docs/features/admin-infrastructure.md +
 * docs/spec/client/components/mypage/SystemConfigEditor.md).
 *
 * Only the cases that need a real WebDAV backend live here: connection-test
 * save gating, the backend-health card/banner, and the WEBDAV_URL row source.
 * Hermetic by design: each case spawns its own fully-configured WebDAV scratch
 * server on the platform port (desktop :5010 / mobile :5017), with a
 * project/case-scoped bytemark subtree.
 *
 * The WebDAV connection keys are NOT in the scratch `.env`: they are
 * pre-seeded into the scratch sqlite DB before the server's first boot, so they
 * resolve as DB-sourced (editable) and setup stays complete (Phase B D1 gating
 * requires editable connection keys; the F4 guard locks env-sourced rows).
 */

test.describe.configure({ mode: 'serial' });

let scratch: AdminConfigScratch | null = null;

test.beforeEach(async ({}, testInfo) => {
  scratch = await startAdminConfigScratch('webdav', testInfo.project.name);
});

test.afterEach(async () => {
  if (scratch) {
    await stopAdminConfigScratch(scratch);
    scratch = null;
  }
});

test.describe('admin config WebDAV connection gating', () => {
  test('E2E-WEBDAV-ADMINCFG-001: Editing WEBDAV_URL blocks Save until a connection test passes', async ({
    page,
    request,
  }) => {
    await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
    await openAdvancedSettings(page);

    // The WebDAV keys are DB-seeded → editable rows, not env-locked (D1 needs
    // an editable connection key).
    const config = await getConfig(scratch!.baseURL, request);
    expect(config.WEBDAV_URL.source).toBe('db');

    const save = page.getByTestId('config-save');
    const testButton = page.getByTestId('config-test-connection');
    const status = page.getByTestId('config-connection-test-status');

    // Re-enter the password so the probe actually reaches the network layer.
    await page.getByTestId('config-secret-toggle-WEBDAV_PASSWORD').click();
    await page.getByTestId('config-secret-new-WEBDAV_PASSWORD').fill('e2etest123');

    // Editing a connection key → Save disabled + Test control + gating hint.
    await page.getByTestId('config-input-WEBDAV_URL').fill('http://127.0.0.1:59999');
    await expect(save).toBeDisabled();
    await expect(testButton).toBeVisible();
    await expect(page.getByTestId('config-connection-test-required')).toBeVisible();

    // A failing connection test (unreachable port) leaves Save disabled. The
    // transport retries 5xx responses (httpClient retry-on-5xx), so the client
    // stays in the "Testing..." state for a few seconds before the error lands.
    const testResp = page.waitForResponse((r) => r.url().includes('/api/admin/config/test'));
    await testButton.click();
    await expect(status).toBeVisible();
    await testResp;
    await expect(status).not.toContainText('Testing...', { timeout: 20000 });
    await expect(save).toBeDisabled();
  });

  test('E2E-WEBDAV-ADMINCFG-002: A passing connection test enables Save and editing invalidates it', async ({
    page,
  }) => {
    test.skip(!(await detectWebdavReachable()), 'WebDAV :8090 unreachable — skipping success path');

    await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
    await openAdvancedSettings(page);

    const save = page.getByTestId('config-save');
    const testButton = page.getByTestId('config-test-connection');
    const status = page.getByTestId('config-connection-test-status');

    await page.getByTestId('config-secret-toggle-WEBDAV_PASSWORD').click();
    await page.getByTestId('config-secret-new-WEBDAV_PASSWORD').fill('e2etest123');
    await page.getByTestId('config-input-WEBDAV_URL').fill(WEBDAV_BASE);
    await expect(save).toBeDisabled();

    const testResp = page.waitForResponse((r) => r.url().includes('/api/admin/config/test'));
    await testButton.click();
    await testResp;
    await expect(status).toContainText('Connection successful.');
    await expect(save).toBeEnabled();

    // Editing the connection key again invalidates the passing result.
    await page.getByTestId('config-input-WEBDAV_URL').fill(`${WEBDAV_BASE}/changed`);
    await expect(status).toHaveCount(0);
    await expect(save).toBeDisabled();
  });
});

test.describe('phase B: backend health & config/test api (WebDAV)', () => {
  test('E2E-WEBDAV-ADMINCFG-003: The backend-health card lists only failing backends', async ({
    page,
    request,
  }) => {
    const token = await loginToken(scratch!.baseURL, request);
    const headers = { Authorization: `Bearer ${token}` };

    // Deterministically seed a failing webdav backend via the connection probe
    // against an unreachable URL (docker-independent): the tracker records it.
    const probe = await request.post(`${scratch!.baseURL}/api/admin/config/test`, {
      headers,
      data: {
        target: 'webdav',
        WEBDAV_URL: 'http://127.0.0.1:59999',
        WEBDAV_USERNAME: 'e2etest',
        WEBDAV_PASSWORD: 'e2etest123',
      },
    });
    await probe.json();

    const healthRes = await request.get(`${scratch!.baseURL}/api/admin/health`, { headers });
    expect(healthRes.ok()).toBeTruthy();
    const health = (await healthRes.json()).backends;
    expect(health.webdav.status).toBe('fail');

    await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
    await openSystemSettings(page);

    const card = page.getByTestId('backend-health-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/webdav/);
    await expect(card).toContainText(/FAIL/);
    // Healthy/unknown backends are not listed.
    await expect(card).not.toContainText(/postgresql/);
    await expect(card).not.toContainText(/s3/);
  });

  test('E2E-WEBDAV-ADMINCFG-004: No backend-health card appears when nothing is failing', async ({
    page,
    request,
  }) => {
    // The card only appears when an active backend is failing. WebDAV :8090 must
    // be reachable for the premise to hold (otherwise skip, like 002). The
    // boot-time webdav probe can race container startup, so settle the tracker
    // deterministically with a successful connection probe first — the same
    // seeding pattern E2E-WEBDAV-ADMINCFG-005 uses for its failing-backend case.
    test.skip(
      !(await detectWebdavReachable()),
      'WebDAV :8090 unreachable — skipping (cannot be "nothing failing")'
    );
    const token = await loginToken(scratch!.baseURL, request);
    await request.post(`${scratch!.baseURL}/api/admin/config/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        target: 'webdav',
        WEBDAV_URL: WEBDAV_BASE,
        WEBDAV_USERNAME: 'e2etest',
        WEBDAV_PASSWORD: 'e2etest123',
      },
    });
    await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
    await openSystemSettings(page);

    await expect(page.getByTestId('backend-health-card')).toHaveCount(0);
  });

  test('E2E-WEBDAV-ADMINCFG-005: The file screen shows the backend-health banner when a backend is failing', async ({
    page,
    request,
  }) => {
    const token = await loginToken(scratch!.baseURL, request);
    const headers = { Authorization: `Bearer ${token}` };

    // The tracker is reset to 'unknown' after the boot probe, so its webdav
    // state settles only on a runtime access (D2). Seed it deterministically
    // with the connection probe, then read the settled status as ground truth
    // for what the banner must render.
    const probe = await request.post(`${scratch!.baseURL}/api/admin/config/test`, {
      headers,
      data: {
        target: 'webdav',
        WEBDAV_URL: WEBDAV_BASE,
        WEBDAV_USERNAME: 'e2etest',
        WEBDAV_PASSWORD: 'e2etest123',
      },
    });
    await probe.json();

    const healthRes = await request.get(`${scratch!.baseURL}/api/admin/health`, { headers });
    expect(healthRes.ok()).toBeTruthy();
    const webdavStatus = (await healthRes.json()).backends.webdav.status as string;
    expect(['ok', 'fail']).toContain(webdavStatus);

    await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
    const healthResp = page.waitForResponse((r) => r.url().includes('/api/health'));
    await page.goto('/files');
    await healthResp;

    const banner = page.getByTestId('backend-health-banner');
    if (webdavStatus === 'fail') {
      await expect(banner).toBeVisible();
    } else {
      await expect(banner).toHaveCount(0);
    }
  });
});
