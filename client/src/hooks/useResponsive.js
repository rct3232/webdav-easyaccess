import { useTheme, useMediaQuery } from '@mui/material';

/**
 * Custom hook for responsive design breakpoints
 * Returns boolean values for different screen sizes
 */
export const useResponsive = () => {
  const theme = useTheme();
  
  return {
    isMobile: useMediaQuery(theme.breakpoints.down('sm')),
    isTablet: useMediaQuery(theme.breakpoints.between('sm', 'md')),
    isDesktop: useMediaQuery(theme.breakpoints.up('md')),
    isSmallMobile: useMediaQuery(theme.breakpoints.down('xs')),
  };
};

