import { expect, test } from '@playwright/test';

import { loginWithCredentials } from './helpers/auth';
import { scratchS3Bucket } from './helpers/setupScratch';
import {
  S3_ACCESS_KEY,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_KEY,
  assertFileRoundTrip,
  loginToken,
  runSetupScenario,
  type CaseConfig,
} from './setup-wizard.helpers';

/**
 * First-run setup wizard on the default S3 backend (E2E-S3-SETUP-001).
 *
 * Hermetic by design: the case spawns its own scratch server on the platform
 * port (desktop :5003 / mobile :5004), with a project-scoped scratch directory
 * and S3 bucket. Boot 1 must fail setup completeness (no storage config in env)
 * so the wizard is reachable; apply writes WEA_FILE_STORAGE=s3 plus the S3_*
 * keys into the metadata DB, then the restart boots fully configured.
 *
 * Serial: the file binds one scratch port per project platform.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test('E2E-S3-SETUP-001 (Case 2): Sqlite + S3 writes S3_* keys', async ({
  page,
  request,
}, testInfo) => {
  const projectName = testInfo.project.name;
  const config: CaseConfig = {
    caseId: 'case-2-sqlite-s3',
    adminPassword: 'SetupE2e!123',
    jwtSecret: 'e2e-setup-jwt-secret-case2',
    metadata: { backend: 'sqlite' },
    file: {
      backend: 's3',
      bucket: scratchS3Bucket(projectName),
      region: S3_REGION,
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
    },
  };

  await runSetupScenario(
    config,
    page,
    request,
    projectName,
    async ({ request: req, config: cfg, apiBaseURL }) => {
      const token = await loginToken(apiBaseURL, req, 'admin', cfg.adminPassword);
      await assertFileRoundTrip(req, token, 'setup-001', apiBaseURL);

      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();

      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    }
  );
});
