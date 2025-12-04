const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { getFileContents, isImageFile, isVideoFile } = require('./webdav');

const MAX_SIZE = parseInt(process.env.MAX_THUMBNAIL_SIZE) || 300;

// In-memory thumbnail cache: Map<webdavPath, { buffer: Buffer, mimeType: string, extension: string }>
const thumbnailCache = new Map();

// Cache size limit (optional - prevent memory overflow)
const MAX_CACHE_SIZE = 1000; // Maximum number of thumbnails in cache

function getThumbnailHash(webdavPath) {
  return crypto.createHash('md5').update(webdavPath).digest('hex');
}

function getCachedThumbnail(webdavPath) {
  return thumbnailCache.get(webdavPath) || null;
}

function setCachedThumbnail(webdavPath, buffer, extension) {
  // Simple cache eviction: remove oldest entries if cache is too large
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
    // Check memory cache first
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      console.log(`[Thumbnail] Using cached thumbnail for: ${webdavPath}`);
      return { buffer: cached.buffer, extension: cached.extension };
    }

    console.log(`[Thumbnail] Generating thumbnail for: ${webdavPath}`);
    const buffer = await getFileContents(webdavPath);
    console.log(`[Thumbnail] Retrieved ${buffer.length} bytes for: ${webdavPath}`);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download file from WebDAV');
    }
    
    const metadata = await sharp(buffer).metadata();
    const hasAlpha = metadata.hasAlpha === true;
    const outputExtension = hasAlpha ? 'png' : 'jpg';
    
    try {
      const sharpInstance = sharp(buffer)
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
      
      // Store in memory cache
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
    // Check memory cache first
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      return { buffer: cached.buffer, extension: cached.extension };
    }
    
    const buffer = await getFileContents(webdavPath);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download video from WebDAV');
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
    
    let ffmpegFound = false;
    if (process.env.FFMPEG_PATH) {
      const ffmpegPath = path.resolve(process.env.FFMPEG_PATH);
      if (fs.existsSync(ffmpegPath)) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpegFound = true;
      }
    }
    
    if (!ffmpegFound) {
      const { getProjectRoot } = require('./paths');
      const projectRoot = getProjectRoot();
      const os = require('os');
      const platform = os.platform();
      
      const projectRootFfmpeg = path.join(projectRoot, 'ffmpeg.exe');
      if (fs.existsSync(projectRootFfmpeg)) {
        ffmpeg.setFfmpegPath(projectRootFfmpeg);
        ffmpegFound = true;
      } else if (platform === 'win32') {
        const possiblePaths = [
          'C:\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
        ];
        
        for (const possiblePath of possiblePaths) {
          if (fs.existsSync(possiblePath)) {
            ffmpeg.setFfmpegPath(possiblePath);
            ffmpegFound = true;
            break;
          }
        }
      }
    }    
    await new Promise((resolve, reject) => {
      ffmpeg(tempVideoPath)
        .screenshots({
          timestamps: ['00:00:00.000'],
          filename: path.basename(tempFramePath),
          folder: path.dirname(tempFramePath),
        })
        .on('end', () => resolve())
        .on('error', (err) => {
          let errorMessage = `FFmpeg failed: ${err.message}`;
          if (err.message.includes('ENOENT') || err.message.includes('spawn')) {
            errorMessage += `\n\nFFmpeg is not installed or not found in PATH.\n`;
            errorMessage += `Please install FFmpeg:\n`;
            errorMessage += `  Windows: Download from https://ffmpeg.org/download.html or use: choco install ffmpeg\n`;
            errorMessage += `  Or set FFMPEG_PATH in .env file to the full path of ffmpeg.exe\n`;
            errorMessage += `  Example: FFMPEG_PATH=C:\\ffmpeg\\bin\\ffmpeg.exe`;
          }
          reject(new Error(errorMessage));
        });
    });
    
    // Check if frame was extracted
    if (!fs.existsSync(tempFramePath)) {
      throw new Error('Frame extraction failed - output file not found');
    }
    const frameBuffer = fs.readFileSync(tempFramePath);
    const thumbnailBuffer = await sharp(frameBuffer)
      .resize(MAX_SIZE, MAX_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    
    // Store in memory cache
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
    return `/api/thumbnails/${hash}.${cached.extension}`;
  }
  return null;
}

function getThumbnailFromCache(webdavPath) {
  return getCachedThumbnail(webdavPath);
}

async function ensureThumbnail(webdavPath) {
  try {
    const filename = path.basename(webdavPath);
    
    // Check cache first
    const cached = getCachedThumbnail(webdavPath);
    if (cached) {
      return getThumbnailUrl(webdavPath);
    }
    
    // Generate if not cached
    if (isImageFile(filename)) {
      const result = await generateImageThumbnail(null, webdavPath);
      if (result) {
        return getThumbnailUrl(webdavPath);
      }
      return null;
    } else if (isVideoFile(filename)) {
      const result = await generateVideoThumbnail(null, webdavPath);
      if (result) {
        return getThumbnailUrl(webdavPath);
      }
      return null;
    }
    
    return null;
  } catch (error) {
    console.error(`Error in ensureThumbnail: ${error.message}`);
    return null;
  }
}

module.exports = {
  getThumbnail,
  getThumbnailUrl,
  getThumbnailFromCache,
  generateImageThumbnail,
  generateVideoThumbnail,
  ensureThumbnail,
  getThumbnailHash,
  thumbnailCache, // Export cache for server route access
};

