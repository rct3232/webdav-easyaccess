/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
  moduleNameMapper: {
    '^@server/(.*)$': '<rootDir>/$1',
    '^@testing/(.*)$': '<rootDir>/testing/$1',
    // Resolve the workspace package from this checkout's source: with symlinked
    // node_modules the package would otherwise resolve to another worktree's
    // shared/ directory (stale while a branch adds shared message codes).
    '^@webdav-easyaccess/shared/(.*)$': '<rootDir>/../shared/$1',
  },
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**',
    '!jest.config.js',
    '!test-setup.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  modulePathIgnorePatterns: ['<rootDir>/stryker-tmp/'],
};
