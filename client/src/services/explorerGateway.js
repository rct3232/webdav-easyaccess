import { checkConflicts, uploadMultipleFiles } from './fileService';

export const checkConflictsForExplorer = async ({ operations, options } = {}) => {
  return checkConflicts(Array.isArray(operations) ? operations : [], options);
};

export const uploadToPath = async ({
  targetPath = '/',
  files = [],
  onProgress,
  onConflict = 'error',
  options,
} = {}) => {
  return uploadMultipleFiles(files, targetPath, onProgress, onConflict, options);
};

const explorerGateway = {
  checkConflicts: checkConflictsForExplorer,
  uploadToPath,
};

export default explorerGateway;
