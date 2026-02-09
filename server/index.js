const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('Warning: .env file not found. Using default environment variables.');
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
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition', 'X-WEA-Skipped-Count', 'X-WEA-Skipped', 'X-New-Token'],
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const { getDataDir } = require('./utils/paths');
const dataDir = getDataDir();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.get('/api/thumbnails/:hash.:ext', (req, res) => {
  const { hash, ext } = req.params;
  const { thumbnailCache, getThumbnailHash } = require('./utils/thumbnail');
  
  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundThumbnail = thumbnail;
      break;
    }
  }
  
  if (foundThumbnail && foundThumbnail.extension === ext) {
    res.setHeader('Content-Type', foundThumbnail.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(foundThumbnail.buffer);
  } else {
    res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Thumbnail not found' });
  }
});

const clientBuildPath = path.join(__dirname, '../client/build');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
}

const requestLogger = require('./middleware/requestLogger');
app.use('/api', requestLogger());

// Thumbnails are non-JSON responses; mount before forcing JSON Content-Type.
app.use('/api/thumbnails', require('./routes/thumbnails'));

app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/files', require('./routes/files'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/permission-requests', require('./routes/permissionRequests'));
app.use('/api/share-links', require('./routes/shareLinks'));
app.use('/api/share', require('./routes/sharePublic'));
app.use('/api/recent-files', require('./routes/recentFiles'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WebDAV EasyAccess API is running' });
});

// Error handler middleware (must be after all routes)
const { errorHandler } = require('./utils/errorHandler');
app.use(errorHandler);

app.get('/api/webdav/test', async (req, res) => {
  try {
    const { testConnection } = require('./utils/webdav');
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: `WebDAV test failed: ${error.message}` 
    });
  }
});

app.get('/api/webdav/info', (req, res) => {
  try {
    const webdavUrl = process.env.WEBDAV_URL || '';
    let displayUrl = webdavUrl;
    try {
      const url = new URL(webdavUrl);
      displayUrl = url.hostname + (url.port ? `:${url.port}` : '') + url.pathname;
      if (displayUrl.endsWith('/')) {
        displayUrl = displayUrl.slice(0, -1);
      }
    } catch (e) {
      displayUrl = webdavUrl;
    }
    res.json({ url: displayUrl });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get WebDAV info' });
  }
});

if (fs.existsSync(clientBuildPath)) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'API endpoint not found' });
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
    const { initFfmpegOnce } = require('./utils/thumbnail');
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
    });
  }
}).catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});

module.exports = app;

