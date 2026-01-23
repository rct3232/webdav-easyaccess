/**
 * Error message handling utilities
 * Provides common functions for extracting error messages
 * Note: For displaying messages, use useMessage hook instead
 */

/**
 * Extract error message from error object
 * @param {Error} error - Error object
 * @param {string} defaultMsg - Default message if error message cannot be extracted
 * @returns {string} Error message
 */
export const getErrorMessage = (error, defaultMsg = '오류가 발생했습니다') => {
  if (!error) return defaultMsg;
  
  // Check for axios error response
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  
  // Check for error message
  if (error.message) {
    return error.message;
  }
  
  return defaultMsg;
};
