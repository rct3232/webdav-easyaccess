const storage = require('./storage');
const { normalizeWebdavPath } = require('./metaPaths');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { mapDatabaseError } = require('../utils/errorHandler');

const RECENT_FILES_DIR = '/.wea/recent-files/';
const MAX_RECENT_FILES = 20;

/**
 * Generate recent file path for a user
 * @param {number} userId - User ID
 * @returns {string} WebDAV path
 */
function getUserRecentFilesPath(userId) {
  return normalizeWebdavPath(`${RECENT_FILES_DIR}${userId}.json`);
}

function isPostgresqlBackend() {
  return storage.getBackend() === 'postgresql';
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRecentFileRow(row) {
  return {
    path: normalizePath(row.path),
    name: row.name,
    type: row.type,
    lastAccessed: toIsoString(row.last_accessed),
  };
}

async function listRecentFilesPg(userId, client = null) {
  const executor = client || storage.getPgPool();
  const res = await executor.query(
    `SELECT path, name, type, last_accessed
       FROM recent_files
      WHERE user_id = $1
      ORDER BY last_accessed DESC`,
    [Number(userId)]
  );
  return res.rows.map(mapRecentFileRow);
}

async function replaceRecentFilesPg(userId, files, client) {
  const userIdNum = Number(userId);
  await client.query(`DELETE FROM recent_files WHERE user_id = $1`, [userIdNum]);
  for (const item of files) {
    await client.query(
      `INSERT INTO recent_files (user_id, path, name, type, last_accessed)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userIdNum,
        normalizePath(item.path),
        item.name || normalizePath(item.path).split('/').pop() || '',
        item.type || 'file',
        item.lastAccessed || new Date().toISOString(),
      ]
    );
  }
}

/**
 * Get user's recent files list
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Recent files list
 */
async function getUserRecentFiles(userId) {
  if (isPostgresqlBackend()) {
    try {
      return await listRecentFilesPg(userId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    // Check directory existence and create if needed
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    
    const filePath = getUserRecentFilesPath(userId);
    const exists = await storage.exists(filePath);
    
    if (!exists) {
      return [];
    }
    
    const content = await storage.readFile(filePath);
    const files = JSON.parse(content);
    return Array.isArray(files) ? files : [];
  } catch (error) {
    // Return empty array if file doesn't exist or parsing fails
    console.error('Failed to get user recent files:', error);
    return [];
  }
}

/**
 * Add a recent file
 * @param {number} userId - User ID
 * @param {Object} fileData - File info { path, name, type }
 * @returns {Promise<Array>} Updated recent files list
 */
async function addRecentFile(userId, fileData) {
  if (isPostgresqlBackend()) {
    const userIdNum = Number(userId);
    const normalizedNewPath = normalizePath(fileData.path);
    const name = fileData.name || fileData.basename || normalizedNewPath.split('/').pop();
    const type = fileData.type || 'file';

    try {
      return await storage.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO recent_files (user_id, path, name, type, last_accessed)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id, path)
           DO UPDATE SET
             name = EXCLUDED.name,
             type = EXCLUDED.type,
             last_accessed = NOW()`,
          [userIdNum, normalizedNewPath, name, type]
        );

        await client.query(
          `DELETE FROM recent_files
            WHERE user_id = $1
              AND path IN (
                SELECT path
                  FROM recent_files
                 WHERE user_id = $1
                 ORDER BY last_accessed DESC
                 OFFSET $2
              )`,
          [userIdNum, MAX_RECENT_FILES]
        );

        return await listRecentFilesPg(userIdNum, client);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    // Check directory existence and create if needed
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    
    const files = await getUserRecentFiles(userId);
    
    // Normalize path
    const normalizedNewPath = normalizePath(fileData.path);
    
    // Remove duplicates (compare by normalized path)
    const filtered = files.filter(f => {
      const normalizedExistingPath = normalizePath(f.path);
      return normalizedExistingPath !== normalizedNewPath;
    });
    
    // Add new file at the front
    const newFiles = [
      {
        path: normalizedNewPath, // Store as normalized path
        name: fileData.name || fileData.basename || normalizedNewPath.split('/').pop(),
        type: fileData.type || 'file',
        lastAccessed: new Date().toISOString(),
      },
      ...filtered,
    ].slice(0, MAX_RECENT_FILES);
    
    const filePath = getUserRecentFilesPath(userId);
    await storage.writeFile(filePath, JSON.stringify(newFiles, null, 2), { overwrite: true });
    
    return newFiles;
  } catch (error) {
    console.error('Failed to add recent file:', error);
    throw error;
  }
}

/**
 * Remove a recent file
 * @param {number} userId - User ID
 * @param {string} filePath - File path
 * @returns {Promise<Array>} Updated recent file list
 */
async function removeRecentFile(userId, targetPath) {
  if (isPostgresqlBackend()) {
    const userIdNum = Number(userId);
    const normalizedTargetPath = normalizePath(targetPath);
    try {
      return await storage.withTransaction(async (client) => {
        await client.query(
          `DELETE FROM recent_files
            WHERE user_id = $1
              AND path = $2`,
          [userIdNum, normalizedTargetPath]
        );
        return await listRecentFilesPg(userIdNum, client);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    const files = await getUserRecentFiles(userId);
    // Normalize path for comparison
    const normalizedTargetPath = normalizePath(targetPath);
    const filtered = files.filter(f => {
      const normalizedExistingPath = normalizePath(f.path);
      return normalizedExistingPath !== normalizedTargetPath;
    });
    
    const userFilePath = getUserRecentFilesPath(userId);
    await storage.writeFile(userFilePath, JSON.stringify(filtered, null, 2), { overwrite: true });
    
    return filtered;
  } catch (error) {
    console.error('Failed to remove recent file:', error);
    throw error;
  }
}

/**
 * Clear recent files list
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
async function clearRecentFiles(userId) {
  if (isPostgresqlBackend()) {
    try {
      await storage.withTransaction(async (client) => {
        await client.query(`DELETE FROM recent_files WHERE user_id = $1`, [Number(userId)]);
      });
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    const filePath = getUserRecentFilesPath(userId);
    await storage.deletePath(filePath);
  } catch (error) {
    // Do not treat missing file as an error
    if (error.message && !error.message.includes('not found')) {
      console.error('Failed to clear recent files:', error);
      throw error;
    }
  }
}

/**
 * Apply batch moves (reflect N moves in a single read/write)
 * @param {number} userId - User ID
 * @param {Array<{ oldPath: string, newPath: string, file?: { type?: string, name?: string, basename?: string } }>} moves
 * @returns {Promise<Array>} Updated recent file list
 */
async function applyBulkMove(userId, moves) {
  if (isPostgresqlBackend()) {
    if (!moves || moves.length === 0) return await getUserRecentFiles(userId);
    try {
      return await storage.withTransaction(async (client) => {
        let files = await listRecentFilesPg(userId, client);

        for (const { oldPath, newPath, file } of moves) {
          const oldNorm = normalizePath(oldPath);
          const newNorm = normalizePath(newPath);
          const isDir = file?.type === 'directory';

          if (isDir) {
            const toReAdd = [];
            files = files.filter((f) => {
              const p = normalizePath(f.path);
              if (p === oldNorm || p.startsWith(oldNorm + '/')) {
                const rel = p === oldNorm ? '' : p.slice(oldNorm.length);
                toReAdd.push({ ...f, path: newNorm + rel });
                return false;
              }
              return true;
            });
            const now = new Date().toISOString();
            for (const f of toReAdd) {
              if (f.type === 'directory') continue;
              files.unshift({ ...f, lastAccessed: now });
            }
          } else {
            files = files.filter((f) => normalizePath(f.path) !== oldNorm);
            const name = file?.name || file?.basename || newNorm.split('/').pop();
            files.unshift({
              path: newNorm,
              name,
              type: file?.type || 'file',
              lastAccessed: new Date().toISOString(),
            });
          }
        }

        const seen = new Set();
        const deduped = files.filter((f) => {
          const p = normalizePath(f.path);
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });
        const result = deduped.slice(0, MAX_RECENT_FILES);
        await replaceRecentFilesPg(userId, result, client);
        return result;
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (!moves || moves.length === 0) return await getUserRecentFiles(userId);
  try {
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    let files = await getUserRecentFiles(userId);

    for (const { oldPath, newPath, file } of moves) {
      const oldNorm = normalizePath(oldPath);
      const newNorm = normalizePath(newPath);
      const isDir = file?.type === 'directory';

      if (isDir) {
        const toReAdd = [];
        files = files.filter((f) => {
          const p = normalizePath(f.path);
          if (p === oldNorm || p.startsWith(oldNorm + '/')) {
            const rel = p === oldNorm ? '' : p.slice(oldNorm.length);
            toReAdd.push({ ...f, path: newNorm + rel });
            return false;
          }
          return true;
        });
        const now = new Date().toISOString();
        for (const f of toReAdd) {
          if (f.type === 'directory') continue;
          files.unshift({ ...f, lastAccessed: now });
        }
      } else {
        files = files.filter((f) => normalizePath(f.path) !== oldNorm);
        const name = file?.name || file?.basename || newNorm.split('/').pop();
        files.unshift({
          path: newNorm,
          name,
          type: file?.type || 'file',
          lastAccessed: new Date().toISOString(),
        });
      }
    }

    const seen = new Set();
    const deduped = files.filter((f) => {
      const p = normalizePath(f.path);
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    const result = deduped.slice(0, MAX_RECENT_FILES);
    const filePath = getUserRecentFilesPath(userId);
    await storage.writeFile(filePath, JSON.stringify(result, null, 2), { overwrite: true });
    return result;
  } catch (error) {
    console.error('Failed to apply bulk move to recent files:', error);
    throw error;
  }
}

/**
 * Apply batch removals (reflect N deletions in a single read/write)
 * @param {number} userId - User ID
 * @param {string[]} filePaths - Array of file/folder paths to remove (fully deleted items)
 * @param {string[]} folderPaths - Array of folder paths to remove (also removes sub-paths, subset of filePaths)
 * @returns {Promise<Array>} Updated recent file list
 */
async function removePaths(userId, filePaths = [], folderPaths = []) {
  if (isPostgresqlBackend()) {
    if (!filePaths.length && !folderPaths.length) return await getUserRecentFiles(userId);
    try {
      return await storage.withTransaction(async (client) => {
        let files = await listRecentFilesPg(userId, client);
        const filePathsSet = new Set((filePaths || []).map((p) => normalizePath(p)));
        const folderPathsNorm = (folderPaths || []).map((p) => normalizePath(p));

        files = files.filter((f) => {
          const p = normalizePath(f.path);
          if (filePathsSet.has(p)) return false;
          for (const folder of folderPathsNorm) {
            if (p === folder || p.startsWith(folder + '/')) return false;
          }
          return true;
        });

        await replaceRecentFilesPg(userId, files, client);
        return files;
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (!filePaths.length && !folderPaths.length) return await getUserRecentFiles(userId);
  try {
    await storage.ensureDirSafe(RECENT_FILES_DIR);
    let files = await getUserRecentFiles(userId);
    const filePathsSet = new Set((filePaths || []).map((p) => normalizePath(p)));
    const folderPathsNorm = (folderPaths || []).map((p) => normalizePath(p));

    files = files.filter((f) => {
      const p = normalizePath(f.path);
      if (filePathsSet.has(p)) return false;
      for (const folder of folderPathsNorm) {
        if (p === folder || p.startsWith(folder + '/')) return false;
      }
      return true;
    });

    const filePath = getUserRecentFilesPath(userId);
    await storage.writeFile(filePath, JSON.stringify(files, null, 2), { overwrite: true });
    return files;
  } catch (error) {
    console.error('Failed to remove paths from recent files:', error);
    throw error;
  }
}

module.exports = {
  getUserRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  applyBulkMove,
  removePaths,
};
