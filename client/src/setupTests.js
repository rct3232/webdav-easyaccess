/**
 * Jest setup - runs before each test file.
 * MSW handlers from mocks/handlers.js are used when tests call the API.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/openapi.yaml
 */
import '@testing-library/jest-dom';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
