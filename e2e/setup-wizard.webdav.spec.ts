import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { expect, test } from '@playwright/test';

import { loginWithCredentials } from './helpers/auth';
import { queryScratchPg } from './helpers/setupScratch';
import { skipWhenUnavailable } from './helpers/skipPolicy';
import {
  PG_HOST,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  WEBDAV_PASSWORD,
  WEBDAV_USERNAME,
  assertFileRoundTrip,
  buildWebdavUrl,
  isPgReachable,
  loginToken,
  runSetupScenario,
  setupWizardPgDb,
  type CaseConfig,
} from './setup-wizard.helpers';

const require = createRequire(__filename);

/**
 * First-run setup wizard WebDAV cases (E2E-WEBDAV-SETUP-001..003).
 *
 * Hermetic by design: each case spawns its own scratch server on the platform
 * port (desktop :5003 / mobile :5004), with a project-scoped scratch directory,
 * a project/case-scoped bytemark root, and (for the PG case) a project-scoped
 * scratch PG database. The wizard writes the WebDAV settings itself; the DAV
 * subtree is created without seeding the scratch DB so the DB assertions prove
 * apply actually persisted the wizard values.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test('E2E-WEBDAV-SETUP-001 (Case 1): Sqlite + webdav configure-and-restart', async ({
  page,
  request,
}, testInfo) => {
  const projectName = testInfo.project.name;
  const config: CaseConfig = {
    caseId: 'case-1-sqlite-webdav',
    adminPassword: 'SetupE2e!123',
    jwtSecret: 'e2e-setup-jwt-secret-case1',
    metadata: { backend: 'sqlite' },
    file: {
      backend: 'webdav',
      url: buildWebdavUrl('case-1-sqlite-webdav', projectName),
      username: WEBDAV_USERNAME,
      password: WEBDAV_PASSWORD,
    },
  };

  await runSetupScenario(
    config,
    page,
    request,
    projectName,
    async ({ request: req, config: cfg, apiBaseURL }) => {
      // Login with the wizard-chosen admin works after restart.
      const token = await loginToken(apiBaseURL, req, 'admin', cfg.adminPassword);

      // Upload + download round-trip against the webdav subtree.
      await assertFileRoundTrip(req, token, 'setup-001', apiBaseURL);

      // Browser: admin login lands in the explorer.
      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();

      // /setup is no longer reachable — it redirects to /login.
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    }
  );
});

test('E2E-WEBDAV-SETUP-002 (Case 3): Postgresql + webdav seeds scratch PG, not scratch sqlite', async ({
  page,
  request,
}, testInfo) => {
  skipWhenUnavailable(
    !(await isPgReachable()),
    'E2E-WEBDAV-SETUP-002 requires reachable scratch PostgreSQL (:5433)'
  );

  const projectName = testInfo.project.name;
  const pgDb = setupWizardPgDb(projectName);
  const config: CaseConfig = {
    caseId: 'case-3-pg-webdav',
    adminPassword: 'SetupE2e!123',
    jwtSecret: 'e2e-setup-jwt-secret-case3',
    metadata: {
      backend: 'postgresql',
      host: PG_HOST,
      port: PG_PORT,
      database: pgDb,
      user: PG_USER,
      password: PG_PASSWORD,
    },
    file: {
      backend: 'webdav',
      url: buildWebdavUrl('case-3-pg-webdav', projectName),
      username: WEBDAV_USERNAME,
      password: WEBDAV_PASSWORD,
    },
  };

  await runSetupScenario(
    config,
    page,
    request,
    projectName,
    async ({ scratch, request: req, config: cfg, apiBaseURL }) => {
      const token = await loginToken(apiBaseURL, req, 'admin', cfg.adminPassword);

      // The scratch PG database is the metadata store of record: schema
      // migrations applied and admin seeded with ADMIN_DEFAULT_PASSWORD.
      const migrations = await queryScratchPg<{ filename: string }>(
        pgDb,
        'SELECT filename FROM _schema_migrations'
      );
      expect(migrations.length).toBeGreaterThan(0);

      const admins = await queryScratchPg<{
        username: string;
        password: string;
        is_admin: boolean;
      }>(pgDb, "SELECT username, password, is_admin FROM users WHERE username = 'admin'");
      expect(admins).toHaveLength(1);
      expect(admins[0].is_admin).toBeTruthy();
      const bcrypt = require('bcryptjs') as {
        compare: (plain: string, hash: string) => Promise<boolean>;
      };
      expect(await bcrypt.compare(cfg.adminPassword, admins[0].password)).toBeTruthy();

      // Under D6/D7 the pre-boot .env declares the postgresql metadata backend
      // (the full WEA_DB_* identity block), so the scratch sqlite file is never
      // created.
      const dbPath = path.join(scratch, 'webdav.db');
      expect(fs.existsSync(dbPath)).toBeFalsy();

      // Post-restart upload/download round-trip and /setup lockout.
      await assertFileRoundTrip(req, token, 'setup-003', apiBaseURL);
      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    }
  );
});

test('E2E-WEBDAV-SETUP-003 (Case 4): Complete-state gate locks the wizard and file APIs stay live', async ({
  page,
  request,
}, testInfo) => {
  const projectName = testInfo.project.name;
  const webdavUrl = buildWebdavUrl('case-4-security-webdav', projectName);
  const config: CaseConfig = {
    caseId: 'case-4-security-webdav',
    adminPassword: 'SetupE2e!123',
    jwtSecret: 'e2e-setup-jwt-secret-case4',
    metadata: { backend: 'sqlite' },
    file: {
      backend: 'webdav',
      url: webdavUrl,
      username: WEBDAV_USERNAME,
      password: WEBDAV_PASSWORD,
    },
  };

  await runSetupScenario(
    config,
    page,
    request,
    projectName,
    async ({ request: req, config: cfg, apiBaseURL }) => {
      // apply/test are 403 once setup is complete.
      const applyRes = await req.post(`${apiBaseURL}/api/setup/apply`, { data: {} });
      expect(applyRes.status()).toBe(403);
      const applyBody = await applyRes.json();
      expect(applyBody.errorCode).toBe('serverErrors.setup.complete');

      const testRes = await req.post(`${apiBaseURL}/api/setup/test`, {
        data: {
          target: 'webdav',
          url: webdavUrl,
          username: WEBDAV_USERNAME,
          password: WEBDAV_PASSWORD,
        },
      });
      expect(testRes.status()).toBe(403);

      // /setup redirects to /login.
      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);

      // File APIs still work after the lockout.
      const token = await loginToken(apiBaseURL, req, 'admin', cfg.adminPassword);
      await assertFileRoundTrip(req, token, 'setup-004', apiBaseURL);
    }
  );
});
