import React from 'react';
import { MenuItem, Box } from '@mui/material';

/**
 * 메뉴 내 구분선 컴포넌트
 */
const MenuDivider = () => (
  <MenuItem disabled sx={{ py: 0 }}>
    <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
  </MenuItem>
);

export default MenuDivider;
