import { useState, useCallback } from 'react';
import { getParentPath } from '../utils/pathUtils';

/**
 * Hook for handling drop-to-upload from OS file explorer
 * Supports files and folders with recursive directory structure preservation
 *
 * @param {Object} options - Options object
 * @param {Function} [options.onUploadComplete] - Callback when upload completes (main area)
 * @param {Function} [options.onUploadError] - Callback when upload errors (main area)
 * @param {string} [options.path] - Folder path (folder tree mode)
 * @param {boolean} [options.isDisabled] - Whether the drop zone is disabled (folder tree mode)
 * @param {boolean} [options.hasWritePermission] - Whether the target has write permission (folder tree mode)
 * @param {Function} [options.onExplorerDrop] - Drop handler (folder tree mode)
 * @param {Function} [options.onInternalFileDrop] - Internal drag/drop: (draggedPath, targetFolderPath) when dropped from file manager
 */
export const useDropToUpload = (options = {}) => {
  const {
    onUploadComplete,
    onUploadError,
    path,
    isDisabled = false,
    hasWritePermission = true,
    onExplorerDrop,
    onInternalFileDrop,
    internalDraggedPath,
  } = typeof options === 'object' ? options : { onUploadComplete: options };

  const isFolderMode = path != null && typeof onExplorerDrop === 'function';

  const getDragTypes = (e) => {
    const t = e.dataTransfer?.types || [];
    return { isExternal: t.includes('Files'), isInternal: t.includes('text/plain') };
  };

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const traverseDirectory = useCallback(async (entry, basePath = '') => {
    const files = [];

    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => {
          const relativePath = basePath ? `${basePath}/${file.name}` : file.name;
          files.push({ file, relativePath });
          resolve(files);
        });
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();

      return new Promise((resolve) => {
        const readEntries = () => {
          dirReader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(files);
            } else {
              for (const childEntry of entries) {
                const childPath = basePath ? `${basePath}/${entry.name}` : entry.name;
                const childFiles = await traverseDirectory(childEntry, childPath);
                files.push(...childFiles);
              }
              readEntries();
            }
          });
        };
        readEntries();
      });
    }

    return files;
  }, []);

  const extractFiles = useCallback(
    async (dataTransfer) => {
      const items = Array.from(dataTransfer.items);
      const allFiles = [];

      for (const item of items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.() || item.getAsEntry?.();

          if (entry) {
            const files = await traverseDirectory(entry);
            allFiles.push(...files);
          } else {
            const file = item.getAsFile();
            if (file) {
              allFiles.push({ file, relativePath: file.name });
            }
          }
        }
      }

      return allFiles;
    },
    [traverseDirectory]
  );

  const handleDragEnter = useCallback(
    (e) => {
      if (isFolderMode && (isDisabled || !hasWritePermission)) return;
      if (isFolderMode) {
        const { isExternal, isInternal } = getDragTypes(e);
        if (isExternal) {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(true);
          setIsDropTarget(true);
        } else if (isInternal && onInternalFileDrop) {
          e.preventDefault();
          e.stopPropagation();
          const internalPath = e?.dataTransfer?.getData?.('text/plain');
          const effectiveInternalPath = internalPath || internalDraggedPath;
          const noOp =
            effectiveInternalPath && (getParentPath(effectiveInternalPath) === path || effectiveInternalPath === path);
          if (noOp) {
            // No-op: same folder or drop on self — do not highlight
          } else {
            setIsDraggingOver(true);
            setIsDropTarget(true);
          }
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
      }
    },
    [isFolderMode, isDisabled, hasWritePermission, onInternalFileDrop, path, internalDraggedPath]
  );

  const handleDragOver = useCallback(
    (e) => {
      if (isFolderMode && (isDisabled || !hasWritePermission)) return;
      if (isFolderMode) {
        const { isExternal, isInternal } = getDragTypes(e);
        if (isExternal) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setIsDropTarget(true);
        } else if (isInternal && onInternalFileDrop) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const internalPath = e?.dataTransfer?.getData?.('text/plain');
          const effectiveInternalPath = internalPath || internalDraggedPath;
          const noOp =
            effectiveInternalPath && (getParentPath(effectiveInternalPath) === path || effectiveInternalPath === path);
          if (noOp) {
            // No-op: same folder or drop on self — do not highlight
          } else {
            setIsDropTarget(true);
          }
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [isFolderMode, isDisabled, hasWritePermission, onInternalFileDrop, path, internalDraggedPath]
  );

  const handleDragLeave = useCallback(
    (e) => {
      if (isFolderMode && (isDisabled || !hasWritePermission)) return;
      if (isFolderMode) {
        const { isExternal, isInternal } = getDragTypes(e);
        if (isExternal || (isInternal && onInternalFileDrop)) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsDraggingOver(false);
            setIsDropTarget(false);
          }
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setIsDraggingOver(false);
        }
      }
    },
    [isFolderMode, isDisabled, hasWritePermission, onInternalFileDrop]
  );

  const handleDrop = useCallback(
    async (e, targetPath, uploadCallback) => {
      if (isFolderMode && (isDisabled || !hasWritePermission)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      setIsDropTarget(false);

      const dataTransfer = e.dataTransfer;
      const internalPath = dataTransfer?.getData?.('text/plain');

      if (isFolderMode && internalPath && onInternalFileDrop) {
        if (getParentPath(internalPath) === targetPath || internalPath === targetPath) {
          return;
        }
        onInternalFileDrop(internalPath, targetPath);
        return;
      }

      if (isFolderMode) {
        const types = dataTransfer?.types;
        if (!(types && types.includes('Files') && onExplorerDrop)) return;
      }

      try {
        if (!dataTransfer || !dataTransfer.items || dataTransfer.items.length === 0) {
          return;
        }

        const filesToUpload = await extractFiles(dataTransfer);

        if (filesToUpload.length === 0) {
          return;
        }

        const progressItems = filesToUpload.map((item, index) => ({
          id: `upload-${Date.now()}-${index}`,
          name: item.relativePath,
          status: 'pending',
          progress: 0,
        }));
        setUploadProgress(progressItems);

        if (uploadCallback) {
          await uploadCallback(filesToUpload, targetPath, (updatedProgress) => {
            setUploadProgress(updatedProgress);
          });
        }

        setTimeout(() => {
          setUploadProgress([]);
        }, 3000);

        if (onUploadComplete) {
          onUploadComplete(filesToUpload.length);
        }
      } catch (error) {
        console.error('Drop error:', error);
        if (onUploadError) {
          onUploadError(error);
        }
        setUploadProgress([]);
      }
    },
    [
      extractFiles,
      onUploadComplete,
      onUploadError,
      isFolderMode,
      isDisabled,
      hasWritePermission,
      onExplorerDrop,
      onInternalFileDrop,
    ]
  );

  const reset = useCallback(() => {
    setIsDraggingOver(false);
    setIsDropTarget(false);
    setUploadProgress([]);
  }, []);

  if (isFolderMode) {
    return {
      isDropTarget,
      isDraggingOver,
      setIsDropTarget,
      handleFolderDragOver: handleDragOver,
      handleFolderDragEnter: handleDragEnter,
      handleFolderDragLeave: handleDragLeave,
      handleFolderDrop: (e) => handleDrop(e, path, onExplorerDrop),
    };
  }

  return {
    isDraggingOver,
    uploadProgress,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    reset,
  };
};
