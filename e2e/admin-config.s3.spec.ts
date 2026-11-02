import path from 'node:path';

import { expect, test } from '@playwright/test';

import { loginWithCredentials } from './helpers/auth';
import { queryScratchSqlite } from './helpers/setupScratch';
import {
  ADMIN_PASSWORD,
  getConfig,
  isLocked,
  openAdvancedSettings,
  putConfig,
  restartAdminConfigScratch,
  saveConfig,
  startAdminConfigScratch,
  stopAdminConfigScratch,
  type AdminConfigScratch,
} from './admin-config.helpers';

/**
 * Admin "Advanced settings" config editor on the default S3 backend
 * (docs/features/admin-infrastructure.md +
 * docs/spec/client/components/mypage/SystemConfigEditor.md).
 *
 * Hermetic by design: each case spawns its own fully-configured S3 scratch
 * server (project-scoped scratch dir + bucket, own sqlite metadata) so the
 * config editor's field-state matrix (source/tier → enabled/disabled), save
 * feedback (applied vs restartRequired), secret lifecycle and post-restart
 * persistence are deterministic. `WEA_FILE_STORAGE=s3` makes setup_complete
 * derive true, so the admin config routes are reachable; the shared :5002
 * server is unused.
 *
 * Every resource is scoped by `testInfo.project.name`, and the port follows the
 * project platform (desktop :5010 / mobile :5017).
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

let scratch: AdminConfigScratch | null = null;

test.beforeEach(async ({}, testInfo) => {
  scratch = await startAdminConfigScratch('s3', testInfo.project.name);
});

test.afterEach(async () => {
  if (scratch) {
    await stopAdminConfigScratch(scratch);
    scratch = null;
  }
});

test('E2E-S3-ADMINCFG-001: Field state matrix drives per-row enabled/disabled state', async ({
  page,
  request,
}) => {
  // Seed DB-sourced rows so the matrix has 'db' sources alongside env/default.
  // S3_BUCKET is env-sourced on this backend (F4 rejects writing it), so use
  // another editable T2 key for the DB-sourced entry.
  await putConfig(scratch!.baseURL, request, {
    CORS_ORIGINS: 'https://seed.test.local',
    GC_ORPHAN_TTL_DAYS: '7',
  });
  const config = await getConfig(scratch!.baseURL, request);

  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);

  // Section A (editable): T1/T2 rows whose effective source is not env render
  // a config-input-* field. Section B (deploy-time read-only): env/T0 rows are
  // platform-config-row-* summaries that never render an editable input.
  const inputStates = await page
    .locator('[data-testid^="config-input-"]')
    .evaluateAll((inputs) =>
      Object.fromEntries(
        inputs.map((input) => [
          input.dataset.testid,
          { disabled: (input as HTMLInputElement).disabled },
        ])
      )
    );
  const platformRows = new Set(
    await page
      .locator('[data-testid^="platform-config-row-"]')
      .evaluateAll((rows) => rows.map((row) => row.dataset.testid))
  );
  const secretToggles = new Set(
    await page
      .locator('[data-testid^="config-secret-toggle-"]')
      .evaluateAll((toggles) => toggles.map((toggle) => toggle.dataset.testid))
  );
  let envRows = 0;
  for (const [key, entry] of Object.entries(config)) {
    const input = inputStates[`config-input-${key}`];
    const hasInput = Boolean(input);
    const hasPlatformRow = platformRows.has(`platform-config-row-${key}`);
    if (!hasInput && !hasPlatformRow) continue; // not displayed in the editor

    if (isLocked(entry) || hasPlatformRow) {
      // Section B — env/T0 rows and keys without editable display metadata
      // are read-only platform summaries.
      expect(input, `platform row ${key} must not render an input`).toBeUndefined();
      expect(hasPlatformRow, `platform row ${key}`).toBe(true);
      if (entry.source === 'env') envRows += 1;
      continue;
    }

    // Section A — editable rows.
    if (entry.secret) {
      // The masked display is always read-only; the "set new value" toggle is
      // the edit affordance for editable secrets.
      expect(input.disabled, `masked display ${key}`).toBe(true);
      expect(secretToggles.has(`config-secret-toggle-${key}`), `editable secret ${key}`).toBe(true);
    } else {
      expect(input.disabled, `editable ${key}`).toBe(false);
    }
  }

  // registration_enabled lives in the main settings rows, never the editor.
  await expect(page.getByTestId('config-input-registration_enabled')).toHaveCount(0);

  // Every env-sourced row carries the "Set in .env" helper.
  await expect(page.getByText('Set in .env (env takes precedence)')).toHaveCount(envRows);
});

test('E2E-S3-ADMINCFG-002: Save feedback applies T2 immediately and flags T1 for restart', async ({
  page,
  request,
}) => {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);

  const save = page.getByTestId('config-save');
  await expect(save).toBeDisabled(); // nothing dirty yet

  // Per-field tier badges (F5): shown while editing, before any save.
  await expect(page.getByTestId('config-tier-CORS_ORIGINS')).toContainText('Applies immediately');
  await expect(page.getByTestId('config-tier-FFMPEG_PATH')).toContainText('Restart required');

  // T2 (hot) + T1 (restart) edits. FFMPEG_PATH is a non-connection T1 key, so
  // Save is not gated behind a connection test (D1).
  await page.getByTestId('config-input-CORS_ORIGINS').fill('https://app.test.local');
  await page.getByTestId('config-input-FFMPEG_PATH').fill('/usr/bin/ffmpeg');
  await expect(save).toBeEnabled();

  await saveConfig(page);
  await expect(page.getByTestId('config-applied-banner')).toBeVisible();
  await expect(page.getByTestId('config-applied-banner')).toContainText('CORS_ORIGINS');
  await expect(page.getByTestId('config-restart-banner')).toBeVisible();
  await expect(page.getByTestId('config-restart-banner')).toContainText('FFMPEG_PATH');
  await expect(page.getByTestId('config-restart-banner')).not.toContainText('CORS_ORIGINS');

  // Applied immediately for T2 (async resolver reads the DB fresh).
  await expect
    .poll(() => getConfig(scratch!.baseURL, request).then((c) => c.CORS_ORIGINS.value))
    .toBe('https://app.test.local');
  const config = await getConfig(scratch!.baseURL, request);
  expect(config.CORS_ORIGINS.source).toBe('db');
  expect(config.FFMPEG_PATH.value).toBe('/usr/bin/ffmpeg');
  expect(config.FFMPEG_PATH.source).toBe('db');
});

// The retired third admin-config case (app-layer field encryption, W-A) is
// intentionally absent: DB secret rows are plaintext and always readable, so
// no key-lost warning surface exists to test.

test('E2E-S3-ADMINCFG-003: Secret lifecycle masks values, keeps unchanged input, and stores new values plaintext', async ({
  page,
  request,
}) => {
  await putConfig(scratch!.baseURL, request, { EMAIL_PASSWORD: 'initial-secret' });

  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);

  const secretInput = page.getByTestId('config-input-EMAIL_PASSWORD');
  await expect(secretInput).toHaveValue('****'); // masked, never plaintext
  await expect(secretInput).toBeDisabled();

  const dbPath = path.join(scratch!.scratch, 'webdav.db');
  const rawSecret = async (): Promise<string> => {
    const rows = await queryScratchSqlite<{ value: string }>(
      dbPath,
      "SELECT value FROM settings WHERE key = 'EMAIL_PASSWORD'"
    );
    return rows[0].value;
  };

  // 1) PUT stored the new secret as plaintext (no encryption payload).
  expect(await rawSecret()).toBe('initial-secret');

  // 2) Leave the secret untouched, save another change → plaintext kept as-is.
  await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('9');
  await saveConfig(page);
  await expect
    .poll(() => getConfig(scratch!.baseURL, request).then((c) => c.GC_ORPHAN_TTL_DAYS.value), {
      timeout: 90_000,
    })
    .toBe('9');
  expect(await rawSecret()).toBe('initial-secret');

  // 3) "Set new value" but leave it blank → still kept.
  await page.getByTestId('config-secret-toggle-EMAIL_PASSWORD').click();
  await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('10');
  await saveConfig(page);
  await expect
    .poll(() => getConfig(scratch!.baseURL, request).then((c) => c.GC_ORPHAN_TTL_DAYS.value), {
      timeout: 90_000,
    })
    .toBe('10');
  expect(await rawSecret()).toBe('initial-secret');

  // 4) "Set new value" and type → stored plaintext with the new value.
  await page.getByTestId('config-secret-toggle-EMAIL_PASSWORD').click();
  await page.getByTestId('config-secret-new-EMAIL_PASSWORD').fill('new-secret');
  await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('11');
  await saveConfig(page);
  await expect
    .poll(() => getConfig(scratch!.baseURL, request).then((c) => c.GC_ORPHAN_TTL_DAYS.value), {
      timeout: 90_000,
    })
    .toBe('11');
  expect(await rawSecret()).toBe('new-secret');

  // 5) Re-save without touching the secret → stored value unchanged (no rewrite).
  const before5 = await rawSecret();
  await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('12');
  await saveConfig(page);
  await expect
    .poll(() => getConfig(scratch!.baseURL, request).then((c) => c.GC_ORPHAN_TTL_DAYS.value), {
      timeout: 90_000,
    })
    .toBe('12');
  expect(await rawSecret()).toBe(before5);
});

test('E2E-S3-ADMINCFG-004: A T1 change persists across a server restart (source db)', async ({
  page,
  request,
}) => {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);

  // FFMPEG_PATH is a non-connection T1 key (Save not gated by D1), so the
  // restart persistence is exercised deterministically.
  await page.getByTestId('config-input-FFMPEG_PATH').fill('/usr/bin/ffmpeg');
  await saveConfig(page);
  await expect(page.getByTestId('config-restart-banner')).toContainText('FFMPEG_PATH');

  // Restart the scratch server (same .env + sqlite persist in the scratch dir).
  await restartAdminConfigScratch(scratch!);

  const config = await getConfig(scratch!.baseURL, request);
  expect(config.FFMPEG_PATH.value).toBe('/usr/bin/ffmpeg');
  expect(config.FFMPEG_PATH.source).toBe('db');

  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);
  await expect(page.getByTestId('config-input-FFMPEG_PATH')).toHaveValue('/usr/bin/ffmpeg');
});

test('E2E-S3-ADMINCFG-005: Non-connection keys save without a connection test', async ({
  page,
  request,
}) => {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);

  const save = page.getByTestId('config-save');
  await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('7');
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('config-test-connection')).toHaveCount(0);
  await expect(page.getByTestId('config-connection-test-required')).toHaveCount(0);

  await saveConfig(page);
  await expect(page.getByTestId('config-applied-banner')).toContainText('GC_ORPHAN_TTL_DAYS');
  await expect
    .poll(() => getConfig(scratch!.baseURL, request).then((c) => c.GC_ORPHAN_TTL_DAYS.value), {
      timeout: 90_000,
    })
    .toBe('7');
});

test('E2E-S3-ADMINCFG-006: T0 keys render read-only in Section B, in registry order', async ({
  page,
}) => {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await openAdvancedSettings(page);

  // Deploy-time T0 rows (the WEA_DB_* metadata block / WEA_SQLITE_PATH /
  // JWT_SECRET) are present as read-only Section B summaries — never as
  // editable inputs. This supersedes the D5 "T0 metadata group absent"
  // assertion: the Section A/B split (W-B) moved these rows into the
  // Deploy-time summary instead of hiding them.
  for (const key of ['WEA_SQLITE_PATH', 'WEA_DB_HOST', 'WEA_DB_PASSWORD', 'JWT_SECRET']) {
    await expect(page.getByTestId(`config-input-${key}`)).toHaveCount(0);
    await expect(page.getByTestId(`platform-config-row-${key}`)).toHaveCount(1);
  }

  // Section B rows appear in registry order (the server returns config in
  // configRegistry sequence and the editor renders rows in the same order).
  const rowIds = await page
    .locator('[data-testid^="platform-config-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const pos = (key: string) => rowIds.indexOf(`platform-config-row-${key}`);
  expect(pos('WEA_SQLITE_PATH')).toBeGreaterThanOrEqual(0);
  expect(pos('WEA_DB_HOST')).toBeGreaterThan(pos('WEA_SQLITE_PATH'));
  expect(pos('WEA_DB_PASSWORD')).toBeGreaterThan(pos('WEA_DB_HOST'));
  expect(pos('JWT_SECRET')).toBeGreaterThan(pos('WEA_DB_PASSWORD'));

  // Secret presence is preserved: a SET env secret (JWT_SECRET is in the
  // scratch .env) is masked '****'; an UNSET secret (WEA_DB_PASSWORD has no
  // env value in the sqlite scratch boot) shows the '(unset)' text and is
  // never reported as '****'.
  const jwtRow = page.getByTestId('platform-config-row-JWT_SECRET');
  await expect(jwtRow).toContainText('****');
  await expect(jwtRow).not.toContainText('(unset)');

  const passwordRow = page.getByTestId('platform-config-row-WEA_DB_PASSWORD');
  await expect(passwordRow).toContainText('(unset)');
  await expect(passwordRow).not.toContainText('****');
});
