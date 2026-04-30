import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const composeFile = path.join(rootDir, 'docker-compose.e2e.yml');

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

export default async function globalTeardown() {
  try {
    runCompose(['down', '-v', '--remove-orphans']);
  } catch (error) {
    console.error('Failed to stop E2E Docker services:', error);
  }

  cleanDir('e2e-data');
  cleanDir('data/e2e-metadata');
}
