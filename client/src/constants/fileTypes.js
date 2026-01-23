/**
 * File type constants
 */

export const FILE_TYPES = {
  DIRECTORY: 'directory',
  FILE: 'file',
};

/**
 * File operation types
 */
export const FILE_OPERATIONS = {
  UPLOAD: 'upload',
  DOWNLOAD: 'download',
  DELETE: 'delete',
  RENAME: 'rename',
  MOVE: 'move',
  COPY: 'copy',
  CREATE_FOLDER: 'createFolder',
};

/**
 * Progress status types
 */
export const PROGRESS_STATUS = {
  PREPARING: 'preparing',
  PROCESSING: 'processing',
  DOWNLOADING: 'downloading',
  UPLOADING: 'uploading',
  COMPLETED: 'completed',
  ERROR: 'error',
  WARNING: 'warning',
};
