const { getFileType } = require('@webdav-easyaccess/shared/fileTypes');

function isImageFile(filename) {
  return getFileType(filename) === 'image';
}

function isVideoFile(filename) {
  return getFileType(filename) === 'video';
}

module.exports = { isImageFile, isVideoFile };
