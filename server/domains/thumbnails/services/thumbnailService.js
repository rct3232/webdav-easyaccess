const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { generateImageThumbnail } = require('./imageProcessor');
const { generateVideoThumbnail, initFfmpegOnce } = require('./videoProcessor');

const THUMBNAIL_TOKEN_SECRET = process.env.THUMBNAIL_TOKEN_SECRET || process.env.JWT_SECRET || 'thumbnail-secret';
const THUMBNAIL_TOKEN_EXPIRY = process.env.THUMBNAIL_TOKEN_EXPIRY || '15m';
const MAX_CACHE_SIZE = 1000;

let _cacheAdapter = null;

function setCacheAdapter(adapter) {
  _cacheAdapter = adapter;
}

function _getCache() {
  if (!_cacheAdapter) {
    const { getThumbnailCacheAdapter } = require('../cache');
    _cacheAdapter = getThumbnailCacheAdapter();
  }
  return _cacheAdapter;
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
  return _getCache().get(`thumb:${webdavPath}`) || null;
}

function setCachedThumbnail(webdavPath, buffer, extension) {
  const cache = _getCache();

  if (cache.size >= MAX_CACHE_SIZE) {
    const keysIterator = cache.keys();
    const first = keysIterator.next();
    if (!first.done) {
      cache.delete(first.value);
    }
  }

  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
  cache.set(`thumb:${webdavPath}`, {
    buffer,
    mimeType,
    extension,
  });
}

function findCachedThumbnailByHash(hash) {
  const cache = _getCache();
  for (const [key, thumbnail] of cache.entries()) {
    if (!key.startsWith('thumb:')) continue;
    const webdavPath = key.slice(6);
    if (getThumbnailHash(webdavPath) === hash) {
      return { webdavPath, thumbnail };
    }
  }
  return null;
}

async function getThumbnail(webdavPath) {
  const filename = path.basename(webdavPath);

  if (isImageFile(filename)) {
    const cached = getCachedThumbnail(webdavPath);
    if (cached) return cached.buffer;
    const result = await generateImageThumbnail(webdavPath);
    if (result) {
      setCachedThumbnail(webdavPath, result.buffer, result.extension);
      return result.buffer;
    }
    return null;
  } else if (isVideoFile(filename)) {
    const cached = getCachedThumbnail(webdavPath);
    if (cached) return cached.buffer;
    const result = await generateVideoThumbnail(webdavPath);
    if (result) {
      setCachedThumbnail(webdavPath, result.buffer, result.extension);
      return result.buffer;
    }
    return null;
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
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      return getThumbnailUrl(webdavPath);
    }

    const filename = path.basename(webdavPath);

    if (isImageFile(filename)) {
      const result = await generateImageThumbnail(webdavPath);
      if (result) {
        setCachedThumbnail(webdavPath, result.buffer, result.extension);
        return getThumbnailUrl(webdavPath);
      }
      return null;
    } else if (isVideoFile(filename)) {
      const status = await initFfmpegOnce();
      if (!status.available) return null;
      const result = await generateVideoThumbnail(webdavPath);
      if (result) {
        setCachedThumbnail(webdavPath, result.buffer, result.extension);
        return getThumbnailUrl(webdavPath);
      }
      return null;
    }

    return null;
  } catch (error) {
    return null;
  }
}

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

  const cachedResults = [];
  const uncachedPaths = [];

  for (const webdavPath of webdavPaths) {
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      cachedResults.push({
        path: webdavPath,
        thumbnailUrl: getThumbnailUrl(webdavPath),
      });
    } else {
      uncachedPaths.push(webdavPath);
    }
  }

  if (uncachedPaths.length > 0) {
    const tasks = uncachedPaths.map((webdavPath) => async () => {
      try {
        const filename = path.basename(webdavPath);
        let thumbnailUrl = null;

        if (isImageFile(filename)) {
          const result = await generateImageThumbnail(webdavPath);
          if (result) {
            setCachedThumbnail(webdavPath, result.buffer, result.extension);
            thumbnailUrl = getThumbnailUrl(webdavPath);
          }
        } else if (isVideoFile(filename)) {
          const status = await initFfmpegOnce();
          if (status.available) {
            const result = await generateVideoThumbnail(webdavPath);
            if (result) {
              setCachedThumbnail(webdavPath, result.buffer, result.extension);
              thumbnailUrl = getThumbnailUrl(webdavPath);
            }
          }
        }

        return {
          path: webdavPath,
          thumbnailUrl,
        };
      } catch (error) {
        console.error(`Error generating thumbnail for ${webdavPath}:`, error.message);
        return {
          path: webdavPath,
          thumbnailUrl: null,
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
  setCacheAdapter,
  getThumbnail,
  getThumbnailUrl,
  getThumbnailFromCache,
  ensureThumbnail,
  ensureThumbnailsBatch,
  getThumbnailHash,
  signThumbnailToken,
  verifyThumbnailToken,
  findCachedThumbnailByHash,
  get thumbnailCache() { return _getCache(); },
};
