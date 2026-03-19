import { getParentPath, normalizePath } from '../../../../../utils/pathUtils';

/**
 * Pure invalid-destination validator for FolderPickerDialog.
 * Returns whether the selectedPath is an invalid copy/move destination.
 */
export function isInvalidFolderPickerDestination({
  action,
  selectedPath,
  sourceFilePath,
  sourceFilePaths,
}) {
  if (action !== 'copy' && action !== 'move') return false;

  const normalizedSelectedPath = normalizePath(selectedPath);
  const sourcePaths = sourceFilePath ? [sourceFilePath] : (sourceFilePaths || []);

  return sourcePaths.some((path) => {
    const normalizedSourcePath = normalizePath(path);

    // Destination is the parent of source (e.g. moving /folder1/file.txt -> /folder1).
    if (getParentPath(normalizedSourcePath) === normalizedSelectedPath) return true;

    // Destination is the source itself or a descendant of source.
    if (
      normalizedSelectedPath === normalizedSourcePath
      || normalizedSelectedPath.startsWith(normalizedSourcePath + '/')
    ) {
      return true;
    }

    return false;
  });
}

