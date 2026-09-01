import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const rootDir = process.cwd();
const composeFile = path.join(rootDir, 'docker-compose.e2e.yml');
const backendMode = process.env.E2E_BACKEND_MODE || 's3';

const require = createRequire(path.join(rootDir, 'e2e', 'global-teardown.ts'));

const E2E_S3_ENDPOINT = 'http://127.0.0.1:9010';
const E2E_S3_REGION = process.env.AWS_REGION || 'us-east-1';
const E2E_S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
const E2E_S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';
const E2E_S3_BUCKET = process.env.S3_BUCKET || 'e2e-test-bucket';

function resolveComposeCommand() {
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: 'docker', args: ['compose'] },
    { command: 'docker-compose', args: [] },
  ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, 'version'], { stdio: 'ignore' });
    if (probe.status === 0) {
      return candidate;
    }
  }

  throw new Error('Docker Compose is required for E2E tests.');
}

function runCompose(args: string[]) {
  const compose = resolveComposeCommand();
  execFileSync(compose.command, [...compose.args, '-f', composeFile, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

function cleanDir(relativePath: string) {
  const targetPath = path.join(rootDir, relativePath);
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'EACCES') {
      throw err;
    }

    console.warn(
      `Warning: Cannot remove ${relativePath} directly due to permissions. Retrying via Docker helper.`
    );
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${rootDir}:/workspace`,
        'alpine',
        'sh',
        '-c',
        `rm -rf /workspace/${relativePath}`,
      ],
      {
        cwd: rootDir,
        stdio: 'inherit',
      }
    );
  }
}

export default async function globalTeardown() {
  // Empty the S3 bucket for cleanliness before tearing containers down
  // (globalTeardown runs before Playwright stops webServer, and before the
  // `down -v` below, so MinIO is still reachable here). Best-effort only.
  if (backendMode === 's3') {
    try {
      const { emptyBucket } = require(path.join(rootDir, 'server/testing/minioTestUtils.js'));
      const deleted = await emptyBucket({
        endpoint: E2E_S3_ENDPOINT,
        region: E2E_S3_REGION,
        bucket: E2E_S3_BUCKET,
        credentials: {
          accessKeyId: E2E_S3_ACCESS_KEY,
          secretAccessKey: E2E_S3_SECRET_KEY,
        },
      });
      console.log(`S3 bucket emptied: ${deleted} object(s) removed from ${E2E_S3_BUCKET}`);
    } catch (error) {
      console.warn('Failed to empty S3 bucket during teardown:', (error as Error).message);
    }
  }

  try {
    runCompose(['down', '-v', '--remove-orphans']);
  } catch (error) {
    console.error('Failed to stop E2E Docker services:', error);
  }

  cleanDir('e2e-data');
  cleanDir('data/e2e-metadata');
}
