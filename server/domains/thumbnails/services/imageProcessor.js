const sharp = require('sharp');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const { getFileContents } = require('../../../utils/webdav');

const MAX_SIZE = parseInt(process.env.MAX_THUMBNAIL_SIZE) || 300;

async function generateImageThumbnail(webdavPath) {
  try {
    const buffer = await getFileContents(webdavPath);
    if (!buffer || buffer.length === 0) {
      throw createError(SERVER_ERROR_CODES.thumbnail.downloadFailed, 500);
    }

    const metadata = await sharp(buffer).metadata();
    const hasAlpha = metadata.hasAlpha === true;
    const outputExtension = hasAlpha ? 'png' : 'jpg';

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

    return { buffer: thumbnailBuffer, extension: outputExtension };
  } catch (error) {
    console.error(`Error generating image thumbnail: ${error.message}`);
    return null;
  }
}

module.exports = { generateImageThumbnail };
