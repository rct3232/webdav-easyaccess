'use strict';

/**
 * E2E client server (L3): serves the PRODUCTION client build (`client/build`)
 * on :3000 and proxies `/api/*` to the E2E API server (:5002), mirroring the
 * react-scripts dev-server behaviour the platform tests previously relied on
 * (`/api` is same-origin in the app; see client/src/services/apiClient.js).
 *
 * - Ensures `client/build` exists first (builds once when missing) so the
 *   platform webServer never depends on the hermetic suites' lazy build.
 * - Serves static assets with SPA history fallback to `index.html`.
 * - Port/API target: `PORT`/`REACT_APP_API_PORT` overrides, defaults 3000/5002.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = process.cwd();
const buildDir = path.join(rootDir, 'client', 'build');
const port = Number(process.env.PORT || 3000);
const apiTarget = `http://127.0.0.1:${process.env.REACT_APP_API_PORT || process.env.API_PORT || 5002}`;

function ensureClientBuild() {
  if (fs.existsSync(path.join(buildDir, 'index.html'))) return;
  console.log('[e2e-serve-client] client/build missing — building client...');
  const result = spawnSync('npm', ['run', 'build', '--workspace', 'client'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !fs.existsSync(path.join(buildDir, 'index.html'))) {
    throw new Error('client build did not produce client/build/index.html');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    urlPath = '/';
  }
  let filePath = path.join(buildDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(buildDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA history fallback.
    filePath = path.join(buildDir, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function proxyApi(req, res) {
  const headers = { ...req.headers, host: new URL(apiTarget).host };
  const proxyReq = http.request(
    apiTarget + req.url,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    console.error(`[e2e-serve-client] proxy error ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(proxyReq);
}

ensureClientBuild();

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[e2e-serve-client] serving ${buildDir} on :${port}, /api -> ${apiTarget}`);
});
