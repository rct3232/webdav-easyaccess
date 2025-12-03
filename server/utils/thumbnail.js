const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { getFileContents, isImageFile, isVideoFile } = require('./webdav');

const { getThumbnailDir } = require('./paths');
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR 
  ? path.resolve(process.env.THUMBNAIL_DIR)
  : getThumbnailDir(); // getThumbnailDir() already returns absolute path, no need for path.resolve()
const MAX_SIZE = parseInt(process.env.MAX_THUMBNAIL_SIZE) || 300;

if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

if (!path.isAbsolute(THUMBNAIL_DIR)) {
  throw new Error(`THUMBNAIL_DIR must be absolute path, got: ${THUMBNAIL_DIR}`);
}

const normalizedPath = THUMBNAIL_DIR.replace(/\\/g, '/');
if (normalizedPath.includes('/server/data/')) {
  throw new Error(`THUMBNAIL_DIR must be in project root/data/, not server/data/: ${THUMBNAIL_DIR}`);
}

function getThumbnailPath(filePath, extension = 'jpg') {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  return path.join(THUMBNAIL_DIR, `${hash}.${extension}`);
}

function findThumbnailPath(filePath) {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  const jpgPath = path.join(THUMBNAIL_DIR, `${hash}.jpg`);
  const pngPath = path.join(THUMBNAIL_DIR, `${hash}.png`);
  
  if (fs.existsSync(pngPath)) {
    return { path: pngPath, extension: 'png' };
  }
  if (fs.existsSync(jpgPath)) {
    return { path: jpgPath, extension: 'jpg' };
  }
  return null;
}

async function generateImageThumbnail(filePath, webdavPath) {
  try {
    const existingThumbnail = findThumbnailPath(webdavPath);
    if (existingThumbnail) {
      return existingThumbnail.path;
    }

    const buffer = await getFileContents(webdavPath);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download file from WebDAV');
    }
    
    const metadata = await sharp(buffer).metadata();
    const hasAlpha = metadata.hasAlpha === true;
    const outputExtension = hasAlpha ? 'png' : 'jpg';
    const thumbnailPath = getThumbnailPath(webdavPath, outputExtension);
    const thumbnailDir = path.resolve(path.dirname(thumbnailPath));
    
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }
    
    try {
      const sharpInstance = sharp(buffer)
        .resize(MAX_SIZE, MAX_SIZE, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      
      if (hasAlpha) {
        await sharpInstance
          .png({ quality: 90, compressionLevel: 6 })
          .toFile(thumbnailPath);
      } else {
        await sharpInstance
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);
      }
    } catch (sharpError) {
      throw sharpError;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (fs.existsSync(thumbnailPath)) {
      return thumbnailPath;
    } else {
      throw new Error(`Thumbnail file was not created at: ${thumbnailPath}`);
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
    const existingThumbnail = findThumbnailPath(webdavPath);
    if (existingThumbnail) {
      return existingThumbnail.path;
    }
    
    const thumbnailPath = getThumbnailPath(webdavPath, 'jpg');
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
    
    const thumbnailDir = path.resolve(path.dirname(thumbnailPath));
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }
    
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
    await sharp(frameBuffer)
      .resize(MAX_SIZE, MAX_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);
    
    if (fs.existsSync(thumbnailPath)) {
      return thumbnailPath;
    } else {
      throw new Error(`Thumbnail file was not created at: ${thumbnailPath}`);
    }
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
    return await generateImageThumbnail(null, webdavPath);
  } else if (isVideoFile(filename)) {
    return await generateVideoThumbnail(null, webdavPath);
  }
  
  return null;
}

function getThumbnailUrl(webdavPath) {
  const existingThumbnail = findThumbnailPath(webdavPath);
  if (existingThumbnail) {
    const hash = crypto.createHash('md5').update(webdavPath).digest('hex');
    return `/api/thumbnails/${hash}.${existingThumbnail.extension}`;
  }
  return null;
}

async function ensureThumbnail(webdavPath) {
  try {
    const filename = path.basename(webdavPath);
    const existingThumbnail = findThumbnailPath(webdavPath);
    
    if (existingThumbnail) {
      return getThumbnailUrl(webdavPath);
    }
    
    if (isImageFile(filename)) {
      const generatedPath = await generateImageThumbnail(null, webdavPath);
      if (generatedPath && (fs.existsSync(generatedPath) || findThumbnailPath(webdavPath))) {
        return getThumbnailUrl(webdavPath);
      }
      return null;
    } else if (isVideoFile(filename)) {
      const generatedPath = await generateVideoThumbnail(null, webdavPath);
      if (generatedPath && (fs.existsSync(generatedPath) || findThumbnailPath(webdavPath))) {
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
  getThumbnailPath,
  generateImageThumbnail,
  generateVideoThumbnail,
  ensureThumbnail,
};

