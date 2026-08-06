import React from 'react';
import { Box } from '@mui/material';
import { canPreview } from '../utils/fileUtils';
import { FilePreviewDialog } from '../components/dialogs';

/**
 * 단일 파일 공유 링크 전용 뷰
 * FilePreviewDialog를 전체 화면으로 고정, 닫기 버튼 미표시
 */
const ShareLinkSingleFileView = ({ token, linkInfo }) => {
  const file = React.useMemo(() => {
    const path = linkInfo?.displayPath || '';
    const name = linkInfo?.fileName || '';
    return {
      path,
      name,
      basename: name,
      canPreview: name ? canPreview(name) : false,
    };
  }, [linkInfo]);

  return (
    <Box sx={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <FilePreviewDialog
        open
        onClose={() => {}}
        file={file}
        mediaFiles={[]}
        shareToken={token}
        hideCloseButton
      />
    </Box>
  );
};

export default ShareLinkSingleFileView;
