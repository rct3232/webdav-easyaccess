/**
 * Permission level constants
 */

module.exports = {
  READ: 'read',
  WRITE: 'write',
  ADMIN: 'admin',
  
  // Array of all permission levels
  ALL: ['read', 'write', 'admin'],
  
  // Check if permission is valid
  isValid: (permission) => {
    return ['read', 'write', 'admin'].includes(permission);
  },
};
