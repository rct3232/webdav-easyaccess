import React from 'react';
import { Box, Typography } from '@mui/material';

const PreviewUnsupported = ({ targetFile, t }) => (
  <Box
    sx={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
    }}
  >
    <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
      {t('preview.notSupported')}
    </Typography>
    {targetFile && (
      <>
        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          {t('preview.fileTypeLabel')}{' '}
          {targetFile.name?.split('.').pop()?.toUpperCase() || t('common.unknown')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.6)' }}>
          {t('preview.downloadHint')}
        </Typography>
      </>
    )}
  </Box>
);

export default PreviewUnsupported;
