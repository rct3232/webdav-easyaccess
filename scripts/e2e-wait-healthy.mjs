#!/usr/bin/env node
/**
 * E2E Docker Compose provisioning helper.
 *
 * Brings the `docker-compose.e2e.yml` stack up (idempotent `up -d`) and waits
 * until every container required for the active E2E backend mode reports
 * `healthy`:
 *
 *   - webdav-e2e-test   (service: webdav-test)    — always required
 *   - webdav-pg-e2e     (service: postgresql-e2e) — always required
 *   - webdav-minio-e2e  (service: minio-e2e)      — required only in s3 mode
 *
 * Mode comes from `E2E_BACKEND_MODE` (defaults to `s3`).
 *
 * The Playwright `webServer` command for the API server chains this script
 * BEFORE starting the app (`npm run e2e:server:s3` / `e2e:server:webdav`), so
 * PostgreSQL/MinIO/WebDAV are reachable by the time the server boots. Because
 * this step runs in the foreground, the webServer command stays long-running
 * (the actual `npm run dev --workspace server` is the last step) and Playwright
 * can still poll `http://localhost:5002/api/health`.
 *
 * `e2e/global-setup.ts` re-invokes this script idempotently as belt-and-braces
 * (it never tears the stack down). Exit code is non-zero with a status dump
 * when the timeout elapses.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = process.cwd();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = path.join(scriptDir, '..', 'docker-compose.e2e.yml');
const TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

const backendMode = process.env.E2E_BACKEND_MODE || 's3';
if (backendMode !== 's3' && backendMode !== 'webdav') {
  console.error(
    `[e2e-wait-healthy] Invalid E2E_BACKEND_MODE "${backendMode}". Expected "s3" or "webdav".`
  );
  process.exit(1);
}

// Container names from `container_name:` in docker-compose.e2e.yml. The stack
// always starts MinIO, but webdav runs do not depend on it being healthy.
const ALWAYS_REQUIRED = ['webdav-e2e-test', 'webdav-pg-e2e'];
const S3_REQUIRED = ['webdav-minio-e2e'];
const requiredContainers =
  backendMode === 's3' ? [...ALWAYS_REQUIRED, ...S3_REQUIRED] : [...ALWAYS_REQUIRED];

function resolveComposeCommand() {
  const candidates = [
    { command: 'docker', args: ['compose'] },
    { command: 'docker-compose', args: [] },
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, 'version'], { stdio: 'ignore' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('[e2e-wait-healthy] Docker Compose is required for E2E tests.');
}

const compose = resolveComposeCommand();

function runUp() {
  console.log('[e2e-wait-healthy] Bringing the E2E Docker stack up (idempotent)...');
  const result = spawnSync(compose.command, [...compose.args, '-f', COMPOSE_FILE, 'up', '-d'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('[e2e-wait-healthy] `docker compose up -d` failed.');
    process.exit(result.status || 1);
  }
}

function getContainerList() {
  const result = spawnSync(
    compose.command,
    [...compose.args, '-f', COMPOSE_FILE, 'ps', '--format', 'json'],
    { cwd: ROOT_DIR, encoding: 'utf8' }
  );
  if (result.status !== 0) return [];
  const text = (result.stdout || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Some compose versions emit one JSON object per line instead of an array.
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
}

function healthOf(container) {
  const direct = String(container.Health ?? container.health ?? '')
    .trim()
    .toLowerCase();
  if (direct) return direct;
  const status = String(container.Status ?? container.status ?? '').toLowerCase();
  if (status.includes('healthy')) return 'healthy';
  if (status.includes('unhealthy')) return 'unhealthy';
  return status.split(' ')[0] || '';
}

function statusesByName() {
  const byName = new Map();
  for (const container of getContainerList()) {
    const name = String(container.Name ?? container.name ?? '').trim();
    if (name) {
      byName.set(name, {
        state: String(container.State ?? container.state ?? '').trim(),
        health: healthOf(container),
      });
    }
  }
  return byName;
}

function waitForHealthy() {
  const startedAt = Date.now();
  for (;;) {
    const byName = statusesByName();
    const summary = requiredContainers.map((name) => {
      const entry = byName.get(name);
      return `${name}=${entry ? `${entry.state}/${entry.health}` : 'missing'}`;
    });
    const allHealthy = requiredContainers.every(
      (name) => byName.has(name) && byName.get(name).health === 'healthy'
    );

    if (allHealthy) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[e2e-wait-healthy] E2E containers healthy (${backendMode} mode, ${elapsed}s): ${summary.join(' | ')}`
      );
      return;
    }

    if (Date.now() - startedAt >= TIMEOUT_MS) {
      console.error(
        `[e2e-wait-healthy] Timed out after ${TIMEOUT_MS / 1000}s waiting for E2E containers to be healthy.\n` +
          `  Mode: ${backendMode} | Required: ${requiredContainers.join(', ')}\n` +
          `  Current: ${summary.join(' | ')}`
      );
      process.exit(1);
    }

    // Synchronous sleep keeps the polling loop simple (no async plumbing needed
    // for a short-lived helper).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_INTERVAL_MS);
  }
}

runUp();
console.log(
  `[e2e-wait-healthy] Waiting for healthy containers: ${requiredContainers.join(', ')} (timeout ${TIMEOUT_MS / 1000}s)...`
);
waitForHealthy();
