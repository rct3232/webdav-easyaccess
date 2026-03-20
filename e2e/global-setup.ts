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
  fs.rmSync(path.join(rootDir, relativePath), { recursive: true, force: true });
}

function waitForWebdav(timeoutMs: number) {
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
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
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          if (statusCode === 207) {
            resolve();
            return;
          }

          retry(new Error(`Unexpected WebDAV PROPFIND status: ${response.statusCode}`));
        }
      );

      request.on('timeout', () => {
        request.destroy(new Error('Timed out waiting for WebDAV server'));
      });

      request.on('error', retry);
      request.end();
    };

    const retry = (error: Error) => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(error);
        return;
      }
      setTimeout(attempt, 1000);
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

  runCompose(['up', '-d']);
  await waitForWebdav(60_000);
}
