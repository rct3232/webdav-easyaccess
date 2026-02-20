/**
 * refreshPolicy tests: shouldRefreshAfterOperation.
 * Verifies observable outcome (boolean) per path/op rules; paths normalized.
 * @see docs/spec/client/utils/refreshPolicy.md
 * @see docs/TESTING_STRATEGY.md
 */
import { shouldRefreshAfterOperation } from '../refreshPolicy';

describe('refreshPolicy', () => {
  describe('shouldRefreshAfterOperation', () => {
    describe('move', () => {
      it('returns true when current path equals started path', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedPath: '/a',
            currentPathNow: '/a',
            targetPath: '/b',
          })
        ).toBe(true);
      });

      it('returns true when user navigated to target path', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedPath: '/a',
            currentPathNow: '/b',
            targetPath: '/b',
          })
        ).toBe(true);
      });

      it('returns false when navigated elsewhere', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedPath: '/a',
            currentPathNow: '/c',
            targetPath: '/b',
          })
        ).toBe(false);
      });

      it('returns false for target match when targetPath is null', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedPath: '/a',
            currentPathNow: '/x',
            targetPath: null,
          })
        ).toBe(false);
      });
    });

    describe('copy', () => {
      it('returns true when current equals started', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'copy',
            startedPath: '/docs',
            currentPathNow: '/docs',
            targetPath: '/backup',
          })
        ).toBe(true);
      });

      it('returns true when current equals target', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'copy',
            startedPath: '/docs',
            currentPathNow: '/backup',
            targetPath: '/backup',
          })
        ).toBe(true);
      });

      it('returns false when navigated elsewhere', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'copy',
            startedPath: '/docs',
            currentPathNow: '/other',
            targetPath: '/backup',
          })
        ).toBe(false);
      });
    });

    describe('delete / other ops', () => {
      it('returns true when still on started path', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'delete',
            startedPath: '/a',
            currentPathNow: '/a',
            targetPath: null,
          })
        ).toBe(true);
      });

      it('returns false when navigated away', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'delete',
            startedPath: '/a',
            currentPathNow: '/b',
            targetPath: null,
          })
        ).toBe(false);
      });

      it('treats opType null/undefined as refresh (same-path only)', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: null,
            startedPath: '/a',
            currentPathNow: '/a',
            targetPath: '/b',
          })
        ).toBe(true);
        expect(
          shouldRefreshAfterOperation({
            opType: undefined,
            startedPath: '/a',
            currentPathNow: '/b',
            targetPath: '/b',
          })
        ).toBe(false);
      });
    });

    describe('path normalization', () => {
      it('normalizes paths before comparison', () => {
        // normalizePath (shared) typically adds leading slash and trims trailing
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedPath: '/a/',
            currentPathNow: '/a',
            targetPath: '/b',
          })
        ).toBe(true);
      });
    });
  });
});
