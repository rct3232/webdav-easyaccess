/**
 * 최근 파일 유틸리티 단위 테스트
 */

import { getRecentFiles, addRecentFile, removeRecentFile, clearRecentFiles, updateSubPathsOnPathChange, removeSubPathsOnFolderDelete, removeMultiplePaths } from '../recentFiles';
import { normalizePath } from '../pathUtils';

// 테스트용 스토어 (모듈 스코프)
let recentFilesStore = [];

// apiClient 모킹
jest.mock('../../services/apiClient', () => {
  return {
    get: jest.fn(),
    post: jest.fn(),
    del: jest.fn(),
  };
});

import * as apiClientModule from '../../services/apiClient';

/**
 * Mock 설정 헬퍼 함수
 * @param {Function} getStore - 스토어 getter
 * @param {Function} updateStore - 스토어 updater
 * @param {Function} clearStore - 스토어 clear 함수
 */
const setupRecentFilesMocks = (getStore, updateStore, clearStore) => {
  apiClientModule.get.mockImplementation((url) => {
    if (url === '/recent-files') {
      return Promise.resolve({ data: JSON.parse(JSON.stringify(getStore())) });
    }
    return Promise.reject(new Error('Not mocked'));
  });

  apiClientModule.post.mockImplementation((url, data) => {
    if (url === '/recent-files') {
      const normalizedPath = normalizePath(data.path);
      updateStore((store) => {
        // 중복 제거
        let filtered = store.filter(f => normalizePath(f.path) !== normalizedPath);
        // 맨 앞에 추가
        filtered.unshift({
          path: normalizedPath,
          name: data.name || data.basename,
          type: data.type || 'file',
          lastAccessed: new Date().toISOString(),
        });
        // 최대 20개 제한
        return filtered.slice(0, 20);
      });
      return Promise.resolve({ data: JSON.parse(JSON.stringify(getStore())) });
    }
    return Promise.reject(new Error('Not mocked'));
  });

  apiClientModule.del.mockImplementation((url) => {
    if (url.startsWith('/recent-files/')) {
      // 경로 파싱
      const encodedPath = url.replace('/recent-files/', '');
      const filePath = decodeURIComponent(encodedPath);
      const normalizedPath = normalizePath(filePath);
      updateStore((store) => {
        return store.filter(f => normalizePath(f.path) !== normalizedPath);
      });
      return Promise.resolve({ data: JSON.parse(JSON.stringify(getStore())) });
    }
    if (url === '/recent-files') {
      clearStore();
      return Promise.resolve({ data: { message: 'Recent files cleared successfully' } });
    }
    return Promise.reject(new Error('Not mocked'));
  });
};

// 초기 mock 설정
setupRecentFilesMocks(
  () => recentFilesStore,
  (updater) => { recentFilesStore = updater(recentFilesStore); },
  () => { recentFilesStore = []; }
);

describe('recentFiles 유틸리티', () => {
  beforeEach(() => {
    // 스토어 초기화
    recentFilesStore = [];
    jest.clearAllMocks();
    
    // Mock 재설정
    setupRecentFilesMocks(
      () => recentFilesStore,
      (updater) => { recentFilesStore = updater(recentFilesStore); },
      () => { recentFilesStore = []; }
    );
  });

  describe('getRecentFiles', () => {
    test('최근 파일 목록을 가져옴', async () => {
      recentFilesStore = [
        {
          path: '/testuser/file1.txt',
          name: 'file1.txt',
          type: 'file',
          lastAccessed: new Date().toISOString(),
        },
      ];

      const files = await getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('/testuser/file1.txt');
    });

    test('빈 목록일 때 빈 배열 반환', async () => {
      recentFilesStore = [];
      const files = await getRecentFiles();
      expect(files).toEqual([]);
    });

    test('에러 발생 시 빈 배열 반환', async () => {
      apiClientModule.get.mockRejectedValueOnce(new Error('Network error'));

      const files = await getRecentFiles();
      expect(files).toEqual([]);
    });
  });

  describe('addRecentFile', () => {
    test('파일을 최근항목에 추가', async () => {
      recentFilesStore = [];
      
      const file = {
        path: '/testuser/document.pdf',
        name: 'document.pdf',
        type: 'file',
        basename: 'document.pdf',
      };

      const result = await addRecentFile(file);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/testuser/document.pdf');
      expect(result[0].name).toBe('document.pdf');
    });

    test('경로 정규화 적용', async () => {
      recentFilesStore = [];
      
      const file = {
        path: '/testuser/file.txt/',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      };

      const result = await addRecentFile(file);
      expect(result[0].path).toBe('/testuser/file.txt'); // 끝의 / 제거됨
    });

    test('중복 파일 추가 시 맨 위로 이동', async () => {
      recentFilesStore = [];
      
      // 첫 번째 파일 추가
      await addRecentFile({
        path: '/testuser/file1.txt',
        name: 'file1.txt',
        type: 'file',
        basename: 'file1.txt',
      });

      // 두 번째 파일 추가
      await addRecentFile({
        path: '/testuser/file2.txt',
        name: 'file2.txt',
        type: 'file',
        basename: 'file2.txt',
      });

      // 첫 번째 파일 다시 추가
      const result = await addRecentFile({
        path: '/testuser/file1.txt',
        name: 'file1.txt',
        type: 'file',
        basename: 'file1.txt',
      });

      expect(result[0].path).toBe('/testuser/file1.txt'); // 맨 위로 이동
      expect(result).toHaveLength(2); // 중복되지 않음
    });

    test('최대 20개 제한', async () => {
      recentFilesStore = [];
      
      // 21개 파일 추가
      for (let i = 0; i < 21; i++) {
        await addRecentFile({
          path: `/testuser/file${i}.txt`,
          name: `file${i}.txt`,
          type: 'file',
          basename: `file${i}.txt`,
        });
      }

      const files = await getRecentFiles();
      expect(files).toHaveLength(20);
      expect(files[0].path).toBe('/testuser/file20.txt'); // 가장 최근 파일
    });

    test('에러 발생 시 빈 배열 반환', async () => {
      apiClientModule.post.mockRejectedValueOnce(new Error('Network error'));

      const result = await addRecentFile({
        path: '/testuser/file.txt',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });

      expect(result).toEqual([]);
    });
  });

  describe('removeRecentFile', () => {
    test('파일을 최근항목에서 제거', async () => {
      recentFilesStore = [];
      
      // 파일 추가
      await addRecentFile({
        path: '/testuser/file1.txt',
        name: 'file1.txt',
        type: 'file',
        basename: 'file1.txt',
      });

      await addRecentFile({
        path: '/testuser/file2.txt',
        name: 'file2.txt',
        type: 'file',
        basename: 'file2.txt',
      });

      // 파일 제거
      const result = await removeRecentFile('/testuser/file1.txt');
      expect(result).toHaveLength(1);
      expect(result.find(f => f.path === '/testuser/file1.txt')).toBeUndefined();
      expect(result.find(f => f.path === '/testuser/file2.txt')).toBeDefined();
    });

    test('경로 정규화 적용', async () => {
      recentFilesStore = [];
      
      // 파일 추가
      await addRecentFile({
        path: '/testuser/file.txt',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });

      // 끝에 /가 있는 경로로 제거 시도
      const result = await removeRecentFile('/testuser/file.txt/');
      expect(result).toHaveLength(0); // 정규화되어 제거됨
    });

    test('존재하지 않는 파일 제거 시 에러 없이 처리', async () => {
      recentFilesStore = [];
      
      const result = await removeRecentFile('/testuser/nonexistent.txt');
      expect(result).toEqual([]);
    });

    test('에러 발생 시 빈 배열 반환', async () => {
      apiClientModule.del.mockRejectedValueOnce(new Error('Network error'));

      const result = await removeRecentFile('/testuser/file.txt');
      expect(result).toEqual([]);
    });
  });

  describe('clearRecentFiles', () => {
    test('모든 최근 파일 제거', async () => {
      recentFilesStore = [];
      
      // 파일 추가
      await addRecentFile({
        path: '/testuser/file1.txt',
        name: 'file1.txt',
        type: 'file',
        basename: 'file1.txt',
      });

      await addRecentFile({
        path: '/testuser/file2.txt',
        name: 'file2.txt',
        type: 'file',
        basename: 'file2.txt',
      });

      // 모두 제거
      await clearRecentFiles();

      const files = await getRecentFiles();
      expect(files).toEqual([]);
    });

    test('에러 발생 시에도 예외 없이 처리', async () => {
      apiClientModule.del.mockRejectedValueOnce(new Error('Network error'));

      // 예외가 발생하지 않아야 함
      await expect(clearRecentFiles()).resolves.not.toThrow();
    });
  });

  describe('경로 정규화 통합', () => {
    test('다양한 경로 형식이 정규화되어 저장됨', async () => {
      recentFilesStore = [];
      
      const testCases = [
        { input: '/testuser/file.txt', expected: '/testuser/file.txt' },
        { input: '/testuser/file.txt/', expected: '/testuser/file.txt' },
        { input: '//testuser//file.txt', expected: '/testuser/file.txt' },
        { input: '/testuser/subfolder//file.txt', expected: '/testuser/subfolder/file.txt' },
      ];

      for (const testCase of testCases) {
        await addRecentFile({
          path: testCase.input,
          name: 'file.txt',
          type: 'file',
          basename: 'file.txt',
        });

        const files = await getRecentFiles();
        const addedFile = files.find(f => f.name === 'file.txt');
        expect(addedFile).toBeDefined();
        expect(addedFile.path).toBe(testCase.expected);

        // 정리
        await removeRecentFile(testCase.input);
      }
    });

    test('정규화된 경로로 중복 감지', async () => {
      recentFilesStore = [];
      
      // 첫 번째 경로 형식으로 추가
      await addRecentFile({
        path: '/testuser/file.txt',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });

      // 다른 형식으로 같은 파일 추가 시도
      await addRecentFile({
        path: '/testuser/file.txt/',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });

      const files = await getRecentFiles();
      expect(files).toHaveLength(1); // 중복되지 않음
    });
  });

  describe('updateSubPathsOnPathChange', () => {
    test('폴더 이동 시 하위 경로 업데이트', async () => {
      recentFilesStore = [];
      
      // 하위 파일 추가
      await addRecentFile({
        path: '/testuser/folder/subfile.txt',
        name: 'subfile.txt',
        type: 'file',
        basename: 'subfile.txt',
      });
      
      // 폴더 이동: /testuser/folder -> /testuser/newfolder
      const result = await updateSubPathsOnPathChange('/testuser/folder', '/testuser/newfolder');
      
      // 하위 경로가 업데이트되었는지 확인
      const files = await getRecentFiles();
      const updatedFile = files.find(f => f.path === '/testuser/newfolder/subfile.txt');
      expect(updatedFile).toBeDefined();
      expect(files.find(f => f.path === '/testuser/folder/subfile.txt')).toBeUndefined();
    });

    test('폴더 이름변경 시 하위 경로 업데이트', async () => {
      recentFilesStore = [];
      
      await addRecentFile({
        path: '/testuser/oldname/file.txt',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });
      
      const result = await updateSubPathsOnPathChange('/testuser/oldname', '/testuser/newname');
      
      const files = await getRecentFiles();
      expect(files.find(f => f.path === '/testuser/newname/file.txt')).toBeDefined();
      expect(files.find(f => f.path === '/testuser/oldname/file.txt')).toBeUndefined();
    });

    test('작업 완료 후 자동 새로고침', async () => {
      recentFilesStore = [];
      
      await addRecentFile({
        path: '/testuser/folder/file.txt',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });
      
      const result = await updateSubPathsOnPathChange('/testuser/folder', '/testuser/newfolder');
      
      // 반환값이 최신 리스트인지 확인
      expect(Array.isArray(result)).toBe(true);
      expect(result.find(f => f.path === '/testuser/newfolder/file.txt')).toBeDefined();
    });
  });

  describe('removeSubPathsOnFolderDelete', () => {
    test('폴더 삭제 시 하위 경로 제거', async () => {
      recentFilesStore = [];
      
      // 하위 파일 추가
      await addRecentFile({
        path: '/testuser/folder/subfile1.txt',
        name: 'subfile1.txt',
        type: 'file',
        basename: 'subfile1.txt',
      });
      await addRecentFile({
        path: '/testuser/folder/subfile2.txt',
        name: 'subfile2.txt',
        type: 'file',
        basename: 'subfile2.txt',
      });
      await addRecentFile({
        path: '/testuser/other.txt',
        name: 'other.txt',
        type: 'file',
        basename: 'other.txt',
      });
      
      // 폴더 삭제
      const result = await removeSubPathsOnFolderDelete('/testuser/folder');
      
      const files = await getRecentFiles();
      // 하위 파일들이 제거되었는지 확인
      expect(files.find(f => f.path === '/testuser/folder/subfile1.txt')).toBeUndefined();
      expect(files.find(f => f.path === '/testuser/folder/subfile2.txt')).toBeUndefined();
      // 다른 파일은 유지
      expect(files.find(f => f.path === '/testuser/other.txt')).toBeDefined();
    });

    test('작업 완료 후 자동 새로고침', async () => {
      recentFilesStore = [];
      
      await addRecentFile({
        path: '/testuser/folder/file.txt',
        name: 'file.txt',
        type: 'file',
        basename: 'file.txt',
      });
      
      const result = await removeSubPathsOnFolderDelete('/testuser/folder');
      
      // 반환값이 최신 리스트인지 확인
      expect(Array.isArray(result)).toBe(true);
      expect(result.find(f => f.path === '/testuser/folder/file.txt')).toBeUndefined();
    });
  });

  describe('removeMultiplePaths', () => {
    test('여러 파일 경로 제거', async () => {
      recentFilesStore = [];
      
      // 여러 파일 추가
      await addRecentFile({
        path: '/testuser/file1.txt',
        name: 'file1.txt',
        type: 'file',
        basename: 'file1.txt',
      });
      await addRecentFile({
        path: '/testuser/file2.txt',
        name: 'file2.txt',
        type: 'file',
        basename: 'file2.txt',
      });
      await addRecentFile({
        path: '/testuser/file3.txt',
        name: 'file3.txt',
        type: 'file',
        basename: 'file3.txt',
      });
      
      // 여러 파일 제거
      const result = await removeMultiplePaths(['/testuser/file1.txt', '/testuser/file2.txt']);
      
      const files = await getRecentFiles();
      expect(files.find(f => f.path === '/testuser/file1.txt')).toBeUndefined();
      expect(files.find(f => f.path === '/testuser/file2.txt')).toBeUndefined();
      expect(files.find(f => f.path === '/testuser/file3.txt')).toBeDefined();
    });

    test('작업 완료 후 자동 새로고침', async () => {
      recentFilesStore = [];
      
      await addRecentFile({
        path: '/testuser/file1.txt',
        name: 'file1.txt',
        type: 'file',
        basename: 'file1.txt',
      });
      await addRecentFile({
        path: '/testuser/file2.txt',
        name: 'file2.txt',
        type: 'file',
        basename: 'file2.txt',
      });
      
      const result = await removeMultiplePaths(['/testuser/file1.txt']);
      
      // 반환값이 최신 리스트인지 확인
      expect(Array.isArray(result)).toBe(true);
      expect(result.find(f => f.path === '/testuser/file1.txt')).toBeUndefined();
      expect(result.find(f => f.path === '/testuser/file2.txt')).toBeDefined();
    });
  });
});
