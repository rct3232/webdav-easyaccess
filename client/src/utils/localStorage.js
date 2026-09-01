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

// 검색 히스토리 저장/로드
const SEARCH_HISTORY_KEY = 'searchHistory';
const MAX_SEARCH_HISTORY = 10;

export const getSearchHistory = () => {
  try {
    const value = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!value) return [];
    const history = JSON.parse(value);
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.error('Failed to load search history:', error);
    return [];
  }
};

export const addSearchHistory = (query) => {
  try {
    const history = getSearchHistory();
    // 중복 제거 (같은 검색어가 있으면 제거 후 맨 앞에 추가)
    const filtered = history.filter((item) => item !== query);
    const newHistory = [query, ...filtered].slice(0, MAX_SEARCH_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
  } catch (error) {
    console.error('Failed to save search history:', error);
  }
};

export const clearSearchHistory = () => {
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch (error) {
    console.error('Failed to clear search history:', error);
  }
};
