import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
  IconButton,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
} from '@mui/icons-material';
import { formatFileSize, formatDate } from '../utils/format';

const FileDetail = ({ files, onFileClick, onContextMenu }) => {
  const getFileIcon = (file) => {
    if (file.type === 'directory') {
      return <FolderIcon color="primary" />;
    }
    if (file.mime?.startsWith('image/')) {
      return <ImageIcon />;
    }
    if (file.mime?.startsWith('video/')) {
      return <VideoIcon />;
    }
    return <FileIcon />;
  };

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>이름</TableCell>
            <TableCell>유형</TableCell>
            <TableCell align="right">크기</TableCell>
            <TableCell>수정 날짜</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {files.map((file, index) => (
            <TableRow
              key={index}
              hover
              sx={{ cursor: 'pointer' }}
              onClick={() => onFileClick(file)}
              onContextMenu={(e) => onContextMenu(e, file)}
            >
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {getFileIcon(file)}
                  <Typography variant="body2">{file.basename}</Typography>
                </Box>
              </TableCell>
              <TableCell>{file.type === 'directory' ? '폴더' : file.mime || '-'}</TableCell>
              <TableCell align="right">
                {file.type === 'directory' ? '-' : formatFileSize(file.size)}
              </TableCell>
              <TableCell>{formatDate(file.lastmod)}</TableCell>
            </TableRow>
          ))}
          {files.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="text.secondary">파일이 없습니다</Typography>
                </Box>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default FileDetail;

