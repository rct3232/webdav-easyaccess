import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { buildPendingRequestState } from '../buildPendingRequestState';

describe('buildPendingRequestState', () => {
  it('returns empty state for missing/non-array input', () => {
    expect(buildPendingRequestState({ requests: null, targetPath: '/docs', isDirectory: true })).toEqual({
      read: { pending: false, id: null },
      write: { pending: false, id: null },
    });
  });

  it('matches folder requests by folder_path', () => {
    const result = buildPendingRequestState({
      requests: [
        { id: 'r1', folder_path: '/docs', requested_permission: PERMISSIONS.READ },
        { id: 'r2', folder_path: '/docs', requested_permission: PERMISSIONS.WRITE },
      ],
      targetPath: '/docs/',
      isDirectory: true,
    });

    expect(result).toEqual({
      read: { pending: true, id: 'r1' },
      write: { pending: true, id: 'r2' },
    });
  });

  it('matches file requests by file_path', () => {
    const result = buildPendingRequestState({
      requests: [
        { id: 'r1', file_path: '/docs/file.txt', requested_permission: PERMISSIONS.READ },
      ],
      targetPath: '/docs/file.txt',
      isDirectory: false,
    });

    expect(result.read).toEqual({ pending: true, id: 'r1' });
    expect(result.write).toEqual({ pending: false, id: null });
  });
});
