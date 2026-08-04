/**
 * Pure breadcrumbs derivation for FolderPickerDialog.
 * No React hooks, gateways, or side effects.
 */
export function buildFolderPickerBreadcrumbs({
  selectedPath,
  user,
  homePath,
  homeLabel,
  sharedPermissionNodeIds: _sharedPermissionNodeIds,
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
      if (!user?.is_admin && index === 1 && crumb.name === user?.username) return false;
      return true;
    });
  } else {
    const pathParts = selectedPath.split('/').filter(Boolean);
    breadcrumbs = [
      { name: sharedLabel, path: '/__shared__' },
      ...pathParts.map((part, index) => ({
        name: part,
        path: '/' + pathParts.slice(0, index + 1).join('/'),
      })),
    ];
  }

  return breadcrumbs;
}

