import {
  DEFAULT_MY_PAGE_CATEGORY,
  getMyPageContentDescriptor,
  getMyPageSidebarCategories,
  resolveMyPageCategory,
} from '../myPageRegistry';
import { Person as PersonIcon } from '@mui/icons-material';
import AccountContent from '../../components/mypage/content/AccountContent';
import SharingContent from '../../components/mypage/content/SharingContent';
import AiAdminContent from '../../components/mypage/content/AiAdminContent';

describe('myPageRegistry', () => {
  describe('resolveMyPageCategory', () => {
    it('falls back to DEFAULT for missing category', () => {
      expect(resolveMyPageCategory(undefined, false)).toBe(DEFAULT_MY_PAGE_CATEGORY);
    });

    it('maps legacy admin to admin-users for admins and default for non-admins', () => {
      expect(resolveMyPageCategory('admin', true)).toBe('admin-users');
      expect(resolveMyPageCategory('admin', false)).toBe(DEFAULT_MY_PAGE_CATEGORY);
    });

    it('normalizes admin-only categories for non-admin users', () => {
      expect(resolveMyPageCategory('admin-users', false)).toBe(DEFAULT_MY_PAGE_CATEGORY);
      expect(resolveMyPageCategory('admin-settings', false)).toBe(DEFAULT_MY_PAGE_CATEGORY);
      expect(resolveMyPageCategory('admin-ai', false)).toBe(DEFAULT_MY_PAGE_CATEGORY);
      expect(resolveMyPageCategory('admin-ai', true)).toBe('admin-ai');
    });

    it('normalizes sharing for admins', () => {
      expect(resolveMyPageCategory('sharing', true)).toBe(DEFAULT_MY_PAGE_CATEGORY);
      expect(resolveMyPageCategory('sharing', false)).toBe('sharing');
    });

    it('normalizes storage for admins (operator rule — PLAN §14 client half)', () => {
      expect(resolveMyPageCategory('storage', true)).toBe(DEFAULT_MY_PAGE_CATEGORY);
      expect(resolveMyPageCategory('storage', false)).toBe('storage');
    });

    it('preserves unknown categories', () => {
      expect(resolveMyPageCategory('weird', true)).toBe('weird');
    });
  });

  describe('getMyPageSidebarCategories', () => {
    it('includes admin-only categories only for admins', () => {
      const idsAdmin = getMyPageSidebarCategories(true).map((c) => c.id);
      expect(idsAdmin).toEqual(
        expect.arrayContaining([
          'account',
          'admin-users',
          'admin-settings',
          'admin-ai',
          'preferences',
        ])
      );
      expect(idsAdmin).not.toEqual(expect.arrayContaining(['sharing']));
      // operator rule (PLAN §14 client half): the collections dashboard entry
      // is hidden for admins — admin never participates in collections.
      expect(idsAdmin).not.toEqual(expect.arrayContaining(['storage']));
    });

    it('includes sharing only for non-admins', () => {
      const idsNonAdmin = getMyPageSidebarCategories(false).map((c) => c.id);
      expect(idsNonAdmin).toEqual(
        expect.arrayContaining(['account', 'sharing', 'storage', 'preferences'])
      );
      expect(idsNonAdmin).not.toEqual(expect.arrayContaining(['admin-users', 'admin-settings']));
    });
  });

  describe('getMyPageContentDescriptor', () => {
    it('returns the account content descriptor for account', () => {
      const descriptor = getMyPageContentDescriptor({
        selectedCategory: 'account',
        selectedContentItem: null,
        onSelectContentItem: jest.fn(),
        user: { username: 'testuser' },
        onMessage: jest.fn(),
      });

      expect(descriptor.ContentComponent).toBe(AccountContent);
      expect(descriptor.contentProps.user).toEqual({ username: 'testuser' });
      expect(descriptor.categoryIcon).toBe(PersonIcon);
      expect(descriptor.onBack).toBeUndefined();
    });

    it('returns the AI operations content descriptor for admin-ai', () => {
      const descriptor = getMyPageContentDescriptor({
        selectedCategory: 'admin-ai',
        selectedContentItem: null,
        onSelectContentItem: jest.fn(),
        user: { username: 'admin', is_admin: true },
        onMessage: jest.fn(),
      });
      expect(descriptor.ContentComponent).toBe(AiAdminContent);
      expect(descriptor.contentProps).toEqual({});
    });

    it('returns a detail descriptor with onBack for sharing detail view', () => {
      const onSelectContentItem = jest.fn();
      const descriptor = getMyPageContentDescriptor({
        selectedCategory: 'sharing',
        selectedContentItem: 'inbox',
        onSelectContentItem,
        user: { username: 'testuser' },
        onMessage: jest.fn(),
      });

      expect(descriptor.ContentComponent).toBe(SharingContent);
      expect(descriptor.categoryIcon).toBeNull();
      expect(typeof descriptor.onBack).toBe('function');

      descriptor.onBack();
      expect(onSelectContentItem).toHaveBeenCalledWith(null);
    });
  });
});
