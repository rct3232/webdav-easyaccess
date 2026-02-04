import { useState, useCallback } from 'react';

/**
 * 메뉴 앵커 상태 관리를 위한 커스텀 훅
 * @returns {object} { anchorEl, isOpen, open, close }
 */
const useMenuAnchor = () => {
  const [anchorEl, setAnchorEl] = useState(null);
  
  const open = useCallback((e) => {
    setAnchorEl(e.currentTarget);
  }, []);
  
  const close = useCallback(() => {
    setAnchorEl(null);
  }, []);
  
  const isOpen = Boolean(anchorEl);
  
  return { anchorEl, isOpen, open, close };
};

export default useMenuAnchor;
