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
const isUserOwnFolder = (nodeId, user) => {
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
