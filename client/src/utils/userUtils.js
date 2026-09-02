/**
 * User utility functions
 */

/**
 * Get user's base folder path
 * @param {object} user - User object
 * @returns {string} User's base folder path
 */
export const getUserBaseFolder = (user) => {
  return `/${user?.username || ''}`;
};

/**
 * Check if a nodeId belongs to the user's own root node
 * @param {number} nodeId - Node ID to check
 * @param {object} user - User object ({ rootNodeId })
 * @returns {boolean} true if it is the user's own folder
 */
export const isUserOwnFolder = (nodeId, user) => {
  if (!user || !nodeId) return false;
  return nodeId === user.rootNodeId;
};

/**
 * Filter out user's own folders from permissions list
 * @param {Array} permissions - Permissions array [{ nodeId, permission }, ...]
 * @param {object} user - Current logged-in user ({ rootNodeId })
 * @returns {Array} Filtered permissions array
 */
export const filterOutUserOwnFolders = (permissions, user) => {
  return permissions.filter((perm) => !isUserOwnFolder(perm.nodeId, user));
};

/**
 * Filter users for display in ShareFolderTree and UserSelectionMenu
 *
 * @param {Array} users - User array (entries format: [[userId, permData], ...])
 * @param {object} options - Filter options
 * @param {boolean} options.isAdminMode - Whether admin mode is active
 * @param {string} options.currentUserId - Currently selected user ID (admin mode)
 * @param {object} options.user - Current logged-in user object
 * @param {Map} options.userInfoMap - User info map
 * @param {Array} options.allUsers - All users array
 * @returns {Array} Filtered user array
 */
export const filterDisplayUsers = (users, options = {}) => {
  const { isAdminMode, currentUserId, user, userInfoMap, allUsers } = options;

  if (isAdminMode) {
    return users.filter(([uid]) => uid === currentUserId);
  }

  return users.filter(([targetUserId]) => {
    // Exclude self
    if (user && targetUserId === user.id) return false;

    // Exclude admins
    const userInfo = userInfoMap?.get(targetUserId);
    if (userInfo?.is_admin) return false;

    const fullUser = allUsers?.find((u) => u.id === targetUserId);
    if (fullUser?.is_admin) return false;

    return true;
  });
};

/**
 * Get user display name
 * @param {object} user - User object
 * @returns {string} Display name
 */
export const getUserDisplayName = (user) => {
  if (!user) return '';
  return user.username || user.email || user.id || '';
};
