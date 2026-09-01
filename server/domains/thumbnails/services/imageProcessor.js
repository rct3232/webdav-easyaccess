const sharp = require('sharp');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

async function generateImageThumbnail(nodeId) {
  try {
    const { getComposition } = require('../../../service/composition');
    const { blobStorageService } = getComposition();
    const buffer = await blobStorageService.downloadBlob(nodeId);
    if (!buffer || buffer.length === 0) {
      throw createError(SERVER_ERROR_CODES.thumbnail.downloadFailed, 500);
    }

    const metadata = await sharp(buffer).metadata();
    const hasAlpha = metadata.hasAlpha === true;
    const outputExtension = hasAlpha ? 'png' : 'jpg';

    // MAX_THUMBNAIL_SIZE is T2 (lazy): read the effective value per request.
    const maxSize = parseInt(await getSharedResolver().getConfig('MAX_THUMBNAIL_SIZE'), 10) || 300;
    const sharpInstance = sharp(buffer).rotate().resize(maxSize, maxSize, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    let thumbnailBuffer;
    if (hasAlpha) {
      thumbnailBuffer = await sharpInstance.png({ quality: 90, compressionLevel: 6 }).toBuffer();
    } else {
      thumbnailBuffer = await sharpInstance.jpeg({ quality: 80 }).toBuffer();
    }

    return { buffer: thumbnailBuffer, extension: outputExtension };
  } catch (error) {
    console.error(`Error generating image thumbnail: ${error.message}`);
    return null;
  }
}

module.exports = { generateImageThumbnail };
