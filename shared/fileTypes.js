/**
 * File type and Content-Type utilities.
 * Uses extension constants from shared/constants.js.
 */

const {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  TEXT_EXTENSIONS,
} = require('./constants');

/**
 * Get file type from filename.
 * @param {string} filename - File name
 * @returns {string} 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unknown'
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  return 'unknown';
}

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
};

/**
 * Get Content-Type for filename.
 * @param {string} filename - File name
 * @returns {string} Content-Type
 */
function getContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

module.exports = {
  getFileType,
  getContentType,
};
