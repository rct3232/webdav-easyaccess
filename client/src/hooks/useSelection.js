import { useState } from 'react';

export const useSelection = (displayedFiles, allFiles = null) => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());

  // allFiles가 제공되면 전체 선택 시 모든 파일 선택, 없으면 displayedFiles만 선택 (하위 호환성)
  const filesForSelectAll = allFiles || displayedFiles;

  const handleToggleSelectionMode = () => {
    setSelectionMode(prev => !prev);
    setSelectedFiles(new Set());
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(filesForSelectAll.map(file => file.path)));
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

