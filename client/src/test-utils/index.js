import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider as RealAuthProvider, AuthContext } from '../contexts/AuthContext';

// Mock AuthProvider for testing
export const MockAuthProvider = ({ children, value }) => {
  const defaultValue = {
    user: value?.user || { id: 1, username: 'testuser', is_admin: false },
    token: value?.token || 'test-token',
    loading: value?.loading ?? false,
    login: value?.login || jest.fn(),
    logout: value?.logout || jest.fn(),
    register: value?.register || jest.fn(),
    isAuthenticated: value?.isAuthenticated ?? !!(value?.user),
  };
  
  return (
    <AuthContext.Provider value={defaultValue}>
      {children}
    </AuthContext.Provider>
  );
};

// 커스텀 render 함수 (Router와 Context 포함)
export function renderWithProviders(ui, options = {}) {
  const {
    user = { id: 1, username: 'testuser', is_admin: false, email: 'test@example.com' },
    token = 'test-token',
    authContextValue = {},
    ...renderOptions
  } = options;
  
  const Wrapper = ({ children }) => (
    <BrowserRouter>
      <MockAuthProvider value={{ user, token, ...authContextValue }}>
        {children}
      </MockAuthProvider>
    </BrowserRouter>
  );
  
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// 파일 객체 생성 헬퍼
export function createMockFile(name = 'test.txt', size = 1024, type = 'text/plain') {
  const content = 'test content';
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type, lastModified: Date.now() });
  
  // Add size property
  Object.defineProperty(file, 'size', {
    value: size,
    writable: false,
  });
  
  return file;
}

// 파일 목록 모킹 데이터
export const mockFiles = [
  {
    basename: 'test.txt',
    path: '/test.txt',
    type: 'file',
    size: 1024,
    mtime: '2024-01-01T00:00:00Z',
    hasReadPermission: true,
    hasWritePermission: true,
  },
  {
    basename: 'folder',
    path: '/folder',
    type: 'directory',
    mtime: '2024-01-01T00:00:00Z',
    hasReadPermission: true,
    hasWritePermission: true,
  },
  {
    basename: 'image.png',
    path: '/image.png',
    type: 'file',
    size: 2048,
    mtime: '2024-01-01T00:00:00Z',
    mime: 'image/png',
    hasReadPermission: true,
    hasWritePermission: true,
  },
];

// 드래그 이벤트 생성 헬퍼
export function createDragEvent(type, options = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      dropEffect: 'none',
      effectAllowed: 'all',
      files: options.files || [],
      items: options.items || [],
      types: options.types || [],
      getData: jest.fn((format) => options.data?.[format] || ''),
      setData: jest.fn(),
      clearData: jest.fn(),
      setDragImage: jest.fn(),
    },
    writable: true,
  });
  
  return event;
}

// 기다리기 헬퍼
export const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Re-export everything from React Testing Library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

