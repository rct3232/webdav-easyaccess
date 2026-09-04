/**
 * refreshPolicy tests: shouldRefreshAfterOperation.
 * Verifies observable outcome (boolean) per nodeId/op rules; nodeIds compared by identity.
 * @see docs/spec/client/utils/refreshPolicy.md
 * @see docs/TESTING_STRATEGY.md
 */
import { shouldRefreshAfterOperation } from '../refreshPolicy';

describe('refreshPolicy', () => {
  describe('shouldRefreshAfterOperation', () => {
    describe('move', () => {
      it('returns true when current nodeId equals started nodeId', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedNodeId: 1,
            currentNodeIdNow: 1,
            targetParentNodeId: 2,
          })
        ).toBe(true);
      });

      it('returns true when user navigated to target parent nodeId', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedNodeId: 1,
            currentNodeIdNow: 2,
            targetParentNodeId: 2,
          })
        ).toBe(true);
      });

      it('returns false when navigated elsewhere', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedNodeId: 1,
            currentNodeIdNow: 3,
            targetParentNodeId: 2,
          })
        ).toBe(false);
      });

      it('returns false for target match when targetParentNodeId is null', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedNodeId: 1,
            currentNodeIdNow: 2,
            targetParentNodeId: null,
          })
        ).toBe(false);
      });

      it('returns true when still on started root (null nodeIds identical)', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedNodeId: null,
            currentNodeIdNow: null,
            targetParentNodeId: null,
          })
        ).toBe(true);
      });
    });

    describe('copy', () => {
      it('returns true when current equals started', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'copy',
            startedNodeId: 10,
            currentNodeIdNow: 10,
            targetParentNodeId: 20,
          })
        ).toBe(true);
      });

      it('returns true when current equals target parent', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'copy',
            startedNodeId: 10,
            currentNodeIdNow: 20,
            targetParentNodeId: 20,
          })
        ).toBe(true);
      });

      it('returns false when navigated elsewhere', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'copy',
            startedNodeId: 10,
            currentNodeIdNow: 30,
            targetParentNodeId: 20,
          })
        ).toBe(false);
      });
    });

    describe('delete / other ops', () => {
      it('returns true when still on started nodeId', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'delete',
            startedNodeId: 1,
            currentNodeIdNow: 1,
            targetParentNodeId: null,
          })
        ).toBe(true);
      });

      it('returns false when navigated away', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'delete',
            startedNodeId: 1,
            currentNodeIdNow: 2,
            targetParentNodeId: null,
          })
        ).toBe(false);
      });

      it('treats opType null/undefined as refresh (same nodeId only)', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: null,
            startedNodeId: 1,
            currentNodeIdNow: 1,
            targetParentNodeId: 2,
          })
        ).toBe(true);
        expect(
          shouldRefreshAfterOperation({
            opType: undefined,
            startedNodeId: 1,
            currentNodeIdNow: 2,
            targetParentNodeId: 2,
          })
        ).toBe(false);
      });
    });

    describe('identity comparison', () => {
      it('does not match different nodeIds', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'refresh',
            startedNodeId: 5,
            currentNodeIdNow: 6,
          })
        ).toBe(false);
      });

      it('does not treat null target as a match when current differs from started', () => {
        expect(
          shouldRefreshAfterOperation({
            opType: 'move',
            startedNodeId: 5,
            currentNodeIdNow: null,
            targetParentNodeId: null,
          })
        ).toBe(false);
      });
    });
  });
});
