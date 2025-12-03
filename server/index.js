const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables from root directory
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('Warning: .env file not found. Using default environment variables.');
  dotenv.config(); // Try to load from current directory
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Set default charset to UTF-8 for all responses
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Create necessary directories - use centralized path utility
const { getDataDir, getThumbnailDir } = require('./utils/paths');
const dataDir = getDataDir();
const thumbnailDir = getThumbnailDir();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(thumbnailDir)) fs.mkdirSync(thumbnailDir, { recursive: true });
console.log(`[Server] Data directory: ${dataDir}`);
console.log(`[Server] Thumbnail directory: ${thumbnailDir}`);

// Serve thumbnails
app.use('/api/thumbnails', express.static(thumbnailDir));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/files', require('./routes/files'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/permissions', require('./routes/permissions'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WebDAV EasyAccess API is running' });
});

// WebDAV connection test endpoint
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

