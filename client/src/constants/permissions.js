/**
 * Permission level constants
 */

export const PERMISSIONS = {
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
