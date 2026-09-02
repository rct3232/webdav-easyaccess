const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { generateImageThumbnail } = require('./imageProcessor');
const { generateVideoThumbnail, initFfmpegOnce } = require('./videoProcessor');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

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

function _cacheKey(nodeId) {
  return `thumb:${nodeId}`;
}

function getThumbnailHash(nodeId) {
  return crypto.createHash('md5').update(String(nodeId)).digest('hex');
}

// THUMBNAIL_TOKEN_SECRET / THUMBNAIL_TOKEN_EXPIRY are T2 (lazy): read the
// effective values (env → DB → default) per sign/verify so DB-sourced edits
// apply without a restart. Keep the original JWT_SECRET fallback chain.
async function resolveThumbnailTokenConfig() {
  const resolver = getSharedResolver();
  const [tokenSecret, jwtSecret, expiry] = await Promise.all([
    resolver.getConfig('THUMBNAIL_TOKEN_SECRET'),
    resolver.getConfig('JWT_SECRET'),
    resolver.getConfig('THUMBNAIL_TOKEN_EXPIRY'),
  ]);
  return {
    secret: tokenSecret || jwtSecret || 'thumbnail-secret',
    expiry: expiry || '15m',
  };
}

async function signThumbnailToken(nodeId) {
  const { secret, expiry } = await resolveThumbnailTokenConfig();
  const hash = getThumbnailHash(nodeId);
  return jwt.sign({ h: hash }, secret, { expiresIn: expiry });
}

async function verifyThumbnailToken(token, hash) {
  if (!token || typeof token !== 'string') return false;
  try {
    const { secret } = await resolveThumbnailTokenConfig();
    const decoded = jwt.verify(token, secret);
    return decoded && decoded.h === hash;
  } catch {
    return false;
  }
}

function getCachedThumbnail(nodeId) {
  return _getCache().get(_cacheKey(nodeId)) || null;
}

function setCachedThumbnail(nodeId, buffer, extension) {
  const cache = _getCache();

  if (cache.size >= MAX_CACHE_SIZE) {
    const first = cache.keys().next();
    if (!first.done) {
      cache.delete(first.value);
    }
  }

  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
  cache.set(_cacheKey(nodeId), {
    buffer,
    mimeType,
    extension,
  });
}

function findCachedThumbnailByHash(hash) {
  const cache = _getCache();
  for (const [key, thumbnail] of cache.entries()) {
    if (!key.startsWith('thumb:')) continue;
    const nodeId = parseInt(key.slice(6), 10);
    if (isNaN(nodeId)) continue;
    if (getThumbnailHash(nodeId) === hash) {
      return { nodeId, thumbnail };
    }
  }
  return null;
}

async function getNodeName(nodeId) {
  const { getComposition } = require('../../../service/composition');
  const { fileNodeService } = getComposition();
  const node = await fileNodeService.getNode(nodeId);
  return node ? node.name : null;
}

async function getThumbnail(nodeId) {
  const name = await getNodeName(nodeId);
  if (!name) return null;

  if (isImageFile(name)) {
    const cached = getCachedThumbnail(nodeId);
    if (cached) return cached.buffer;
    const result = await generateImageThumbnail(nodeId);
    if (result) {
      setCachedThumbnail(nodeId, result.buffer, result.extension);
      return result.buffer;
    }
    return null;
  } else if (isVideoFile(name)) {
    const cached = getCachedThumbnail(nodeId);
    if (cached) return cached.buffer;
    const result = await generateVideoThumbnail(nodeId);
    if (result) {
      setCachedThumbnail(nodeId, result.buffer, result.extension);
      return result.buffer;
    }
    return null;
  }

  return null;
}

async function getThumbnailUrl(nodeId) {
  const cached = getCachedThumbnail(nodeId);
  if (cached) {
    const hash = getThumbnailHash(nodeId);
    const token = await signThumbnailToken(nodeId);
    return `/api/thumbnails/${hash}.${cached.extension}?token=${encodeURIComponent(token)}`;
  }
  return null;
}

function getThumbnailFromCache(nodeId) {
  return getCachedThumbnail(nodeId);
}

async function ensureThumbnail(nodeId) {
  try {
    const cached = getCachedThumbnail(nodeId);
    if (cached) {
      return getThumbnailUrl(nodeId);
    }

    const name = await getNodeName(nodeId);
    if (!name) return null;

    if (isImageFile(name)) {
      const result = await generateImageThumbnail(nodeId);
      if (result) {
        setCachedThumbnail(nodeId, result.buffer, result.extension);
        return getThumbnailUrl(nodeId);
      }
      return null;
    } else if (isVideoFile(name)) {
      const status = await initFfmpegOnce();
      if (!status.available) return null;
      const result = await generateVideoThumbnail(nodeId);
      if (result) {
        setCachedThumbnail(nodeId, result.buffer, result.extension);
        return getThumbnailUrl(nodeId);
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

async function ensureThumbnailsBatch(nodeIds) {
  const CONCURRENCY_LIMIT = parseInt(process.env.THUMBNAIL_CONCURRENCY_LIMIT) || 10;
  const tasks = nodeIds.map((nodeId) => () => ensureThumbnail(nodeId));
  const urls = await limitConcurrency(tasks, CONCURRENCY_LIMIT);
  return nodeIds.map((nodeId, index) => ({ nodeId, thumbnailUrl: urls[index] }));
}

module.exports = {
  setCacheAdapter,
  getThumbnail,
  getThumbnailUrl,
  getThumbnailFromCache,
  getCachedThumbnail,
  setCachedThumbnail,
  ensureThumbnail,
  ensureThumbnailsBatch,
  getThumbnailHash,
  signThumbnailToken,
  verifyThumbnailToken,
  findCachedThumbnailByHash,
  get thumbnailCache() {
    return _getCache();
  },
};
