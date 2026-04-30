import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const composeFile = path.join(rootDir, 'docker-compose.e2e.yml');
const webdavBaseUrl = 'http://127.0.0.1:8090/';
const webdavAuth = Buffer.from('e2etest:e2etest123').toString('base64');

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

    console.warn(`Warning: Cannot remove ${relativePath} directly due to permissions. Retrying via Docker helper.`);
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

function waitForWebdav(timeoutMs: number) {
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    let done = false;

    const finishSuccess = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const finishFailure = (error: Error) => {
      if (done) return;
      done = true;
      reject(error);
    };

    const scheduleRetry = (error: Error) => {
      if (done) return;
      if (Date.now() - startedAt >= timeoutMs) {
        finishFailure(error);
        return;
      }
      setTimeout(attempt, 1000);
    };

    const attempt = () => {
      if (done) return;
      let attemptSettled = false;
      const settleAttempt = (handler: () => void) => {
        if (attemptSettled || done) return;
        attemptSettled = true;
        handler();
      };

      const request = http.request(
        webdavBaseUrl,
        {
          method: 'PROPFIND',
          headers: {
            Authorization: `Basic ${webdavAuth}`,
            Depth: '1',
          },
          timeout: 2000,
        },
        (response) => {
          response.resume();
          const statusCode = response.statusCode || 500;
          settleAttempt(() => {
            if ((statusCode >= 200 && statusCode < 300) || statusCode === 207 || statusCode === 403) {
              finishSuccess();
              return;
            }
            scheduleRetry(new Error(`Unexpected WebDAV PROPFIND status: ${response.statusCode}`));
          });
        }
      );

      request.on('timeout', () => {
        settleAttempt(() => {
          request.destroy();
          scheduleRetry(new Error('Timed out waiting for WebDAV server'));
        });
      });

      request.on('error', (error) => {
        settleAttempt(() => {
          scheduleRetry(error);
        });
      });

      request.end();
    };

    attempt();
  });
}

export default async function globalSetup() {
  cleanDir('test-results');
  cleanDir('playwright-report');
  cleanDir('e2e-data');
  cleanDir('data/e2e-metadata');
  fs.mkdirSync(path.join(rootDir, 'e2e-data'), { recursive: true });

  console.log('Ensuring a fresh WebDAV environment by restarting Docker Compose...');
  runCompose(['down', '-v']);
  runCompose(['up', '-d']);
  await waitForWebdav(60_000);
}
