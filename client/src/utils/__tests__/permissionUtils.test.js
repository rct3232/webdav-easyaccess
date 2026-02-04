import { hasReadPermission, hasWritePermission, isPermissionDisabled, getPermissionLevel, getHigherPermission } from '../permissionUtils';

describe('permissionUtils', () => {
  describe('hasReadPermission', () => {
    it('returns hasReadPermission from object', () => {
      expect(hasReadPermission({ hasReadPermission: true })).toBe(true);
      expect(hasReadPermission({ hasReadPermission: false })).toBe(false);
    });

    it('returns fallback when hasReadPermission is undefined', () => {
      expect(hasReadPermission({}, true)).toBe(true);
      expect(hasReadPermission({}, false)).toBe(false);
      expect(hasReadPermission(null, true)).toBe(true);
    });

    it('defaults to true if fallback is not provided', () => {
      expect(hasReadPermission({})).toBe(true);
    });
  });

  describe('hasWritePermission', () => {
    it('returns hasWritePermission from object', () => {
      expect(hasWritePermission({ hasWritePermission: true })).toBe(true);
      expect(hasWritePermission({ hasWritePermission: false })).toBe(false);
    });

    it('returns fallback when hasWritePermission is undefined', () => {
      expect(hasWritePermission({}, true)).toBe(true);
      expect(hasWritePermission({}, false)).toBe(false);
      expect(hasWritePermission(null, true)).toBe(true);
    });

    it('defaults to true if fallback is not provided', () => {
      expect(hasWritePermission({})).toBe(true);
    });
  });

  describe('isPermissionDisabled', () => {
    it('returns true if hasReadPermission is false', () => {
      expect(isPermissionDisabled({ hasReadPermission: false })).toBe(true);
    });

    it('returns false if hasReadPermission is true or undefined', () => {
      expect(isPermissionDisabled({ hasReadPermission: true })).toBe(false);
      expect(isPermissionDisabled({})).toBe(false);
      expect(isPermissionDisabled(null)).toBe(false);
    });
  });

  describe('getPermissionLevel', () => {
    it('returns correct levels', () => {
      expect(getPermissionLevel('write')).toBe(2);
      expect(getPermissionLevel('read')).toBe(1);
      expect(getPermissionLevel(null)).toBe(0);
      expect(getPermissionLevel('')).toBe(0);
      expect(getPermissionLevel('unknown')).toBe(0);
    });
  });

  describe('getHigherPermission', () => {
    it('prefers write over read', () => {
      expect(getHigherPermission('write', 'read')).toBe('write');
      expect(getHigherPermission('read', 'write')).toBe('write');
    });

    it('returns perm1 if equal', () => {
      expect(getHigherPermission('read', 'read')).toBe('read');
      expect(getHigherPermission('write', 'write')).toBe('write');
    });

    it('prefers read over none', () => {
      expect(getHigherPermission('read', null)).toBe('read');
      expect(getHigherPermission(null, 'read')).toBe('read');
    });
  });
});
