/**
 * fileViewUtils tests: renderProcessingIcon, getFileItemState, getDropTargetStyles.
 * Verify observable output per spec (icon type, state object, sx object).
 * @see docs/spec/client/utils/fileViewUtils.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { DriveFileMove as MoveIcon, ContentCopy as CopyIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { renderProcessingIcon, getFileItemState, getDropTargetStyles, getEntryKey } from '../fileViewUtils';

describe('fileViewUtils', () => {
  describe('getEntryKey', () => {
    it('returns nodeId when present', () => {
      expect(getEntryKey({ nodeId: 5, path: '/a' })).toBe(5);
    });

    it('falls back to path when nodeId is missing (recent-file entries)', () => {
      expect(getEntryKey({ path: '/recent.txt' })).toBe('/recent.txt');
    });

    it('returns undefined for null/empty input', () => {
      expect(getEntryKey(null)).toBeUndefined();
      expect(getEntryKey({})).toBeUndefined();
    });
  });

  describe('renderProcessingIcon', () => {
    it('returns Move icon for "move"', () => {
      const el = renderProcessingIcon('move');
      expect(React.isValidElement(el)).toBe(true);
      expect(el.type).toBe(MoveIcon);
    });

    it('returns Copy icon for "copy"', () => {
      const el = renderProcessingIcon('copy');
      expect(el.type).toBe(CopyIcon);
    });

    it('returns Delete icon for "delete"', () => {
      const el = renderProcessingIcon('delete');
      expect(el.type).toBe(DeleteIcon);
    });

    it('returns null for other type', () => {
      expect(renderProcessingIcon('other')).toBe(null);
      expect(renderProcessingIcon()).toBe(null);
    });
  });

  describe('getFileItemState', () => {
    it('sets isSelected when selectionMode and nodeId in selectedFiles', () => {
      const file = { nodeId: 1, path: '/a', type: 'file' };
      const selectedFiles = new Set([1]);
      const result = getFileItemState(file, true, selectedFiles, new Map());

      expect(result.isSelected).toBe(true);
      expect(result.isDisabled).toBe(false);
      expect(result.isProcessing).toBe(false);
    });

    it('sets isSelected via path fallback for entries without nodeId', () => {
      const file = { path: '/recent.txt', type: 'file' };
      const selectedFiles = new Set(['/recent.txt']);
      const result = getFileItemState(file, true, selectedFiles, new Map());

      expect(result.isSelected).toBe(true);
    });

    it('sets isSelected false when not in selectedFiles', () => {
      const result = getFileItemState(
        { nodeId: 2, path: '/b', type: 'file' },
        true,
        new Set([1]),
        new Map()
      );
      expect(result.isSelected).toBe(false);
    });

    it('sets isPermissionDisabled for directory without read permission', () => {
      const result = getFileItemState(
        { nodeId: 3, path: '/d', type: 'directory', hasReadPermission: false },
        false,
        new Set(),
        new Map()
      );
      expect(result.isPermissionDisabled).toBe(true);
      expect(result.isDisabled).toBe(true);
    });

    it('sets isProcessing and isDisabled when nodeId in processingMap', () => {
      const file = { nodeId: 7, path: '/f', type: 'file' };
      const processingMap = new Map([[7, 'move']]);
      const result = getFileItemState(file, false, new Set(), processingMap);

      expect(result.isProcessing).toBe(true);
      expect(result.processingType).toBe('move');
      expect(result.isDisabled).toBe(true);
    });

    it('does not treat a path-keyed processingMap entry as processing for a nodeId-keyed file', () => {
      const file = { nodeId: 7, path: '/f', type: 'file' };
      const processingMap = new Map([['/f', 'move']]);
      const result = getFileItemState(file, false, new Set(), processingMap);

      expect(result.isProcessing).toBe(false);
    });

    it('handles null/undefined processingMap', () => {
      const result = getFileItemState(
        { nodeId: 5, path: '/x', type: 'file' },
        false,
        new Set(),
        null
      );
      expect(result.isProcessing).toBe(false);
    });

    it('handles null selectedFiles as not selected', () => {
      const result = getFileItemState(
        { nodeId: 5, path: '/x', type: 'file' },
        true,
        null,
        new Map()
      );
      expect(result.isSelected).toBe(false);
    });
  });

  describe('getDropTargetStyles', () => {
    it('returns sx object with primary.main when isDropTarget true', () => {
      const sx = getDropTargetStyles(true);
      expect(sx).toHaveProperty('backgroundColor', 'primary.main');
      expect(sx).toHaveProperty('color', 'white');
    });

    it('returns empty object when isDropTarget false', () => {
      expect(getDropTargetStyles(false)).toEqual({});
    });
  });
});
