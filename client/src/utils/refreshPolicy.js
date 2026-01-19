/**
 * Refresh policy for async file operations.
 *
 * Goal: prevent stale-closure refreshes from reloading the wrong directory
 * after the user navigates elsewhere.
 */

export const normalizePath = (path) => {
  if (!path) return '/';
  if (path === '/') return '/';
  // Keep shared marker path stable
  if (path === '/__shared__') return '/__shared__';
  if (path.startsWith('/__shared__/')) {
    // trim trailing slash only
    return path.endsWith('/') ? path.slice(0, -1) : path;
  }
  return path.endsWith('/') ? path.slice(0, -1) : path;
};

/**
 * Decide whether to refresh the file list after an operation completes.
 *
 * Rules:
 * - If user didn't navigate (current === started): refresh.
 * - For move/copy: if user navigated to the target folder: refresh.
 * - For non move/copy: if user navigated away: do NOT refresh.
 */
export const shouldRefreshAfterOperation = ({
  opType,
  startedPath,
  currentPathNow,
  targetPath,
}) => {
  const op = opType || 'refresh';
  const started = normalizePath(startedPath);
  const current = normalizePath(currentPathNow);
  const target = targetPath ? normalizePath(targetPath) : null;

  if (op === 'move' || op === 'copy') {
    return current === started || (target ? current === target : false);
  }

  return current === started;
};

