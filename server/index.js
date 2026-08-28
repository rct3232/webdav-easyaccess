/* eslint-disable no-console -- server startup/diagnostic logging */
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const { resolveEnvPath } = require('./infrastructure/envPath');
const { computeSetupStatus } = require('./infrastructure/setupStatus');
const {
  createConfigResolver,
  setSharedResolver,
  getSharedResolver,
  populateT1Env,
} = require('./infrastructure/configResolver');
const Settings = require('./models/Settings');
const envPath = resolveEnvPath(__dirname);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
} else {
  console.warn(`Warning: env file not found at ${envPath}. Using default environment variables.`);
  dotenv.config();
}

const app = express();

// CORS hardening:
// - In production, set CORS_ORIGINS (comma-separated) to restrict browser access.
// - If unset, we keep backward-compatible "allow all" behavior (but warn in production).
// The origin list is T2 (hot): resolved lazily per request from the shared
// config resolver (env → DB → default), so operator changes apply immediately.
function parseOriginList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveAllowedOrigins(resolver) {
  return resolver.getConfig('CORS_ORIGINS').then((value) => {
    const list = parseOriginList(value);
    if (list.length > 0) return list;
    return resolver.getConfig('CORS_ORIGIN').then(parseOriginList);
  });
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no Origin header) like curl/server-to-server.
      if (!origin) return callback(null, true);
      resolveAllowedOrigins(getSharedResolver())
        .then((list) => {
          if (list.length === 0) return callback(null, true);
          return callback(null, list.includes(origin));
        })
        .catch(() => callback(null, false));
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Share-Token'],
    exposedHeaders: ['Content-Disposition', 'X-WEA-Skipped-Count', 'X-WEA-Skipped', 'X-New-Token'],
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const { getDataDir } = require('./utils/paths');
const dataDir = getDataDir();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const clientBuildPath = path.join(__dirname, '../client/build');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
}

const requestLogger = require('./middleware/requestLogger');
app.use('/api', requestLogger());

const setupModeGuard = require('./middleware/setupModeGuard');
const setupModeGuardInstance = setupModeGuard();

// Thumbnails are non-JSON responses; mount before forcing JSON Content-Type.
app.use('/api/thumbnails', require('./domains/thumbnails/routes'));
app.use('/api/thumbnails', require('./domains/thumbnails/routes/thumbnailRoutes'));

app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

app.use('/api/setup', require('./domains/setup/routes'));
app.use('/api/auth', require('./domains/auth/routes'));
app.use('/api/users', require('./domains/admin/routes/users'));
app.use('/api/admin', setupModeGuardInstance, require('./domains/admin/routes/userManagement'));
app.use('/api/admin', setupModeGuardInstance, require('./domains/admin/routes/settings'));
app.use('/api/admin', setupModeGuardInstance, require('./domains/admin/routes/maintenance'));
app.use('/api/admin', setupModeGuardInstance, require('./domains/admin/routes/migration'));
app.use('/api/admin', setupModeGuardInstance, require('./domains/admin/routes/config'));
// Public settings (GET /api/settings/public) stays open in setup mode; the
// admin-write settings routes under /api/settings are gated like /api/admin.
app.use('/api/settings', (req, res, next) => {
  if (req.path === '/public') return next();
  return setupModeGuardInstance(req, res, next);
}, require('./domains/admin/routes/settings'));
// Files domain routes (Phase 6 split) — blocked while setup is incomplete
app.use('/api/files', setupModeGuardInstance, require('./domains/files/routes/crud'));
app.use('/api/files', setupModeGuardInstance, require('./domains/files/routes/batch'));
app.use('/api/files', setupModeGuardInstance, require('./domains/files/routes/preview'));
app.use('/api/folders', setupModeGuardInstance, require('./domains/files/routes/folders'));
app.use('/api/permissions', setupModeGuardInstance, require('./domains/permissions/routes'));
app.use('/api/permission-requests', setupModeGuardInstance, require('./domains/permissions/routes/permissionRequests'));
app.use('/api/share-links', setupModeGuardInstance, require('./domains/sharing/routes/shareLinks'));
app.use('/api/share', setupModeGuardInstance, require('./domains/sharing/routes/sharePublic'));
app.use('/api/recent-files', setupModeGuardInstance, require('./domains/recentFiles/routes'));

app.use('/api', require('./infrastructure/healthRoutes'));

// Debug endpoint — development only
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/debug-log', (req, res) => {
    const entry = JSON.stringify(req.body);
    const logPath = path.join(__dirname, '../.cursor/debug-c5ae3e.log');
    fs.appendFileSync(logPath, entry + '\n');
    res.json({ ok: true });
  });
}


app.use('/api/webdav', require('./infrastructure/webdavRoutes'));

// Error handler middleware (must be after all routes)
const { errorHandler } = require('./utils/errorHandler');
app.use(errorHandler);

if (fs.existsSync(clientBuildPath)) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.errorHandler.defaultMessage });
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Initialize database + config resolver.
// Boot order (docs/spec/server/infrastructure/bootSequence.md):
//   1. connect the metadata DB and apply schema/migrations (no admin yet)
//   2. create one resolver, prime it with loadAll(), install it as the shared
//      resolver so T2 consumers and the admin config route share one cache
//   3. compute the effective config and derive setup_complete from it
//   4. when complete: populate process.env with T1 values from the resolver
//      (decrypted DB secrets) so existing require-time consts see them; then
//      seed the default admin (ADMIN_DEFAULT_PASSWORD may be DB-sourced now)
//   5. when incomplete: setup mode — no env population, wizard serves
const { initMetadataSchema, ensureDefaultAdmin } = require('./store/bootstrap');

async function runBoot() {
  await initMetadataSchema();
  console.log('Metadata store initialized');

  const resolver = createConfigResolver({ settingsStore: Settings });
  await resolver.loadAll();
  setSharedResolver(resolver);

  const effective = await resolver.getEffectiveConfig();
  const bootStatus = computeSetupStatus(process.env, { effectiveConfig: effective });

  if (bootStatus.setup_complete) {
    populateT1Env(resolver, process.env);
  }

  // Production allow-all warning, using the effective CORS value at boot.
  if (process.env.NODE_ENV === 'production') {
    const corsList = parseOriginList(
      resolver.getConfigSync('CORS_ORIGINS') || resolver.getConfigSync('CORS_ORIGIN')
    );
    if (corsList.length === 0) {
      console.warn('Warning: CORS_ORIGINS is not set. Allowing all origins in production.');
    }
  }

  await ensureDefaultAdmin();

  // Initialize FFmpeg once on startup to avoid repeated lookups/errors per request.
  try {
    const { initFfmpegOnce } = require('./domains/thumbnails/services/videoProcessor');
    const status = await initFfmpegOnce();
    if (status.available) {
      const source = status.source ? ` (${status.source})` : '';
      const pathInfo = status.path ? ` - ${status.path}` : '';
      console.log(`✓ FFmpeg: available${source}${pathInfo}`);
    } else {
      console.warn('⚠ FFmpeg: not available. Video thumbnails are disabled.');
      console.warn('  Install ffmpeg and ensure it is in PATH, or set FFMPEG_PATH in .env');
    }
  } catch (e) {
    console.warn('⚠ FFmpeg initialization failed. Video thumbnails are disabled.');
  }
  
  // Test WebDAV connection on startup
  try {
    const { testConnection } = require('./utils/webdav');
    const testResult = await testConnection();
    if (testResult.success) {
      console.log('✓ WebDAV connection test: SUCCESS');
    } else {
      console.warn('⚠ WebDAV connection test: FAILED');
      console.warn(`  ${testResult.message}`);
      console.warn('  Please check your WebDAV credentials in .env file');
    }
  } catch (error) {
    console.warn('⚠ WebDAV connection test failed:', error.message);
  }
  
  if (require.main === module) {
    // PORT is T1 (boot-frozen, env → DB → default): resolve at listen time so
    // a DB-sourced value takes effect after the env population above.
    const port = resolver.getConfigSync('PORT') || process.env.PORT || 5001;
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
      setImmediate(() => {
        const { ensureHomeOwnerAdminForAllUsers } = require('./domains/admin/services/cleanupService');
        ensureHomeOwnerAdminForAllUsers()
          .then(() => console.log('✓ Permission cleanup (home-owner admin) completed'))
          .catch(err => console.error('Permission cleanup on startup failed:', err));
      });
      setImmediate(() => {
        try {
          const { getComposition } = require('./service/composition');
          const { runStartupFailSafeRecovery, startGcScheduler } = require('./infrastructure/maintenanceScheduler');
          const composition = getComposition();
          runStartupFailSafeRecovery({ failSafeService: composition.failSafeService })
            .then(() => {})
            .catch(err => console.error('Fail-safe recovery on startup failed:', err));
          startGcScheduler({ gcService: composition.gcService });
        } catch (err) {
          const { setup_complete } = computeSetupStatus(process.env);
          if (!setup_complete) {
            console.warn('running in setup mode — file operations disabled');
          } else {
            console.error('Startup composition failed:', err);
          }
        }
      });
    });
  }
}

runBoot().catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});

module.exports = app;

