import { useState, useCallback } from 'react';

/**
 * Hook for handling drop-to-upload from OS file explorer
 * Supports files and folders with recursive directory structure preservation
 *
 * @param {Object} options - 옵션 객체
 * @param {Function} [options.onUploadComplete] - 업로드 완료 콜백 (메인 영역용)
 * @param {Function} [options.onUploadError] - 업로드 에러 콜백 (메인 영역용)
 * @param {string} [options.path] - 폴더 경로 (폴더 트리 모드용)
 * @param {boolean} [options.isDisabled] - 비활성화 여부 (폴더 트리 모드용)
 * @param {boolean} [options.hasWritePermission] - 쓰기 권한 여부 (폴더 트리 모드용)
 * @param {Function} [options.onExplorerDrop] - 드롭 핸들러 (폴더 트리 모드용)
 * @param {Function} [options.onInternalFileDrop] - 내부 드래그 드롭: (draggedPath, targetFolderPath) when dropped from file manager
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
  } = typeof options === 'object' ? options : { onUploadComplete: options };

  const isFolderMode = path != null && typeof onExplorerDrop === 'function';

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
        const types = e.dataTransfer?.types || [];
        const isExternal = types.includes('Files');
        const isInternal = types.includes('text/plain');
        if (isExternal || (isInternal && onInternalFileDrop)) {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(true);
          setIsDropTarget(true);
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
      }
    },
    [isFolderMode, isDisabled, hasWritePermission, onInternalFileDrop]
  );

  const handleDragOver = useCallback(
    (e) => {
      if (isFolderMode && (isDisabled || !hasWritePermission)) return;
      if (isFolderMode) {
        const types = e.dataTransfer?.types || [];
        const isExternal = types.includes('Files');
        const isInternal = types.includes('text/plain');
        if (isExternal) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setIsDropTarget(true);
        } else if (isInternal && onInternalFileDrop) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setIsDropTarget(true);
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [isFolderMode, isDisabled, hasWritePermission, onInternalFileDrop]
  );

  const handleDragLeave = useCallback(
    (e) => {
      if (isFolderMode && (isDisabled || !hasWritePermission)) return;
      if (isFolderMode) {
        const types = e.dataTransfer?.types || [];
        const isExternal = types.includes('Files');
        const isInternal = types.includes('text/plain');
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
