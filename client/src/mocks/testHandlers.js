/**
 * 테스트 전용 MSW 핸들러
 * 최근 파일 관련 핸들러만 포함하여 테스트에서 독립적으로 사용
 */

import { http, HttpResponse } from 'msw';
import { handlers } from './handlers';
import { normalizePath } from '../../utils/pathUtils';

// 최근 파일 전용 핸들러 경로 목록 (명시적으로 정의)
const RECENT_FILES_HANDLER_PATHS = [
  '/api/recent-files',
  '/api/recent-files/:filePath',
];

// 최근 파일 핸들러인지 확인하는 헬퍼 함수
const isRecentFilesHandler = (handler) => {
  try {
    // MSW v2에서는 handler.info.header에 경로 정보가 있을 수 있음
    // 또는 handler의 predicate 함수를 확인
    const handlerInfo = handler.info || {};
    const header = handlerInfo.header || '';
    return RECENT_FILES_HANDLER_PATHS.some(path => header.includes(path));
  } catch {
    // 핸들러 구조가 다를 수 있으므로 안전하게 처리
    return false;
  }
};

// 최근 파일 핸들러를 제외한 기본 핸들러
export const baseHandlers = handlers.filter(handler => !isRecentFilesHandler(handler));

// 최근 파일 테스트용 핸들러 팩토리 함수
export const createRecentFilesHandlers = (getStore, updateStore, clearStore) => [
  http.get('/api/recent-files', () => {
    const store = getStore();
    return HttpResponse.json(JSON.parse(JSON.stringify(store)));
  }),
  http.post('/api/recent-files', async ({ request }) => {
    const body = await request.json();
    const normalizedPath = normalizePath(body.path);
    
    updateStore((store) => {
      // 중복 제거
      let filtered = store.filter(f => normalizePath(f.path) !== normalizedPath);
      // 맨 앞에 추가
      filtered.unshift({
        path: normalizedPath,
        name: body.name || body.basename,
        type: body.type || 'file',
        lastAccessed: new Date().toISOString(),
      });
      // 최대 20개 제한
      return filtered.slice(0, 20);
    });
    
    return HttpResponse.json(JSON.parse(JSON.stringify(getStore())));
  }),
  http.delete('/api/recent-files/:filePath', ({ params }) => {
    const filePath = decodeURIComponent(params.filePath);
    const normalizedPath = normalizePath(filePath);
    
    updateStore((store) => {
      return store.filter(f => normalizePath(f.path) !== normalizedPath);
    });
    
    return HttpResponse.json(JSON.parse(JSON.stringify(getStore())));
  }),
  http.delete('/api/recent-files', () => {
    clearStore();
    return HttpResponse.json({ messageCode: 'serverMessages.recentFiles.clearedSuccess' });
  }),
];
