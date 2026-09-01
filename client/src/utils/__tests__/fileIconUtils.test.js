/**
 * fileIconUtils tests: getFileIcon, getFileIconForGrid, getThumbnail.
 * Verify returned element type and thumbnail value per file shape.
 * @see docs/spec/client/utils/fileIconUtils.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
} from '@mui/icons-material';
import { getFileIcon, getFileIconForGrid, getThumbnail } from '../fileIconUtils';

describe('fileIconUtils', () => {
  describe('getFileIcon', () => {
    it('returns Folder icon for directory', () => {
      const el = getFileIcon({ type: 'directory' });
      expect(React.isValidElement(el)).toBe(true);
      expect(el.type).toBe(FolderIcon);
    });

    it('returns Image icon for image mime', () => {
      const el = getFileIcon({ type: 'file', mime: 'image/png' });
      expect(el.type).toBe(ImageIcon);
    });

    it('returns Video icon for video mime', () => {
      const el = getFileIcon({ type: 'file', mime: 'video/mp4' });
      expect(el.type).toBe(VideoIcon);
    });

    it('returns File icon by default', () => {
      const el = getFileIcon({ type: 'file' });
      expect(el.type).toBe(FileIcon);
    });

    it('returns File icon when mime/type missing', () => {
      const el = getFileIcon({});
      expect(el.type).toBe(FileIcon);
    });
  });

  describe('getFileIconForGrid', () => {
    it('returns Folder with 48px for directory', () => {
      const el = getFileIconForGrid({ type: 'directory' });
      expect(el.type).toBe(FolderIcon);
      expect(el.props.sx).toMatchObject({ fontSize: 48 });
    });

    it('returns File icon with 48px for file', () => {
      const el = getFileIconForGrid({ type: 'file' });
      expect(el.type).toBe(FileIcon);
      expect(el.props.sx).toMatchObject({ fontSize: 48 });
    });
  });

  describe('getThumbnail', () => {
    it('returns thumbnailUrl when present', () => {
      expect(getThumbnail({ thumbnailUrl: 'https://example.com/thumb.jpg' })).toBe(
        'https://example.com/thumb.jpg'
      );
    });

    it('returns null when thumbnailUrl missing', () => {
      expect(getThumbnail({})).toBe(null);
      expect(getThumbnail({ type: 'file' })).toBe(null);
    });
  });
});
