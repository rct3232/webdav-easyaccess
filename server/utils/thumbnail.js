const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getFileContents, isImageFile, isVideoFile } = require('./webdav');

const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || path.join(__dirname, '../../data/thumbnails');
const MAX_SIZE = parseInt(process.env.MAX_THUMBNAIL_SIZE) || 300;

// Ensure thumbnail directory exists
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

function getThumbnailPath(filePath) {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  return path.join(THUMBNAIL_DIR, `${hash}.jpg`);
}

async function generateImageThumbnail(filePath, webdavPath) {
  try {
    const thumbnailPath = getThumbnailPath(webdavPath);
    
    // Check if thumbnail already exists
    if (fs.existsSync(thumbnailPath)) {
      return thumbnailPath;
    }

    // Download file from WebDAV
    const buffer = await getFileContents(webdavPath);
    
    // Generate thumbnail
    await sharp(buffer)
      .resize(MAX_SIZE, MAX_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);

    return thumbnailPath;
  } catch (error) {
    console.error('Error generating image thumbnail:', error);
    return null;
  }
}

async function generateVideoThumbnail(filePath, webdavPath) {
  // For video thumbnails, we would need ffmpeg
  // This is a simplified version - in production, you'd want to use fluent-ffmpeg
  // For now, return null and handle it in the frontend
  return null;
}

async function getThumbnail(webdavPath) {
  const filename = path.basename(webdavPath);
  
  if (isImageFile(filename)) {
    return await generateImageThumbnail(null, webdavPath);
  } else if (isVideoFile(filename)) {
    return await generateVideoThumbnail(null, webdavPath);
  }
  
  return null;
}

function getThumbnailUrl(webdavPath) {
  const thumbnailPath = getThumbnailPath(webdavPath);
  if (fs.existsSync(thumbnailPath)) {
    const hash = crypto.createHash('md5').update(webdavPath).digest('hex');
    return `/api/thumbnails/${hash}.jpg`;
  }
  return null;
}

async function ensureThumbnail(webdavPath) {
  const filename = path.basename(webdavPath);
  const thumbnailPath = getThumbnailPath(webdavPath);
  
  // If thumbnail already exists, return URL
  if (fs.existsSync(thumbnailPath)) {
    return getThumbnailUrl(webdavPath);
  }
  
  // Generate thumbnail if it's an image or video
  if (isImageFile(filename)) {
    await generateImageThumbnail(null, webdavPath);
    return getThumbnailUrl(webdavPath);
  } else if (isVideoFile(filename)) {
    // Video thumbnails would need ffmpeg - skip for now
    return null;
  }
  
  return null;
}

module.exports = {
  getThumbnail,
  getThumbnailUrl,
  getThumbnailPath,
  generateImageThumbnail,
  generateVideoThumbnail,
  ensureThumbnail,
};

