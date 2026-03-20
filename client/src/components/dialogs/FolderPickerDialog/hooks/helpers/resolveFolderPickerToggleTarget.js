import { getParentPath, normalizePath } from '../../../../../utils/pathUtils';
import { getUserBaseFolder } from '../../../../../utils/userUtils';

function isMoveOrCopyAction(action) {
  return action === 'copy' || action === 'move';
}

function getNormalizedSourcePaths(sourceFilePath, sourceFilePaths) {
  const rawSourcePaths = sourceFilePath ? [sourceFilePath] : sourceFilePaths || [];
  return rawSourcePaths.map((path) => normalizePath(path));
}

function isSourceInHome({ action, user, sourcePaths }) {
  if (!isMoveOrCopyAction(action) || sourcePaths.length === 0) {
    return false;
  }

  if (user?.is_admin) {
    return sourcePaths.every((path) => path.startsWith('/'));
  }

  const userBaseFolder = getUserBaseFolder(user);
  return sourcePaths.some((path) => path.startsWith(userBaseFolder));
}

function getSharedRootPath(sourcePath, sharedFolderRoots) {
  if (!sourcePath) {
    return null;
  }

  let bestMatch = null;
  let bestMatchLength = -1;

  (sharedFolderRoots || []).forEach((sharedRoot) => {
    const normalizedSharedRoot = normalizePath(sharedRoot);
    const isMatch =
      sourcePath === normalizedSharedRoot
      || sourcePath.startsWith(`${normalizedSharedRoot}/`);

    if (isMatch && normalizedSharedRoot.length > bestMatchLength) {
      bestMatch = normalizedSharedRoot;
      bestMatchLength = normalizedSharedRoot.length;
    }
  });

  if (bestMatch) {
    return bestMatch;
  }

  const pathParts = sourcePath.split('/').filter(Boolean);
  return pathParts.length > 0 ? `/${pathParts[0]}` : null;
}

export function resolveFolderPickerToggleTarget({
  nextPathType,
  action,
  user,
  sourceFilePath,
  sourceFilePaths,
  sharedFolderRoots,
} = {}) {
  if (!nextPathType) {
    return null;
  }

  const homePath = user?.is_admin ? '/' : getUserBaseFolder(user);

  if (!isMoveOrCopyAction(action)) {
    return {
      path: nextPathType === 'shared' ? '/__shared__' : homePath,
      pathType: nextPathType,
      presetHasWritePermission: nextPathType === 'shared' ? true : undefined,
    };
  }

  const sourcePaths = getNormalizedSourcePaths(sourceFilePath, sourceFilePaths);
  const primarySourcePath = sourcePaths[0] || null;
  const sourceIsHome = isSourceInHome({ action, user, sourcePaths });

  if (nextPathType === 'home') {
    const homeTargetPath =
      sourceIsHome && primarySourcePath
        ? getParentPath(primarySourcePath) || homePath
        : homePath;

    return {
      path: normalizePath(homeTargetPath),
      pathType: 'home',
      presetHasWritePermission: undefined,
    };
  }

  if (sourceIsHome) {
    return {
      path: '/__shared__',
      pathType: 'shared',
      presetHasWritePermission: true,
    };
  }

  const sharedRootPath = getSharedRootPath(primarySourcePath, sharedFolderRoots);
  if (!sharedRootPath) {
    return null;
  }

  const sharedTargetPath =
    primarySourcePath ? getParentPath(primarySourcePath) || sharedRootPath : sharedRootPath;

  return {
    path: normalizePath(sharedTargetPath),
    pathType: 'shared',
    presetHasWritePermission: undefined,
  };
}
