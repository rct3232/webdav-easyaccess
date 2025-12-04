import { SORT_MODES, PREVIEWABLE_EXTENSIONS } from '../constants/fileManager';

export const sortFiles = (filesToSort, sortMode) => {
  const sorted = [...filesToSort];
  const folders = sorted.filter(f => f.type === 'directory');
  const files = sorted.filter(f => f.type !== 'directory');
  
  const sortByName = (a, b) => {
    const nameA = (a.basename || a.name || '').toLowerCase();
    const nameB = (b.basename || b.name || '').toLowerCase();
    return sortMode === SORT_MODES.NAME_ASC 
      ? nameA.localeCompare(nameB)
      : nameB.localeCompare(nameA);
  };
  
  const sortByDate = (a, b) => {
    const dateA = new Date(a.lastmod || 0);
    const dateB = new Date(b.lastmod || 0);
    return sortMode === SORT_MODES.DATE_ASC
      ? dateA - dateB
      : dateB - dateA;
  };
  
  const sortFn = (sortMode === SORT_MODES.NAME_ASC || sortMode === SORT_MODES.NAME_DESC)
    ? sortByName
    : sortByDate;
  
  folders.sort(sortFn);
  files.sort(sortFn);
  
  return [...folders, ...files];
};

export const canPreview = (filename) => {
  if (!filename || typeof filename !== 'string') return false;
  
  const parts = filename.split('.');
  if (parts.length < 2) return false;
  
  const ext = parts.pop().toLowerCase();
  return PREVIEWABLE_EXTENSIONS.includes(ext);
};

