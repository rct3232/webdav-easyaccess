import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
} from '@mui/icons-material';

export const getFileIcon = (file) => {
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

export const getFileIconForGrid = (file) => {
  if (file.type === 'directory') {
    return <FolderIcon sx={{ fontSize: 48, color: 'primary.main' }} />;
  }
  return <FileIcon sx={{ fontSize: 48, color: 'text.secondary' }} />;
};

export const getThumbnail = (file) => {
  return file.thumbnailUrl || null;
};
