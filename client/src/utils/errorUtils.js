/**
 * Error message handling utilities
 * Provides common functions for displaying error and success messages
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

/**
 * Show error message using setDropMessage
 * @param {Function} setDropMessage - State setter for drop message
 * @param {Error} error - Error object
 * @param {string} defaultMsg - Default message if error message cannot be extracted
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
export const showErrorMessage = (setDropMessage, error, defaultMsg = '오류가 발생했습니다', duration = 5000) => {
  const errorMsg = getErrorMessage(error, defaultMsg);
  setDropMessage({
    show: true,
    text: errorMsg,
    type: 'error',
  });
  
  setTimeout(() => {
    setDropMessage({ show: false, text: '', type: 'success' });
  }, duration);
};

/**
 * Show success message using setDropMessage
 * @param {Function} setDropMessage - State setter for drop message
 * @param {string} message - Success message
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export const showSuccessMessage = (setDropMessage, message, duration = 3000) => {
  setDropMessage({
    show: true,
    text: message,
    type: 'success',
  });
  
  setTimeout(() => {
    setDropMessage({ show: false, text: '', type: 'success' });
  }, duration);
};

/**
 * Show message using onMessage callback (for components that use onMessage prop)
 * @param {Function} onMessage - Message callback function
 * @param {string} text - Message text
 * @param {string} type - Message type ('success' or 'error')
 * @param {number} duration - Duration in milliseconds
 */
export const showMessage = (onMessage, text, type = 'success', duration = type === 'error' ? 5000 : 3000) => {
  if (!onMessage) return;
  
  onMessage({
    show: true,
    text,
    type,
  });
  
  setTimeout(() => {
    onMessage({ show: false, text: '', type: 'success' });
  }, duration);
};
