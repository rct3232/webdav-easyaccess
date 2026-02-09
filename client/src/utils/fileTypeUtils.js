/**
 * 파일 타입 유틸리티
 * 확장자 목록 단일 소스 (미리보기/썸네일 판별에 재사용)
 */

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
export const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'xml', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'java', 'c', 'cpp', 'h', 'sh'];

/**
 * 파일 타입 판단
 * @param {string} filename - 파일명
 * @returns {string} 파일 타입 ('image', 'video', 'audio', 'pdf', 'text', 'unknown')
 */
export const getFileType = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';

  return 'unknown';
};
