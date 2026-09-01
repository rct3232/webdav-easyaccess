import { useState, useCallback } from 'react';

/**
 * 다이얼로그 상태 관리를 위한 커스텀 훅
 * @param {object} options - 옵션 객체
 * @param {function} options.onOpen - 다이얼로그 열릴 때 콜백
 * @param {function} options.onClose - 다이얼로그 닫힐 때 콜백
 * @param {boolean} options.initialState - 초기 상태 (기본값: false)
 * @returns {object} { isOpen, data, open, close, setData }
 */
const useDialog = (options = {}) => {
  const { onOpen, onClose, initialState = false } = options;
  const [isOpen, setIsOpen] = useState(initialState);
  const [data, setData] = useState(null);

  const open = useCallback(
    (openData) => {
      setData(openData);
      setIsOpen(true);
      onOpen?.(openData);
    },
    [onOpen]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setData(null);
    onClose?.();
  }, [onClose]);

  return { isOpen, data, open, close, setData };
};

export default useDialog;
