/**
 * isInvalidFolderPickerDestination tests.
 * @see docs/spec/client/utils/validateFolderDestination.md
 */
import { isInvalidFolderPickerDestination } from '../isInvalidFolderPickerDestination';

describe('isInvalidFolderPickerDestination', () => {
  it('returns false for non-copy/move actions', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: undefined,
        selectedNodeId: 101,
        sourceNodeId: 55,
      })
    ).toBe(false);
  });

  it('returns true when the destination is the source nodeId itself', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'move',
        selectedNodeId: 101,
        sourceNodeId: 101,
      })
    ).toBe(true);
  });

  it('returns true for multi-source input when any source equals the destination', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'move',
        selectedNodeId: 101,
        sourceNodeIds: [55, 101, 202],
      })
    ).toBe(true);
  });

  it('returns false for valid unrelated destinations', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'copy',
        selectedNodeId: 101,
        sourceNodeId: 55,
      })
    ).toBe(false);
  });
});
