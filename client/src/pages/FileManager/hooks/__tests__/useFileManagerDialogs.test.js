/**
 * useFileManagerDialogs tests.
 * @see docs/spec/client/hooks/useFileManagerDialogs.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useFileManagerDialogs } from '../useFileManagerDialogs';

describe('useFileManagerDialogs', () => {
  it('all dialog states are closed initially', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    expect(result.current.uploadDialogOpen).toBe(false);
    expect(result.current.createFolderDialogOpen).toBe(false);
    expect(result.current.previewDialogOpen).toBe(false);
    expect(result.current.renameDialogOpen).toBe(false);
    expect(result.current.shareDialogOpen).toBe(false);
    expect(result.current.shareDialogV2Open).toBe(false);
    expect(result.current.propertiesDialogOpen).toBe(false);
    expect(result.current.bulkDeleteDialogOpen).toBe(false);
    expect(result.current.actionSheetOpen).toBe(false);
  });

  it('openUploadDialog and closeUploadDialog toggle upload dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openUploadDialog());
    expect(result.current.uploadDialogOpen).toBe(true);

    act(() => result.current.closeUploadDialog());
    expect(result.current.uploadDialogOpen).toBe(false);
  });

  it('openCreateFolderDialog and closeCreateFolderDialog toggle create folder dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openCreateFolderDialog());
    expect(result.current.createFolderDialogOpen).toBe(true);

    act(() => result.current.closeCreateFolderDialog());
    expect(result.current.createFolderDialogOpen).toBe(false);
  });

  it('openPreviewDialog and closePreviewDialog toggle preview dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openPreviewDialog({ path: '/file.txt' }));
    expect(result.current.previewDialogOpen).toBe(true);

    act(() => result.current.closePreviewDialog());
    expect(result.current.previewDialogOpen).toBe(false);
  });

  it('openShareDialog and closeShareDialog toggle share dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openShareDialog({ path: '/f.txt' }));
    expect(result.current.shareDialogOpen).toBe(true);

    act(() => result.current.closeShareDialog());
    expect(result.current.shareDialogOpen).toBe(false);
  });

  it('openShareDialogV2 and closeShareDialogV2 toggle share v2 dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openShareDialogV2({ path: '/f.txt' }));
    expect(result.current.shareDialogV2Open).toBe(true);

    act(() => result.current.closeShareDialogV2());
    expect(result.current.shareDialogV2Open).toBe(false);
  });

  it('openPropertiesDialog and closePropertiesDialog toggle properties dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openPropertiesDialog({ path: '/f.txt' }));
    expect(result.current.propertiesDialogOpen).toBe(true);

    act(() => result.current.closePropertiesDialog());
    expect(result.current.propertiesDialogOpen).toBe(false);
  });

  it('openBulkDeleteDialog and closeBulkDeleteDialog toggle bulk delete dialog', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openBulkDeleteDialog(['/a.txt', '/b.txt']));
    expect(result.current.bulkDeleteDialogOpen).toBe(true);
    expect(result.current.bulkDeleteFilePaths).toEqual(['/a.txt', '/b.txt']);

    act(() => result.current.closeBulkDeleteDialog());
    expect(result.current.bulkDeleteDialogOpen).toBe(false);
  });

  it('openRenameDialog sets renameNewName from file basename', () => {
    const file = { path: '/folder/doc.pdf', basename: 'doc.pdf' };
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openRenameDialog(file));

    expect(result.current.renameDialogOpen).toBe(true);
    expect(result.current.renameNewName).toBe('doc.pdf');
  });

  it('closeRenameDialog clears renameError', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.openRenameDialog({ basename: 'x.txt' }));
    act(() => result.current.setRenameError('Invalid name'));
    expect(result.current.renameError).toBe('Invalid name');

    act(() => result.current.closeRenameDialog());

    expect(result.current.renameError).toBe('');
  });

  it('contextMenu and selectedFile setters work', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.setContextMenu({ mouseX: 100, mouseY: 200 }));
    expect(result.current.contextMenu).toEqual({ mouseX: 100, mouseY: 200 });

    const file = { path: '/f.txt', basename: 'f.txt' };
    act(() => result.current.setSelectedFile(file));
    expect(result.current.selectedFile).toEqual(file);
  });

  it('actionSheet open and closeActionSheet', () => {
    const { result } = renderHook(() => useFileManagerDialogs());

    act(() => result.current.setActionSheetFile({ path: '/f.txt' }));
    expect(result.current.actionSheetOpen).toBe(true);

    act(() => result.current.closeActionSheet());
    expect(result.current.actionSheetOpen).toBe(false);
  });

  it('mobileRenameFile via setMobileRenameFile', () => {
    const { result } = renderHook(() => useFileManagerDialogs());
    const file = { path: '/m.txt', basename: 'm.txt' };

    act(() => result.current.setMobileRenameFile(file));

    expect(result.current.mobileRenameFile).toEqual(file);
    expect(result.current.renameDialogOpen).toBe(true);
  });

  it('mobileShareFile via setMobileShareFile', () => {
    const { result } = renderHook(() => useFileManagerDialogs());
    const file = { path: '/s.txt', basename: 's.txt' };

    act(() => result.current.setMobileShareFile(file));

    expect(result.current.mobileShareFile).toEqual(file);
    expect(result.current.shareDialogOpen).toBe(true);
  });
});
