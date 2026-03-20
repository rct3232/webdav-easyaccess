/**
 * deriveSharedAccessState tests.
 * @see docs/spec/client/utils/deriveSharedAccessState.md
 */
import { deriveSharedAccessState } from '../deriveSharedAccessState';

describe('deriveSharedAccessState', () => {
  it('directory: derives hasRead/hasWrite and returns null path/file permission fields', () => {
    const pendingRequest = { read: { pending: true, id: 'pr1' }, write: { pending: false, id: null } };
    const ownerExists = true;

    const result = deriveSharedAccessState({
      isDirectory: true,
      permissionCheck: { hasRead: true, hasWrite: false },
      pendingRequest,
      ownerExists,
    });

    expect(result.hasReadPermission).toBe(true);
    expect(result.hasWritePermission).toBe(false);
    expect(result.pathPermission).toBe(null);
    expect(result.filePermissionLevel).toBe(null);
    expect(result.pendingRequest).toBe(pendingRequest);
    expect(result.ownerExists).toBe(ownerExists);
  });

  it('directory: directHasReadPermission overrides computed read (including false)', () => {
    const result = deriveSharedAccessState({
      isDirectory: true,
      permissionCheck: { hasRead: true, hasWrite: true },
      directHasReadPermission: false,
    });

    expect(result.hasReadPermission).toBe(false);
    expect(result.hasWritePermission).toBe(true);
  });

  it('file: derives pathPermission from parent check write/read and filePermissionLevel from file source', () => {
    const result = deriveSharedAccessState({
      isDirectory: false,
      permissionCheck: { hasRead: true, hasWrite: true, source: 'file' },
      parentPermissionCheck: { hasRead: true, hasWrite: false },
    });

    expect(result.hasReadPermission).toBe(true);
    expect(result.hasWritePermission).toBe(true);
    expect(result.pathPermission).toBe('read');
    expect(result.filePermissionLevel).toBe('write');
  });

  it('file: parentPermissionCheck null => pathPermission becomes none', () => {
    const result = deriveSharedAccessState({
      isDirectory: false,
      permissionCheck: { hasRead: true, hasWrite: false, source: 'file' },
      parentPermissionCheck: null,
    });

    expect(result.pathPermission).toBe('none');
    expect(result.filePermissionLevel).toBe('read');
  });

  it('file: source !== file => filePermissionLevel becomes null', () => {
    const result = deriveSharedAccessState({
      isDirectory: false,
      permissionCheck: { hasRead: true, hasWrite: true, source: 'path' },
      parentPermissionCheck: { hasRead: true, hasWrite: true },
    });

    expect(result.pathPermission).toBe('write');
    expect(result.filePermissionLevel).toBe(null);
  });

  it('missing permissionCheck fields => treats as no access', () => {
    const result = deriveSharedAccessState({
      isDirectory: false,
      permissionCheck: {},
      parentPermissionCheck: null,
    });

    expect(result.hasReadPermission).toBe(false);
    expect(result.hasWritePermission).toBe(false);
    expect(result.pathPermission).toBe('none');
    expect(result.filePermissionLevel).toBe(null);
  });
});

