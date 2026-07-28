/**
 * Backward-compatible shim — re-exports from domains/thumbnails/services/.
 * All consumers should migrate to direct imports from domains/thumbnails/services/.
 *
 * @deprecated Use domains/thumbnails/services/thumbnailService instead.
 */
const thumbnailService = require('../domains/thumbnails/services/thumbnailService');
const { generateImageThumbnail } = require('../domains/thumbnails/services/imageProcessor');
const { generateVideoThumbnail, initFfmpegOnce, getFfmpegStatus } = require('../domains/thumbnails/services/videoProcessor');
const { getThumbnailCacheAdapter } = require('../domains/thumbnails/cache');

module.exports = {
  getThumbnail: thumbnailService.getThumbnail,
  getThumbnailUrl: thumbnailService.getThumbnailUrl,
  getThumbnailFromCache: thumbnailService.getThumbnailFromCache,
  generateImageThumbnail,
  generateVideoThumbnail,
  ensureThumbnail: thumbnailService.ensureThumbnail,
  ensureThumbnailsBatch: thumbnailService.ensureThumbnailsBatch,
  getThumbnailHash: thumbnailService.getThumbnailHash,
  signThumbnailToken: thumbnailService.signThumbnailToken,
  verifyThumbnailToken: thumbnailService.verifyThumbnailToken,
  initFfmpegOnce,
  getFfmpegStatus,
  thumbnailCache: getThumbnailCacheAdapter(),
};
