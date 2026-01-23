/**
 * User status constants
 */

module.exports = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  
  // Array of all statuses
  ALL: ['pending', 'approved', 'rejected'],
  
  // Check if status is valid
  isValid: (status) => {
    return ['pending', 'approved', 'rejected'].includes(status);
  },
};
