import { useState } from 'react';

export const useSelection = (files) => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());

  const handleToggleSelectionMode = () => {
    setSelectionMode(prev => !prev);
    setSelectedFiles(new Set());
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(files.map(file => file.path)));
  };

  const handleDeselectAll = () => {
    setSelectedFiles(new Set());
  };

  const handleFileCheck = (file, checked) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(file.path);
      } else {
        newSet.delete(file.path);
      }
      return newSet;
    });
  };

  const toggleFileSelection = (file) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(file.path)) {
        newSet.delete(file.path);
      } else {
        newSet.add(file.path);
      }
      return newSet;
    });
  };

  return {
    selectionMode,
    setSelectionMode,
    selectedFiles,
    setSelectedFiles,
    handleToggleSelectionMode,
    handleSelectAll,
    handleDeselectAll,
    handleFileCheck,
    toggleFileSelection,
  };
};

