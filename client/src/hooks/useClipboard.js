import { useState, useCallback } from 'react';

/**
 * 클립보드 복사 기능을 위한 커스텀 훅
 * @param {object} options - 옵션 객체
 * @param {function} options.onSuccess - 복사 성공 시 콜백 (메시지 전달)
 * @param {function} options.onError - 복사 실패 시 콜백 (에러 전달)
 * @param {string} options.successMessage - 성공 메시지 (기본값: '클립보드에 복사되었습니다.')
 * @param {number} options.resetDelay - 복사 상태 리셋 딜레이 (기본값: 2000ms)
 * @returns {object} { copy, copied, copiedValue }
 */
const useClipboard = (options = {}) => {
  const { 
    onSuccess, 
    onError, 
    successMessage = '클립보드에 복사되었습니다.',
    resetDelay = 2000 
  } = options;
  
  const [copied, setCopied] = useState(false);
  const [copiedValue, setCopiedValue] = useState(null);
  
  const copy = useCallback(async (text, identifier) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopiedValue(identifier || text);
      
      setTimeout(() => {
        setCopied(false);
        setCopiedValue(null);
      }, resetDelay);
      
      onSuccess?.(successMessage);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      onError?.(error);
    }
  }, [onSuccess, onError, successMessage, resetDelay]);
  
  return { copy, copied, copiedValue };
};

export default useClipboard;
