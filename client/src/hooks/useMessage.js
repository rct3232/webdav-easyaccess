/**
 * Unified message display hook
 * Provides consistent message handling across components
 */

import { useState, useCallback } from 'react';

/**
 * Message hook for unified message display
 * @param {Object} options - Hook options
 * @param {number} options.defaultDuration - Default message duration in ms
 * @param {number} options.successDuration - Success message duration in ms
 * @param {number} options.errorDuration - Error message duration in ms
 * @returns {Object} Message state and handlers
 */
export const useMessage = (options = {}) => {
  const {
    defaultDuration = 3000,
    successDuration = 3000,
    errorDuration = 5000,
  } = options;

  const [message, setMessage] = useState({
    show: false,
    text: '',
    type: 'success', // 'success' | 'error' | 'warning' | 'info'
  });

  /**
   * Show a message
   * @param {string} text - Message text
   * @param {string} type - Message type
   * @param {number} duration - Duration in milliseconds
   */
  const showMessage = useCallback((text, type = 'success', duration = null) => {
    const messageDuration = duration !== null 
      ? duration 
      : (type === 'error' ? errorDuration : type === 'success' ? successDuration : defaultDuration);

    setMessage({
      show: true,
      text,
      type,
    });

    if (messageDuration > 0) {
      setTimeout(() => {
        setMessage(prev => ({ ...prev, show: false }));
      }, messageDuration);
    }
  }, [defaultDuration, successDuration, errorDuration]);

  /**
   * Show success message
   * @param {string} text - Message text
   * @param {number} duration - Duration in milliseconds
   */
  const showSuccess = useCallback((text, duration = null) => {
    showMessage(text, 'success', duration);
  }, [showMessage]);

  /**
   * Show error message
   * @param {string} text - Message text
   * @param {number} duration - Duration in milliseconds
   */
  const showError = useCallback((text, duration = null) => {
    showMessage(text, 'error', duration);
  }, [showMessage]);

  /**
   * Show warning message
   * @param {string} text - Message text
   * @param {number} duration - Duration in milliseconds
   */
  const showWarning = useCallback((text, duration = null) => {
    showMessage(text, 'warning', duration);
  }, [showMessage]);

  /**
   * Show info message
   * @param {string} text - Message text
   * @param {number} duration - Duration in milliseconds
   */
  const showInfo = useCallback((text, duration = null) => {
    showMessage(text, 'info', duration);
  }, [showMessage]);

  /**
   * Clear message
   */
  const clearMessage = useCallback(() => {
    setMessage({
      show: false,
      text: '',
      type: 'success',
    });
  }, []);

  /**
   * Show error from error object
   * @param {Error} error - Error object
   * @param {string} defaultMsg - Default error message
   * @param {number} duration - Duration in milliseconds
   */
  const showErrorFromError = useCallback((error, defaultMsg = '오류가 발생했습니다', duration = null) => {
    let errorMsg = defaultMsg;
    
    if (error?.response?.data?.error) {
      errorMsg = error.response.data.error;
    } else if (error?.message) {
      errorMsg = error.message;
    }
    
    showError(errorMsg, duration);
  }, [showError]);

  return {
    message,
    showMessage,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showErrorFromError,
    clearMessage,
  };
};
