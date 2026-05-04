const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('./errorHandler');

const THUMBNAIL_TOKEN_SECRET = process.env.THUMBNAIL_TOKEN_SECRET || process.env.JWT_SECRET || 'thumbnail-secret';
const THUMBNAIL_TOKEN_EXPIRY = process.env.THUMBNAIL_TOKEN_EXPIRY || '15m';
const os = require('os');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { getFileContents, isImageFile, isVideoFile } = require('./webdav');

const MAX_SIZE = parseInt(process.env.MAX_THUMBNAIL_SIZE) || 300;
const thumbnailCache = new Map();
const MAX_CACHE_SIZE = 1000;

const FFMPEG_INIT_TIMEOUT_MS = parseInt(process.env.FFMPEG_INIT_TIMEOUT_MS) || 2000;

const ffmpegState = {
  checked: false,
  available: false,
  source: null, // env | projectRoot | win32KnownPath | path
  path: null,
  reason: null,
};

let ffmpegInitPromise = null;

function getFfmpegStatus() {
  return { ...ffmpegState };
}

async function canExecFfmpeg(cmdPath) {
  return await new Promise((resolve) => {
    execFile(cmdPath, ['-version'], { timeout: FFMPEG_INIT_TIMEOUT_MS }, (err) => {
      if (!err) return resolve(true);
      // Treat timeout as "present" to avoid false negatives on slow systems.
      if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') return resolve(true);
      return resolve(false);
    });
  });
}

async function initFfmpegOnce() {
  if (ffmpegState.checked) return getFfmpegStatus();
  if (ffmpegInitPromise) return await ffmpegInitPromise;

  ffmpegInitPromise = (async () => {
    // 1) Explicit FFMPEG_PATH
    if (process.env.FFMPEG_PATH) {
      const resolved = path.resolve(process.env.FFMPEG_PATH);
      try {
        if (fs.existsSync(resolved) && (await canExecFfmpeg(resolved))) {
          ffmpeg.setFfmpegPath(resolved);
          ffmpegState.checked = true;
          ffmpegState.available = true;
          ffmpegState.source = 'env';
          ffmpegState.path = resolved;
          ffmpegState.reason = null;
          return getFfmpegStatus();
        }
      } catch (e) {
        // fall through
      }
    }

    const platform = os.platform();

    // 2) Windows-specific known locations (backward-compatible)
    if (platform === 'win32') {
      const { getProjectRoot } = require('./paths');
      const projectRoot = getProjectRoot();

      const candidates = [
        path.join(projectRoot, 'ffmpeg.exe'),
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      ];

      for (const candidate of candidates) {
        try {
          if (fs.existsSync(candidate) && (await canExecFfmpeg(candidate))) {
            ffmpeg.setFfmpegPath(candidate);
            ffmpegState.checked = true;
            ffmpegState.available = true;
            ffmpegState.source = candidate.includes(projectRoot) ? 'projectRoot' : 'win32KnownPath';
            ffmpegState.path = candidate;
            ffmpegState.reason = null;
            return getFfmpegStatus();
          }
        } catch (e) {
          // try next candidate
        }
      }
    }

    // 3) PATH lookup (mac/linux/windows)
    if (await canExecFfmpeg('ffmpeg')) {
      // fluent-ffmpeg defaults to 'ffmpeg' on PATH; no need to set an explicit path.
      ffmpegState.checked = true;
      ffmpegState.available = true;
      ffmpegState.source = 'path';
      ffmpegState.path = null;
      ffmpegState.reason = null;
      return getFfmpegStatus();
    }

    // Not available
    ffmpegState.checked = true;
    ffmpegState.available = false;
    ffmpegState.source = null;
    ffmpegState.path = null;
    ffmpegState.reason = process.env.FFMPEG_PATH
      ? 'FFMPEG_PATH is set but ffmpeg is not executable'
      : 'ffmpeg not found in PATH';
    return getFfmpegStatus();
  })();

  return await ffmpegInitPromise;
}

function getThumbnailHash(webdavPath) {
  return crypto.createHash('md5').update(webdavPath).digest('hex');
}

function signThumbnailToken(webdavPath) {
  const hash = getThumbnailHash(webdavPath);
  return jwt.sign(
    { h: hash },
    THUMBNAIL_TOKEN_SECRET,
    { expiresIn: THUMBNAIL_TOKEN_EXPIRY }
  );
}

function verifyThumbnailToken(token, hash) {
  if (!token || typeof token !== 'string') return false;
  try {
    const decoded = jwt.verify(token, THUMBNAIL_TOKEN_SECRET);
    return decoded && decoded.h === hash;
  } catch {
    return false;
  }
}

function getCachedThumbnail(webdavPath) {
  return thumbnailCache.get(webdavPath) || null;
}

function setCachedThumbnail(webdavPath, buffer, extension) {
  if (thumbnailCache.size >= MAX_CACHE_SIZE) {
    const firstKey = thumbnailCache.keys().next().value;
    thumbnailCache.delete(firstKey);
  }
  
  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
  thumbnailCache.set(webdavPath, {
    buffer,
    mimeType,
    extension
  });
}

async function generateImageThumbnail(filePath, webdavPath) {
  try {
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      return { buffer: cached.buffer, extension: cached.extension };
    }

    const buffer = await getFileContents(webdavPath);
    if (!buffer || buffer.length === 0) {
      throw createError(SERVER_ERROR_CODES.thumbnail.downloadFailed, 500);
    }
    
    const metadata = await sharp(buffer).metadata();
    const hasAlpha = metadata.hasAlpha === true;
    const outputExtension = hasAlpha ? 'png' : 'jpg';
    
    try {
      const sharpInstance = sharp(buffer)
        .rotate()
        .resize(MAX_SIZE, MAX_SIZE, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      
      let thumbnailBuffer;
      if (hasAlpha) {
        thumbnailBuffer = await sharpInstance
          .png({ quality: 90, compressionLevel: 6 })
          .toBuffer();
      } else {
        thumbnailBuffer = await sharpInstance
          .jpeg({ quality: 80 })
          .toBuffer();
      }
      
      setCachedThumbnail(webdavPath, thumbnailBuffer, outputExtension);
      return { buffer: thumbnailBuffer, extension: outputExtension };
    } catch (sharpError) {
      throw sharpError;
    }
  } catch (error) {
    console.error(`Error generating image thumbnail: ${error.message}`);
    return null;
  }
}

async function generateVideoThumbnail(filePath, webdavPath) {
  let tempVideoPath = null;
  let tempFramePath = null;
  
  try {
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      return { buffer: cached.buffer, extension: cached.extension };
    }

    // Fast-fail if FFmpeg isn't available: avoids downloading the video and repeated errors.
    const status = await initFfmpegOnce();
    if (!status.available) {
      return null;
    }
    
    const buffer = await getFileContents(webdavPath);
    if (!buffer || buffer.length === 0) {
      throw createError(SERVER_ERROR_CODES.thumbnail.videoDownloadFailed, 500);
    }
    
    const { getDataDir } = require('./paths');
    const dataDir = path.resolve(getDataDir());
    const tempDir = path.resolve(path.join(dataDir, 'temp'));
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const videoHash = crypto.createHash('md5').update(webdavPath).digest('hex');
    tempVideoPath = path.resolve(path.join(tempDir, `${videoHash}_temp_video`));
    tempFramePath = path.resolve(path.join(tempDir, `${videoHash}_temp_frame.jpg`));
    
    const ext = path.extname(webdavPath).toLowerCase();
    tempVideoPath += ext || '.mp4';
    
    fs.writeFileSync(tempVideoPath, buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempVideoPath)
        .screenshots({
          timestamps: ['00:00:00.000'],
          filename: path.basename(tempFramePath),
          folder: path.dirname(tempFramePath),
        })
        .on('end', () => resolve())
        .on('error', (err) => {
          reject(createError(SERVER_ERROR_CODES.thumbnail.ffmpegFailed, 500, { reason: err.message }));
        });
    });
    
    if (!fs.existsSync(tempFramePath)) {
      throw createError(SERVER_ERROR_CODES.thumbnail.frameExtractionFailed, 500);
    }
    const frameBuffer = fs.readFileSync(tempFramePath);
    const thumbnailBuffer = await sharp(frameBuffer)
      .resize(MAX_SIZE, MAX_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    
    setCachedThumbnail(webdavPath, thumbnailBuffer, 'jpg');
    return { buffer: thumbnailBuffer, extension: 'jpg' };
  } catch (error) {
    console.error(`Error generating video thumbnail: ${error.message}`);
    return null;
  } finally {
    try {
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
      }
      if (tempFramePath && fs.existsSync(tempFramePath)) {
        fs.unlinkSync(tempFramePath);
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

async function getThumbnail(webdavPath) {
  const filename = path.basename(webdavPath);
  
  if (isImageFile(filename)) {
    const result = await generateImageThumbnail(null, webdavPath);
    return result ? result.buffer : null;
  } else if (isVideoFile(filename)) {
    const result = await generateVideoThumbnail(null, webdavPath);
    return result ? result.buffer : null;
  }
  
  return null;
}

function getThumbnailUrl(webdavPath) {
  const cached = getCachedThumbnail(webdavPath);
  if (cached) {
    const hash = getThumbnailHash(webdavPath);
    const token = signThumbnailToken(webdavPath);
    return `/api/thumbnails/${hash}.${cached.extension}?token=${encodeURIComponent(token)}`;
  }
  return null;
}

function getThumbnailFromCache(webdavPath) {
  return getCachedThumbnail(webdavPath);
}

async function ensureThumbnail(webdavPath) {
  try {
    const filename = path.basename(webdavPath);
    
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      return getThumbnailUrl(webdavPath);
    }
    
    if (isImageFile(filename)) {
      const result = await generateImageThumbnail(null, webdavPath);
      if (result) {
        return getThumbnailUrl(webdavPath);
      }
      return null;
    } else if (isVideoFile(filename)) {
      const status = await initFfmpegOnce();
      if (!status.available) return null;
      const result = await generateVideoThumbnail(null, webdavPath);
      if (result) {
        return getThumbnailUrl(webdavPath);
      }
      return null;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Helper function to limit concurrency
async function limitConcurrency(tasks, concurrency = 10) {
  const results = [];
  const executing = [];
  
  for (const task of tasks) {
    const promise = Promise.resolve().then(() => task());
    results.push(promise);
    
    if (concurrency <= tasks.length) {
      const cleanup = promise.then(() => {
        executing.splice(executing.indexOf(cleanup), 1);
      });
      executing.push(cleanup);
      
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  
  return Promise.all(results);
}

async function ensureThumbnailsBatch(webdavPaths) {
  const CONCURRENCY_LIMIT = parseInt(process.env.THUMBNAIL_CONCURRENCY_LIMIT) || 10;
  const results = [];
  
  // Check cached thumbnails first
  const cachedResults = [];
  const uncachedPaths = [];
  
  for (const webdavPath of webdavPaths) {
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      cachedResults.push({
        path: webdavPath,
        thumbnailUrl: getThumbnailUrl(webdavPath)
      });
    } else {
      uncachedPaths.push(webdavPath);
    }
  }
  
  // Generate uncached thumbnails
  if (uncachedPaths.length > 0) {
    const tasks = uncachedPaths.map(webdavPath => async () => {
      try {
        const filename = path.basename(webdavPath);
        let thumbnailUrl = null;
        
        if (isImageFile(filename)) {
          const result = await generateImageThumbnail(null, webdavPath);
          if (result) {
            thumbnailUrl = getThumbnailUrl(webdavPath);
          }
        } else if (isVideoFile(filename)) {
          const status = await initFfmpegOnce();
          if (status.available) {
            const result = await generateVideoThumbnail(null, webdavPath);
            if (result) {
              thumbnailUrl = getThumbnailUrl(webdavPath);
            }
          }
        }
        
        return {
          path: webdavPath,
          thumbnailUrl
        };
      } catch (error) {
        console.error(`Error generating thumbnail for ${webdavPath}:`, error.message);
        return {
          path: webdavPath,
          thumbnailUrl: null
        };
      }
    });
    
    const generatedResults = await limitConcurrency(tasks, CONCURRENCY_LIMIT);
    results.push(...cachedResults, ...generatedResults);
  } else {
    results.push(...cachedResults);
  }
  
  return results;
}

module.exports = {
  getThumbnail,
  getThumbnailUrl,
  getThumbnailFromCache,
  generateImageThumbnail,
  generateVideoThumbnail,
  ensureThumbnail,
  ensureThumbnailsBatch,
  getThumbnailHash,
  signThumbnailToken,
  verifyThumbnailToken,
  initFfmpegOnce,
  getFfmpegStatus,
  thumbnailCache,
};

