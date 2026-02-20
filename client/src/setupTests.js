/**
 * Jest setup - runs before each test file.
 * MSW handlers from mocks/handlers.js are used when tests call the API.
 * Polyfills must run first so MSW has TextEncoder.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/api.md
 */
import './jest-polyfills.js';

jest.mock('react-pdf', () => {
  const React = require('react');
  return {
    Document: ({ children }) => React.createElement('div', { 'data-testid': 'pdf-document' }, children),
    Page: () => React.createElement('div', { 'data-testid': 'pdf-page' }),
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  };
});
import '@testing-library/jest-dom';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

export const server = setupServer(...handlers);

// IntersectionObserver mock for hooks that use it (e.g. useInfiniteScroll)
global.IntersectionObserver = class MockIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
};

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
