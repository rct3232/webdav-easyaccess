const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { getFileContents, isImageFile, isVideoFile } = require('./webdav');

// Use centralized path utility to ensure consistency
// CRITICAL: Always use absolute paths from project root, NEVER server/data/
const { getThumbnailDir } = require('./paths');
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR 
  ? path.resolve(process.env.THUMBNAIL_DIR)
  : getThumbnailDir(); // getThumbnailDir() already returns absolute path, no need for path.resolve()
const MAX_SIZE = parseInt(process.env.MAX_THUMBNAIL_SIZE) || 300;

// Ensure thumbnail directory exists
// CRITICAL: THUMBNAIL_DIR must be absolute path to project root/data/thumbnails
// Never use server/data/thumbnails - always use project root/data/thumbnails
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  console.log(`[Thumbnail] Created thumbnail directory: ${THUMBNAIL_DIR}`);
}
// Verify the path is correct - CRITICAL CHECKS
if (!path.isAbsolute(THUMBNAIL_DIR)) {
  console.error(`[Thumbnail] ERROR: THUMBNAIL_DIR is not absolute: ${THUMBNAIL_DIR}`);
  throw new Error(`THUMBNAIL_DIR must be absolute path, got: ${THUMBNAIL_DIR}`);
}
// Verify it's not in server/data/ - CRITICAL CHECK
const normalizedPath = THUMBNAIL_DIR.replace(/\\/g, '/');
if (normalizedPath.includes('/server/data/')) {
  console.error(`[Thumbnail] ERROR: THUMBNAIL_DIR is in server/data/: ${THUMBNAIL_DIR}`);
  throw new Error(`THUMBNAIL_DIR must be in project root/data/, not server/data/: ${THUMBNAIL_DIR}`);
}
console.log(`[Thumbnail] Thumbnail directory (absolute, verified): ${THUMBNAIL_DIR}`);

function getThumbnailPath(filePath, extension = 'jpg') {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  // THUMBNAIL_DIR is already absolute from initialization, use it directly
  return path.join(THUMBNAIL_DIR, `${hash}.${extension}`);
}

// Check if thumbnail exists with either .jpg or .png extension
function findThumbnailPath(filePath) {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  // THUMBNAIL_DIR is already absolute, use it directly
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
    // Check if thumbnail already exists (either .jpg or .png)
    const existingThumbnail = findThumbnailPath(webdavPath);
    if (existingThumbnail) {
      console.log(`[Thumbnail] Thumbnail already exists: ${existingThumbnail.path}`);
      return existingThumbnail.path;
    }

    console.log(`[Thumbnail] Downloading image from WebDAV: ${webdavPath}`);
    // Download file from WebDAV
    const buffer = await getFileContents(webdavPath);
    if (!buffer) {
      throw new Error('Failed to download file from WebDAV');
    }
    console.log(`[Thumbnail] Downloaded ${buffer.length} bytes`);
    
    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    // Check image metadata to determine if it has transparency
    const metadata = await sharp(buffer).metadata();
    const hasAlpha = metadata.hasAlpha === true;
    const format = metadata.format;
    
    console.log(`[Thumbnail] Image metadata: format=${format}, hasAlpha=${hasAlpha}, channels=${metadata.channels}`);
    
    // Determine output format: PNG if has alpha channel, JPEG otherwise
    const outputExtension = hasAlpha ? 'png' : 'jpg';
    const thumbnailPath = getThumbnailPath(webdavPath, outputExtension);
    
    // Ensure thumbnail directory exists (use absolute path)
    const thumbnailDir = path.resolve(path.dirname(thumbnailPath));
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
      console.log(`[Thumbnail] Created thumbnail directory: ${thumbnailDir}`);
    }
    
    console.log(`[Thumbnail] Generating thumbnail: ${thumbnailPath} (format: ${outputExtension})`);
    console.log(`[Thumbnail] Directory exists: ${fs.existsSync(thumbnailDir)}`);
    
    // Generate thumbnail with appropriate format
    try {
      const sharpInstance = sharp(buffer)
        .resize(MAX_SIZE, MAX_SIZE, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      
      if (hasAlpha) {
        // PNG with transparency
        await sharpInstance
          .png({ quality: 90, compressionLevel: 6 })
          .toFile(thumbnailPath);
        console.log(`[Thumbnail] Generated PNG thumbnail with transparency`);
      } else {
        // JPEG without transparency
        await sharpInstance
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);
        console.log(`[Thumbnail] Generated JPEG thumbnail`);
      }
      
      console.log(`[Thumbnail] Sharp processing completed`);
    } catch (sharpError) {
      console.error(`[Thumbnail] Sharp error:`, sharpError);
      throw sharpError;
    }

    // Wait a bit and verify file was created
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify file was created
    if (fs.existsSync(thumbnailPath)) {
      const stats = fs.statSync(thumbnailPath);
      console.log(`[Thumbnail] Thumbnail generated successfully: ${thumbnailPath} (${stats.size} bytes, ${outputExtension})`);
      return thumbnailPath;
    } else {
      console.error(`[Thumbnail] File was not created! Expected: ${thumbnailPath}`);
      console.error(`[Thumbnail] Directory listing:`, fs.readdirSync(thumbnailDir));
      throw new Error(`Thumbnail file was not created at: ${thumbnailPath}`);
    }
  } catch (error) {
    console.error(`[Thumbnail] Error generating image thumbnail for ${webdavPath}:`, error);
    console.error(`[Thumbnail] Error details:`, {
      message: error.message,
      stack: error.stack,
    });
    return null;
  }
}

async function generateVideoThumbnail(filePath, webdavPath) {
  let tempVideoPath = null;
  let tempFramePath = null;
  
  try {
    // Check if thumbnail already exists (either .jpg or .png)
    const existingThumbnail = findThumbnailPath(webdavPath);
    if (existingThumbnail) {
      console.log(`[Thumbnail] Video thumbnail already exists: ${existingThumbnail.path}`);
      return existingThumbnail.path;
    }
    
    // Videos always use JPEG format (no transparency)
    const thumbnailPath = getThumbnailPath(webdavPath, 'jpg');
    
    console.log(`[Thumbnail] Thumbnail path: ${thumbnailPath}`);

    console.log(`[Thumbnail] Downloading video from WebDAV: ${webdavPath}`);
    // Download video file from WebDAV
    const buffer = await getFileContents(webdavPath);
    if (!buffer) {
      throw new Error('Failed to download video from WebDAV');
    }
    console.log(`[Thumbnail] Downloaded ${buffer.length} bytes`);
    
    if (buffer.length === 0) {
      throw new Error('Downloaded video file is empty');
    }
    
    // Create temp directory if it doesn't exist
    const { getDataDir } = require('./paths');
    const dataDir = path.resolve(getDataDir());
    const tempDir = path.resolve(path.join(dataDir, 'temp'));
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`[Thumbnail] Created temp directory: ${tempDir}`);
    }
    
    // Save video to temporary file
    const videoHash = crypto.createHash('md5').update(webdavPath).digest('hex');
    tempVideoPath = path.resolve(path.join(tempDir, `${videoHash}_temp_video`));
    tempFramePath = path.resolve(path.join(tempDir, `${videoHash}_temp_frame.jpg`));
    
    // Determine file extension from webdavPath
    const ext = path.extname(webdavPath).toLowerCase();
    if (ext) {
      tempVideoPath += ext;
    } else {
      // Default to .mp4 if no extension
      tempVideoPath += '.mp4';
    }
    
    console.log(`[Thumbnail] Saving video to temp file: ${tempVideoPath}`);
    fs.writeFileSync(tempVideoPath, buffer);
    
    // Ensure thumbnail directory exists (use absolute path)
    const thumbnailDir = path.resolve(path.dirname(thumbnailPath));
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
      console.log(`[Thumbnail] Created thumbnail directory: ${thumbnailDir}`);
    }
    
    console.log(`[Thumbnail] Extracting first frame from video...`);
    
    // Set ffmpeg path if specified in environment
    let ffmpegFound = false;
    if (process.env.FFMPEG_PATH) {
      const ffmpegPath = path.resolve(process.env.FFMPEG_PATH);
      if (fs.existsSync(ffmpegPath)) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        console.log(`[Thumbnail] Using FFmpeg path from env: ${ffmpegPath}`);
        ffmpegFound = true;
      } else {
        console.warn(`[Thumbnail] FFMPEG_PATH specified but file not found: ${ffmpegPath}`);
      }
    }
    
    // Try to find ffmpeg in common locations
    if (!ffmpegFound) {
      const { getProjectRoot } = require('./paths');
      const projectRoot = getProjectRoot();
      const os = require('os');
      const platform = os.platform();
      
      // Try project root first
      const projectRootFfmpeg = path.join(projectRoot, 'ffmpeg.exe');
      if (fs.existsSync(projectRootFfmpeg)) {
        ffmpeg.setFfmpegPath(projectRootFfmpeg);
        console.log(`[Thumbnail] Found FFmpeg in project root: ${projectRootFfmpeg}`);
        ffmpegFound = true;
      } else if (platform === 'win32') {
        // Try common Windows locations
        const possiblePaths = [
          'C:\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
        ];
        
        for (const possiblePath of possiblePaths) {
          if (fs.existsSync(possiblePath)) {
            ffmpeg.setFfmpegPath(possiblePath);
            console.log(`[Thumbnail] Found FFmpeg at: ${possiblePath}`);
            ffmpegFound = true;
            break;
          }
        }
      }
      
      // If still not found, try to use system PATH (fluent-ffmpeg will try to find it)
      if (!ffmpegFound) {
        console.warn(`[Thumbnail] FFmpeg not found in common locations. Trying system PATH...`);
      }
    }
    
    // Extract first frame using ffmpeg
    await new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(tempVideoPath);
      
      ffmpegCommand
        .screenshots({
          timestamps: ['00:00:00.000'],
          filename: path.basename(tempFramePath),
          folder: path.dirname(tempFramePath),
        })
        .on('start', (commandLine) => {
          console.log(`[Thumbnail] FFmpeg command: ${commandLine}`);
        })
        .on('end', () => {
          console.log(`[Thumbnail] Frame extracted successfully`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[Thumbnail] FFmpeg error:`, err);
          console.error(`[Thumbnail] FFmpeg error details:`, {
            message: err.message,
            code: err.code,
          });
          
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
    
    console.log(`[Thumbnail] Processing frame with Sharp...`);
    
    // Process frame with Sharp to ensure JPEG format and proper sizing
    const frameBuffer = fs.readFileSync(tempFramePath);
    await sharp(frameBuffer)
      .resize(MAX_SIZE, MAX_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);
    
    // Verify thumbnail was created
    if (fs.existsSync(thumbnailPath)) {
      const stats = fs.statSync(thumbnailPath);
      console.log(`[Thumbnail] Video thumbnail generated successfully: ${thumbnailPath} (${stats.size} bytes)`);
      return thumbnailPath;
    } else {
      throw new Error(`Thumbnail file was not created at: ${thumbnailPath}`);
    }
  } catch (error) {
    console.error(`[Thumbnail] Error generating video thumbnail for ${webdavPath}:`, error);
    console.error(`[Thumbnail] Error details:`, {
      message: error.message,
      stack: error.stack,
    });
    return null;
  } finally {
    // Clean up temporary files
    try {
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
        console.log(`[Thumbnail] Cleaned up temp video file: ${tempVideoPath}`);
      }
      if (tempFramePath && fs.existsSync(tempFramePath)) {
        fs.unlinkSync(tempFramePath);
        console.log(`[Thumbnail] Cleaned up temp frame file: ${tempFramePath}`);
      }
    } catch (cleanupError) {
      console.error(`[Thumbnail] Error cleaning up temp files:`, cleanupError);
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
  // Check for existing thumbnail (either .jpg or .png)
  const existingThumbnail = findThumbnailPath(webdavPath);
  if (existingThumbnail) {
    const hash = crypto.createHash('md5').update(webdavPath).digest('hex');
    const url = `/api/thumbnails/${hash}.${existingThumbnail.extension}`;
    console.log(`[Thumbnail] Generated URL: ${url} for path: ${webdavPath}`);
    return url;
  }
  console.log(`[Thumbnail] Thumbnail file does not exist for: ${webdavPath}`);
  return null;
}

async function ensureThumbnail(webdavPath) {
  try {
    const filename = path.basename(webdavPath);
    
    console.log(`[Thumbnail] ===== ensureThumbnail START =====`);
    console.log(`[Thumbnail] WebDAV path: ${webdavPath}`);
    console.log(`[Thumbnail] Filename: ${filename}`);
    console.log(`[Thumbnail] THUMBNAIL_DIR: ${THUMBNAIL_DIR}`);
    
    // Check if thumbnail already exists (either .jpg or .png)
    const existingThumbnail = findThumbnailPath(webdavPath);
    if (existingThumbnail) {
      console.log(`[Thumbnail] Thumbnail exists: ${existingThumbnail.path}`);
      const url = getThumbnailUrl(webdavPath);
      console.log(`[Thumbnail] Thumbnail exists, URL: ${url}`);
      console.log(`[Thumbnail] ===== ensureThumbnail END (exists) =====`);
      return url;
    }
    
    // Generate thumbnail if it's an image or video
    if (isImageFile(filename)) {
      console.log(`[Thumbnail] Generating thumbnail for image: ${filename}`);
      const generatedPath = await generateImageThumbnail(null, webdavPath);
      
      console.log(`[Thumbnail] generateImageThumbnail returned: ${generatedPath}`);
      
      // Verify the file was actually created
      if (generatedPath) {
        // generatedPath should already be absolute
        const exists = fs.existsSync(generatedPath);
        console.log(`[Thumbnail] Generated path: ${generatedPath}`);
        console.log(`[Thumbnail] File exists after generation: ${exists}`);
        
        // Also check using findThumbnailPath to ensure consistency
        const checkThumbnail = findThumbnailPath(webdavPath);
        const checkExists = checkThumbnail !== null;
        if (checkThumbnail) {
          console.log(`[Thumbnail] Check path: ${checkThumbnail.path}`);
        }
        console.log(`[Thumbnail] Check path exists: ${checkExists}`);
        
        if (exists || checkExists) {
          const url = getThumbnailUrl(webdavPath);
          console.log(`[Thumbnail] Thumbnail generated successfully, URL: ${url}`);
          console.log(`[Thumbnail] ===== ensureThumbnail END (generated) =====`);
          return url;
        } else {
          console.error(`[Thumbnail] Thumbnail file was not created!`);
          console.error(`[Thumbnail] Generated path: ${generatedPath}`);
        }
      } else {
        console.error(`[Thumbnail] generateImageThumbnail returned null`);
      }
      
      console.error(`[Thumbnail] Failed to generate thumbnail for: ${webdavPath}`);
      console.log(`[Thumbnail] ===== ensureThumbnail END (failed) =====`);
      return null;
    } else if (isVideoFile(filename)) {
      console.log(`[Thumbnail] Generating thumbnail for video: ${filename}`);
      const generatedPath = await generateVideoThumbnail(null, webdavPath);
      
      console.log(`[Thumbnail] generateVideoThumbnail returned: ${generatedPath}`);
      
      // Verify the file was actually created
      if (generatedPath) {
        const exists = fs.existsSync(generatedPath);
        console.log(`[Thumbnail] Generated path: ${generatedPath}`);
        console.log(`[Thumbnail] File exists after generation: ${exists}`);
        
        // Also check using findThumbnailPath to ensure consistency
        const checkThumbnail = findThumbnailPath(webdavPath);
        const checkExists = checkThumbnail !== null;
        if (checkThumbnail) {
          console.log(`[Thumbnail] Check path: ${checkThumbnail.path}`);
        }
        console.log(`[Thumbnail] Check path exists: ${checkExists}`);
        
        if (exists || checkExists) {
          const url = getThumbnailUrl(webdavPath);
          console.log(`[Thumbnail] Video thumbnail generated successfully, URL: ${url}`);
          console.log(`[Thumbnail] ===== ensureThumbnail END (video generated) =====`);
          return url;
        } else {
          console.error(`[Thumbnail] Video thumbnail file was not created!`);
          console.error(`[Thumbnail] Generated path: ${generatedPath}`);
        }
      } else {
        console.error(`[Thumbnail] generateVideoThumbnail returned null`);
      }
      
      console.error(`[Thumbnail] Failed to generate video thumbnail for: ${webdavPath}`);
      console.log(`[Thumbnail] ===== ensureThumbnail END (video failed) =====`);
      return null;
    }
    
    console.log(`[Thumbnail] Not an image or video file: ${filename}`);
    console.log(`[Thumbnail] ===== ensureThumbnail END (not image/video) =====`);
    return null;
  } catch (error) {
    console.error(`[Thumbnail] Error in ensureThumbnail for ${webdavPath}:`, error);
    console.error(`[Thumbnail] Error stack:`, error.stack);
    console.log(`[Thumbnail] ===== ensureThumbnail END (error) =====`);
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

