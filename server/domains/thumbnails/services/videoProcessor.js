const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

const ffmpegState = {
  checked: false,
  available: false,
  source: null,
  path: null,
  reason: null,
};

let ffmpegInitPromise = null;

function getFfmpegStatus() {
  return { ...ffmpegState };
}

async function canExecFfmpeg(cmdPath) {
  // FFMPEG_INIT_TIMEOUT_MS is T2 (lazy): read the effective value at point of
  // use. initFfmpegOnce runs after populateT1Env at boot, so the DB value wins.
  const timeoutMs =
    parseInt(await getSharedResolver().getConfig('FFMPEG_INIT_TIMEOUT_MS'), 10) || 2000;
  return await new Promise((resolve) => {
    execFile(cmdPath, ['-version'], { timeout: timeoutMs }, (err) => {
      if (!err) return resolve(true);
      if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') return resolve(true);
      return resolve(false);
    });
  });
}

async function initFfmpegOnce() {
  if (ffmpegState.checked) return getFfmpegStatus();
  if (ffmpegInitPromise) return await ffmpegInitPromise;

  ffmpegInitPromise = (async () => {
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

    if (platform === 'win32') {
      const { getProjectRoot } = require('../../../utils/paths');
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

    if (await canExecFfmpeg('ffmpeg')) {
      ffmpegState.checked = true;
      ffmpegState.available = true;
      ffmpegState.source = 'path';
      ffmpegState.path = null;
      ffmpegState.reason = null;
      return getFfmpegStatus();
    }

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

async function generateVideoThumbnail(nodeId) {
  let tempVideoPath = null;
  let tempFramePath = null;

  try {
    const status = await initFfmpegOnce();
    if (!status.available) {
      return null;
    }

    const { getComposition } = require('../../../service/composition');
    const { blobStorageService, fileNodeService } = getComposition();
    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      return null;
    }

    const buffer = await blobStorageService.downloadBlob(nodeId);
    if (!buffer || buffer.length === 0) {
      throw createError(SERVER_ERROR_CODES.thumbnail.videoDownloadFailed, 500);
    }

    const { getDataDir } = require('../../../utils/paths');
    const dataDir = path.resolve(getDataDir());
    const tempDir = path.resolve(path.join(dataDir, 'temp'));

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const videoHash = crypto.createHash('md5').update(String(nodeId)).digest('hex');
    tempVideoPath = path.resolve(path.join(tempDir, `${videoHash}_temp_video`));
    tempFramePath = path.resolve(path.join(tempDir, `${videoHash}_temp_frame.jpg`));

    const ext = path.extname(node.name).toLowerCase();
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
          reject(
            createError(SERVER_ERROR_CODES.thumbnail.ffmpegFailed, 500, { reason: err.message })
          );
        });
    });

    if (!fs.existsSync(tempFramePath)) {
      throw createError(SERVER_ERROR_CODES.thumbnail.frameExtractionFailed, 500);
    }
    const frameBuffer = fs.readFileSync(tempFramePath);
    // MAX_THUMBNAIL_SIZE is T2 (lazy): read the effective value per request.
    const maxSize = parseInt(await getSharedResolver().getConfig('MAX_THUMBNAIL_SIZE'), 10) || 300;
    const thumbnailBuffer = await sharp(frameBuffer)
      .resize(maxSize, maxSize, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();

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

module.exports = { generateVideoThumbnail, initFfmpegOnce, getFfmpegStatus };
