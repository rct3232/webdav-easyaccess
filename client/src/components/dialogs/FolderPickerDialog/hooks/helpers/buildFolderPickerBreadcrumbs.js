import { normalizePath } from '../../../../../utils/pathUtils';

/**
 * Pure breadcrumbs derivation for FolderPickerDialog.
 * No React hooks, gateways, or side effects.
 */
export function buildFolderPickerBreadcrumbs({
  selectedPath,
  user,
  homePath,
  homeLabel,
  sharedPermissionPaths,
  sharedLabel,
}) {
  const isHomePath = user?.is_admin
    ? (selectedPath?.startsWith('/') && selectedPath !== '/__shared__')
    : (selectedPath === homePath || selectedPath.startsWith(homePath + '/'));

  let breadcrumbs = [];

  if (selectedPath === '/__shared__') {
    breadcrumbs = [{ name: sharedLabel, path: '/__shared__' }];
  } else if (isHomePath) {
    const pathParts = selectedPath.split('/').filter(Boolean);
    breadcrumbs = [
      { name: homeLabel, path: homePath },
      ...pathParts.map((part, index) => ({
        name: part,
        path: '/' + pathParts.slice(0, index + 1).join('/'),
      })),
    ].filter((crumb, index) => {
      // For non-admins, hide the repeated "username" segment under home.
      if (!user?.is_admin && index === 1 && crumb.name === user?.username) return false;
      return true;
    });
  } else {
    const normalizedSelectedPath = normalizePath(selectedPath);
    const pathParts = normalizedSelectedPath.split('/').filter(Boolean);

    let startIndex = -1;
    for (let i = 0; i < pathParts.length; i++) {
      const testPath = '/' + pathParts.slice(0, i + 1).join('/');
      if (sharedPermissionPaths?.has(testPath)) {
        startIndex = i;
        break;
      }
    }

    if (startIndex >= 0) {
      breadcrumbs = [
        { name: sharedLabel, path: '/__shared__' },
        ...pathParts.slice(startIndex).map((part, index) => ({
          name: part,
          path: '/' + pathParts.slice(0, startIndex + index + 1).join('/'),
        })),
      ];
    } else {
      breadcrumbs = [
        { name: sharedLabel, path: '/__shared__' },
        ...pathParts.map((part, index) => ({
          name: part,
          path: '/' + pathParts.slice(0, index + 1).join('/'),
        })),
      ];
    }
  }

  return breadcrumbs;
}

