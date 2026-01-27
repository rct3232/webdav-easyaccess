/**
 * 파일 타입 유틸리티
 */

/**
 * 파일 타입 판단
 * @param {string} filename - 파일명
 * @returns {string} 파일 타입 ('image', 'video', 'audio', 'pdf', 'text', 'unknown')
 */
export const getFileType = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
  const textExts = ['txt', 'md', 'json', 'xml', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'java', 'c', 'cpp', 'h', 'sh'];
  
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (textExts.includes(ext)) return 'text';
  
  return 'unknown';
};
