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
        selectedPath: '/folder1',
        sourceFilePath: '/folder1/file.txt',
      })
    ).toBe(false);
  });

  it('returns true when the destination is the source path itself', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'move',
        selectedPath: '/folder1',
        sourceFilePath: '/folder1',
      })
    ).toBe(true);
  });

  it('returns true when the destination is the source parent directory', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'move',
        selectedPath: '/folder1',
        sourceFilePath: '/folder1/file.txt',
      })
    ).toBe(true);
  });

  it('returns true when the destination is a descendant of the source path', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'copy',
        selectedPath: '/folder1/subfolder',
        sourceFilePath: '/folder1',
      })
    ).toBe(true);
  });

  it('returns true for multi-source input when any source is invalid', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'move',
        selectedPath: '/folder1',
        sourceFilePaths: ['/folder1/file-a.txt', '/folder2/file-b.txt'],
      })
    ).toBe(true);
  });

  it('returns false for valid unrelated destinations', () => {
    expect(
      isInvalidFolderPickerDestination({
        action: 'copy',
        selectedPath: '/target',
        sourceFilePath: '/folder1/file.txt',
      })
    ).toBe(false);
  });
});
