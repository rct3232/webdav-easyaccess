import { useState, useCallback } from 'react';

/**
 * Hook for handling drag-and-drop uploads from OS file explorer
 * Supports files and folders with recursive directory structure preservation
 */
export const useExplorerDragAndDrop = (onUploadComplete, onUploadError) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);

  /**
   * Recursively traverse a directory entry and collect all files with their relative paths
   */
  const traverseDirectory = useCallback(async (entry, basePath = '') => {
    const files = [];
    
    if (entry.isFile) {
      // Get the file from the entry
      return new Promise((resolve) => {
        entry.file((file) => {
          const relativePath = basePath ? `${basePath}/${file.name}` : file.name;
          files.push({ file, relativePath });
          resolve(files);
        });
      });
    } else if (entry.isDirectory) {
      // Read directory contents
      const dirReader = entry.createReader();
      
      return new Promise((resolve) => {
        const readEntries = () => {
          dirReader.readEntries(async (entries) => {
            if (entries.length === 0) {
              // No more entries, resolve with collected files
              resolve(files);
            } else {
              // Process each entry recursively
              for (const childEntry of entries) {
                const childPath = basePath ? `${basePath}/${entry.name}` : entry.name;
                const childFiles = await traverseDirectory(childEntry, childPath);
                files.push(...childFiles);
              }
              // Continue reading (directories may have many entries)
              readEntries();
            }
          });
        };
        readEntries();
      });
    }
    
    return files;
  }, []);

  /**
   * Extract files and folders from DataTransfer
   */
  const extractFiles = useCallback(async (dataTransfer) => {
    const items = Array.from(dataTransfer.items);
    const allFiles = [];

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.() || item.getAsEntry?.();
        
        if (entry) {
          const files = await traverseDirectory(entry);
          allFiles.push(...files);
        } else {
          // Fallback for browsers that don't support entries
          const file = item.getAsFile();
          if (file) {
            allFiles.push({ file, relativePath: file.name });
          }
        }
      }
    }

    return allFiles;
  }, [traverseDirectory]);

  /**
   * Handle drag enter event
   */
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  /**
   * Handle drag over event
   */
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Set drop effect to copy
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  /**
   * Handle drag leave event
   */
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set to false if we're leaving the entire drop zone
    // Check if the related target is outside the drop zone
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDraggingOver(false);
    }
  }, []);

  /**
   * Handle drop event
   */
  const handleDrop = useCallback(async (e, targetPath, uploadCallback) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    try {
      // Check if files are being dragged from external source
      const dataTransfer = e.dataTransfer;
      if (!dataTransfer || !dataTransfer.items || dataTransfer.items.length === 0) {
        return;
      }

      // Check if this is an internal drag (file moving within the app)
      const internalDrag = dataTransfer.getData('text/plain');
      if (internalDrag) {
        // This is an internal drag, not an external file drop
        return;
      }

      // Extract all files with their relative paths
      const filesToUpload = await extractFiles(dataTransfer);
      
      if (filesToUpload.length === 0) {
        return;
      }

      // Initialize upload progress
      const progressItems = filesToUpload.map((item, index) => ({
        id: `upload-${Date.now()}-${index}`,
        name: item.relativePath,
        status: 'pending',
        progress: 0,
      }));
      setUploadProgress(progressItems);

      // Call the upload callback with files and target path
      if (uploadCallback) {
        await uploadCallback(filesToUpload, targetPath, (updatedProgress) => {
          setUploadProgress(updatedProgress);
        });
      }

      // Clear progress after completion
      setTimeout(() => {
        setUploadProgress([]);
      }, 3000);

      // Notify completion
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
  }, [extractFiles, onUploadComplete, onUploadError]);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setIsDraggingOver(false);
    setUploadProgress([]);
  }, []);

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

