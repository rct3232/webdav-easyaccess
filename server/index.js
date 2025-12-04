const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('Warning: .env file not found. Using default environment variables.');
  dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
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
    res.status(404).json({ error: 'Thumbnail not found' });
  }
});

const clientBuildPath = path.join(__dirname, '../client/build');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
}

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WebDAV EasyAccess API is running' });
});

app.get('/api/webdav/test', async (req, res) => {
  try {
    const { testConnection } = require('./utils/webdav');
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
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
    res.status(500).json({ error: 'Failed to get WebDAV info' });
  }
});

if (fs.existsSync(clientBuildPath)) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Initialize database
const db = require('./models/database');
db.init().then(async () => {
  console.log('Database initialized');
  
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
  
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

module.exports = app;

