'use strict';

/**
 * Boot-sequence coverage for docs/spec/server/infrastructure/bootSequence.md
 * §5 rows L93 (partial WEA_DB_* → terminal boot failure), L94 (full config in
 * DB boots; DB-sourced T1 values take effect), L98 (PORT from DB at listen;
 * CORS origin list resolved per request) and L99 (active-file-backend boot
 * probe outcome survives the reset-first health-tracker reset).
 *
 * Every scenario drives the REAL boot by spawning `node server/index.js` as a
 * child process against a disposable SQLite DB seeded from this test process
 * (the full-boot harness idea of domains/admin/routes/__tests__/migration.
 * test.js, taken end-to-end so listen/CORS/health are observed over real HTTP).
 *
 * Hermeticity:
 * - Children get an explicit minimal env (never the jest worker env, hence no
 *   JEST_WORKER_ID setup-guard bypass, no blanked-credential confusion, no
 *   PORT), a scratch cwd and a DOTENV_CONFIG_PATH pointing at a non-existent
 *   file, so no local .env can leak into a boot.
 * - SQLite files live in /tmp (createTestDatabase default), ports are
 *   OS-allocated free ports, children are SIGTERM-killed in afterAll.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const { createTestDatabase } = require('../test-utils');
const Settings = require('../models/Settings');

const SERVER_DIR = path.resolve(__dirname, '..');
const INDEX_JS = path.join(SERVER_DIR, 'index.js');

// Child boots always select SQLite (no WEA_DB_* identity in the child env).
// The parent harness (createTestDatabase) must stay on the sqlite leg too, so
// the whole file skips when the real-PG adapters leg env is present.
const PG_LEG = [
  'WEA_TEST_PG_HOST',
  'WEA_TEST_PG_PORT',
  'WEA_TEST_PG_USER',
  'WEA_TEST_PG_PASSWORD',
  'WEA_TEST_PG_DATABASE',
].some((key) => !!process.env[key]);
const describeBoot = PG_LEG ? describe.skip : describe;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function httpJson(port, { method = 'GET', urlPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: { ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Build a minimal, deterministic child env: no inherited jest markers, no
 * PORT (a DB-sourced PORT must be the only source), sqlite pointed at a
 * disposable file, schedulers skipped for a quiet short-lived boot.
 */
function childEnv(overrides = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), `wea-boot-absent-env-${crypto.randomUUID()}`),
    WEA_SKIP_GC_SCHEDULER: '1',
    WEA_SKIP_ROLLUP_SCHEDULER: '1',
    WEA_SKIP_EVOLUTION_SCHEDULER: '1',
    WEA_SKIP_EMBED_MODEL: '1',
    ...overrides,
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key];
  }
  return env;
}

function spawnServer({ cwd, env }) {
  const child = spawn(process.execPath, [INDEX_JS], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => {
    log.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log.stderr += chunk;
  });
  const exit = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });
  return { child, log, exit };
}

/** Poll GET /api/health until the child answers 200 (or the child dies). */
async function waitForListening(handle, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      throw new Error(
        `server child exited early (code=${handle.child.exitCode} signal=${
          handle.child.signalCode
        }); stderr:\n${handle.log.stderr.slice(-4000)}`
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `server did not start listening on :${port} within ${timeoutMs}ms; last error: ${
          lastError && lastError.message
        }; stderr:\n${handle.log.stderr.slice(-4000)}`
      );
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await httpJson(port, { urlPath: '/api/health' });
      if (res.status === 200) return res.json;
    } catch (error) {
      lastError = error;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function stopServer(handle) {
  if (!handle) return;
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.kill('SIGTERM');
    const killer = setTimeout(() => {
      if (handle.child.exitCode === null && handle.child.signalCode === null) {
        handle.child.kill('SIGKILL');
      }
    }, 10000);
    killer.unref();
    await handle.exit;
    clearTimeout(killer);
  } else {
    await handle.exit;
  }
}

async function seedSettings(rows) {
  for (const [key, value] of Object.entries(rows)) {
    // eslint-disable-next-line no-await-in-loop
    await Settings.set(key, value);
  }
}

describeBoot('bootSequence (real child-process boots)', () => {
  describe('partial WEA_DB_* credential set → terminal boot failure (spec §5 L93)', () => {
    it('boot entry pre-flight logs "Initialization failed:" with the partial WEA_DB_* error and exits 1', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wea-boot-cwd-'));
      try {
        const handle = spawnServer({
          cwd,
          env: childEnv({
            // Partial remote intent: two identity keys set, two blanked.
            WEA_SQLITE_PATH: path.join(cwd, 'never-opened.db'),
            WEA_DB_HOST: '127.0.0.1',
            WEA_DB_DATABASE: 'wea-partial-db',
            WEA_DB_USER: '',
            WEA_DB_PASSWORD: '',
          }),
        });
        const info = await handle.exit;

        expect(info.code).toBe(1);
        expect(handle.log.stderr).toMatch(/Initialization failed:/);
        expect(handle.log.stderr).toMatch(/Partial WEA_DB_\* configuration/);
        expect(handle.log.stderr).toMatch(/missing .*WEA_DB_USER/);
        expect(handle.log.stderr).toMatch(/WEA_DB_PASSWORD/);
        expect(handle.log.stdout).not.toMatch(/Server is running/);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    }, 60000);
  });

  describe('full config in DB with unreachable active webdav backend (spec §5 L94/L98/L99)', () => {
    let db;
    let handle;
    let cwd;
    let listenPort;
    let adminPassword;
    let adminToken;

    beforeAll(async () => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wea-boot-cwd-'));
      db = await createTestDatabase();
      listenPort = await findFreePort();
      const deadWebdavPort = await findFreePort(); // never bound → ECONNREFUSED probe
      adminPassword = `Boot-Admin-${crypto.randomUUID()}`;

      await seedSettings({
        WEA_FILE_STORAGE: 'webdav',
        WEBDAV_URL: `http://127.0.0.1:${deadWebdavPort}/`,
        WEBDAV_USERNAME: 'wd-user',
        WEBDAV_PASSWORD: 'wd-pass',
        PORT: String(listenPort),
        CORS_ORIGINS: 'http://alpha.test, http://beta.test',
        ADMIN_DEFAULT_PASSWORD: adminPassword,
      });

      handle = spawnServer({ cwd, env: childEnv({ WEA_SQLITE_PATH: db.dir }) });
      await waitForListening(handle, listenPort, 60000);
    }, 120000);

    afterAll(async () => {
      await stopServer(handle);
      await db?.cleanup();
      if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
    }, 30000);

    it('listens on the DB-sourced PORT although the environment carries no PORT (L98)', async () => {
      expect(handle.log.stdout).toMatch(new RegExp(`Server is running on port ${listenPort}`));
      // The model-free seam keeps the configured boot from touching weights or ONNX.
      expect(handle.log.stdout).toContain('Built-in embed model disabled');
      expect(handle.log.stdout).not.toContain('Embed model weights present');
      const res = await httpJson(listenPort, { urlPath: '/api/health' });
      expect(res.status).toBe(200);
      // T1 population evidence: the DB-sourced file-storage value reached
      // process.env before require-time consumers read it.
      expect(res.json.activeFileStorage).toBe('webdav');
      expect(res.json.activeMetadataBackend).toBe('sqlite');
    }, 30000);

    it('default admin is created from the DB-sourced ADMIN_DEFAULT_PASSWORD, not the built-in default (L94)', async () => {
      const ok = await httpJson(listenPort, {
        method: 'POST',
        urlPath: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { username: 'admin', password: adminPassword },
      });
      expect(ok.status).toBe(200);
      expect(ok.json.token).toEqual(expect.any(String));
      adminToken = ok.json.token;

      const fallback = await httpJson(listenPort, {
        method: 'POST',
        urlPath: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { username: 'admin', password: 'admin' },
      });
      expect(fallback.status).toBe(401);
    }, 30000);

    it('Access-Control-Allow-Origin resolves from the DB origin list per request (L98)', async () => {
      const allowed = await httpJson(listenPort, {
        urlPath: '/api/health',
        headers: { Origin: 'http://alpha.test' },
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('http://alpha.test');

      const second = await httpJson(listenPort, {
        urlPath: '/api/health',
        headers: { Origin: 'http://beta.test' },
      });
      expect(second.headers['access-control-allow-origin']).toBe('http://beta.test');

      const denied = await httpJson(listenPort, {
        urlPath: '/api/health',
        headers: { Origin: 'http://evil.test' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    }, 30000);

    it('a CORS_ORIGINS edit takes effect on the next request (T2 hot, no stale cached list) (L98)', async () => {
      const put = await httpJson(listenPort, {
        method: 'PUT',
        urlPath: '/api/admin/config',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: { values: { CORS_ORIGINS: 'http://gamma.test' } },
      });
      expect(put.status).toBe(200);
      expect(put.json.applied).toContain('CORS_ORIGINS');

      const nowAllowed = await httpJson(listenPort, {
        urlPath: '/api/health',
        headers: { Origin: 'http://gamma.test' },
      });
      expect(nowAllowed.headers['access-control-allow-origin']).toBe('http://gamma.test');

      const nowDenied = await httpJson(listenPort, {
        urlPath: '/api/health',
        headers: { Origin: 'http://alpha.test' },
      });
      expect(nowDenied.headers['access-control-allow-origin']).toBeUndefined();
    }, 30000);

    it('the failing webdav boot probe is still recorded AFTER boot (reset runs first, L99)', async () => {
      // Boot settles before listen, so the tracker state is final here.
      // Warn-only probe failure — exact wording varies with the throw/return
      // branch of testConnection; the tracker state below is the contract.
      expect(handle.log.stderr).toMatch(/WebDAV connection test/i);
      const res = await httpJson(listenPort, { urlPath: '/api/health' });
      expect(res.json.backends.webdav).toBe('fail');
      // A post-probe reset would have washed the failure back to 'unknown'.
      expect(res.json.backends.webdav).not.toBe('unknown');
    }, 30000);
  });

  describe('failing probe survives reset-first; success case reports ok (spec §5 L99)', () => {
    let db;
    let handle;
    let cwd;
    let listenPort;
    let mockWebdav;
    const probeRequests = [];

    beforeAll(async () => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wea-boot-cwd-'));
      db = await createTestDatabase();
      listenPort = await findFreePort();

      const multistatus = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
      mockWebdav = http.createServer((req, res) => {
        probeRequests.push({ method: req.method, authorization: req.headers.authorization });
        req.resume();
        req.on('end', () => {
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(multistatus);
        });
      });
      await new Promise((resolve) => mockWebdav.listen(0, '127.0.0.1', resolve));
      const webdavPort = mockWebdav.address().port;

      await seedSettings({
        WEA_FILE_STORAGE: 'webdav',
        WEBDAV_URL: `http://127.0.0.1:${webdavPort}/`,
        WEBDAV_USERNAME: 'wd-user',
        WEBDAV_PASSWORD: 'wd-pass',
        PORT: String(listenPort),
      });

      handle = spawnServer({ cwd, env: childEnv({ WEA_SQLITE_PATH: db.dir }) });
      await waitForListening(handle, listenPort, 60000);
    }, 120000);

    afterAll(async () => {
      await stopServer(handle);
      await new Promise((resolve) => {
        if (mockWebdav) mockWebdav.close(resolve);
        else resolve();
      });
      await db?.cleanup();
      if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
    }, 30000);

    it('a successful active-backend boot probe reports ok through GET /api/health (L99 success leg)', async () => {
      // The probe reached the mock via the DB-sourced, env-populated WEBDAV_*
      // T1 values (L94 evidence at the network level).
      expect(probeRequests.some((r) => r.method === 'PROPFIND')).toBe(true);
      expect(
        probeRequests.some(
          (r) => r.authorization === `Basic ${Buffer.from('wd-user:wd-pass').toString('base64')}`
        )
      ).toBe(true);

      const res = await httpJson(listenPort, { urlPath: '/api/health' });
      expect(res.json.backends.webdav).toBe('ok');
    }, 30000);
  });
});
