const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const envPath = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(__dirname, process.env.DOTENV_CONFIG_PATH)
  : path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
} else {
  console.warn(`Warning: env file not found at ${envPath}. Using default environment variables.`);
  dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 5001;

// CORS hardening:
// - In production, set CORS_ORIGINS (comma-separated) to restrict browser access.
// - If unset, we keep backward-compatible "allow all" behavior (but warn in production).
const corsOriginsEnv = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
const corsOrigins = corsOriginsEnv
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  console.warn('Warning: CORS_ORIGINS is not set. Allowing all origins in production.');
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no Origin header) like curl/server-to-server.
      if (!origin) return callback(null, true);
      if (corsOrigins.length === 0) return callback(null, true);
      return callback(null, corsOrigins.includes(origin));
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

// Thumbnails are non-JSON responses; mount before forcing JSON Content-Type.
app.use('/api/thumbnails', require('./domains/thumbnails/routes'));
app.use('/api/thumbnails', require('./domains/thumbnails/routes/thumbnailRoutes'));

app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

app.use('/api/auth', require('./domains/auth/routes'));
app.use('/api/users', require('./domains/admin/routes/users'));
app.use('/api/admin', require('./domains/admin/routes/userManagement'));
app.use('/api/admin', require('./domains/admin/routes/settings'));
app.use('/api/admin', require('./domains/admin/routes/maintenance'));
app.use('/api/settings', require('./domains/admin/routes/settings'));
// Files domain routes (Phase 6 split)
app.use('/api/files', require('./domains/files/routes/crud'));
app.use('/api/files', require('./domains/files/routes/batch'));
app.use('/api/files', require('./domains/files/routes/preview'));
app.use('/api/folders', require('./domains/files/routes/folders'));
app.use('/api/permissions', require('./domains/permissions/routes'));
app.use('/api/permission-requests', require('./domains/permissions/routes/permissionRequests'));
app.use('/api/share-links', require('./domains/sharing/routes/shareLinks'));
app.use('/api/share', require('./domains/sharing/routes/sharePublic'));
app.use('/api/recent-files', require('./domains/recentFiles/routes'));

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

// Initialize database
const { initMetadataStore } = require('./store/bootstrap');
initMetadataStore().then(async () => {
  console.log('Metadata store initialized');

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
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      setImmediate(() => {
        const { ensureHomeOwnerAdminForAllUsers } = require('./domains/admin/services/cleanupService');
        ensureHomeOwnerAdminForAllUsers()
          .then(() => console.log('✓ Permission cleanup (home-owner admin) completed'))
          .catch(err => console.error('Permission cleanup on startup failed:', err));
      });
      setImmediate(() => {
        const { getComposition } = require('./service/composition');
        const { runStartupFailSafeRecovery, startGcScheduler } = require('./infrastructure/maintenanceScheduler');
        const composition = getComposition();
        runStartupFailSafeRecovery({ failSafeService: composition.failSafeService })
          .then(() => {})
          .catch(err => console.error('Fail-safe recovery on startup failed:', err));
        startGcScheduler({ gcService: composition.gcService });
      });
    });
  }
}).catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});

module.exports = app;

