import React, { useState } from 'react';
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

const FileDetail = ({ files, onFileClick, onContextMenu, onFileDrop }) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
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

  const handleDragStart = (e, file) => {
    setDraggedFile(file);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', file.path);
  };

  const handleDragEnd = () => {
    setDraggedFile(null);
    setDropTarget(null);
  };

  const handleDragOver = (e, file) => {
    // Only allow drop on folders and not on the dragged file itself
    if (file.type === 'directory' && draggedFile?.path !== file.path) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(file.path);
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e, targetFolder) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedFile && targetFolder.type === 'directory' && draggedFile.path !== targetFolder.path) {
      onFileDrop && onFileDrop(draggedFile, targetFolder);
    }
    
    setDraggedFile(null);
    setDropTarget(null);
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
          {files.map((file, index) => {
            const isDragging = draggedFile?.path === file.path;
            const isDropTarget = dropTarget === file.path;
            
            return (
              <TableRow
                key={index}
                draggable
                hover
                sx={{ 
                  cursor: 'move',
                  opacity: isDragging ? 0.5 : 1,
                  backgroundColor: isDropTarget ? 'primary.light' : 'transparent',
                  transition: 'all 0.2s',
                }}
                onClick={() => onFileClick(file)}
                onContextMenu={(e) => onContextMenu(e, file)}
                onDragStart={(e) => handleDragStart(e, file)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, file)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, file)}
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
            );
          })}
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

