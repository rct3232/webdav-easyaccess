/**
 * localStorage 유틸리티 함수
 */

export const getShowHiddenFiles = () => {
  const value = localStorage.getItem('showHiddenFiles');
  return value === 'true';
};

export const setShowHiddenFiles = (value) => {
  localStorage.setItem('showHiddenFiles', String(value));
};

// 보기 모드 저장/로드
export const getViewMode = () => {
  return localStorage.getItem('viewMode') || 'list';
};

export const setViewMode = (mode) => {
  localStorage.setItem('viewMode', mode);
};

// 정렬 모드 저장/로드
export const getSortMode = () => {
  return localStorage.getItem('sortMode') || 'name_asc';
};

export const setSortMode = (mode) => {
  localStorage.setItem('sortMode', mode);
};
