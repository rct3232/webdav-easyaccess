import {
  DEFAULT_MY_PAGE_CATEGORY,
  getMyPageCategoryIcon,
  getMyPageContentDescriptor,
  getMyPageSidebarCategories,
  isMyPageMultiCategory,
  resolveMyPageCategory,
} from '../myPageRegistry';
import {
  Person as PersonIcon,
  Share as ShareIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  Palette as PaletteIcon,
} from '@mui/icons-material';
import AccountContent from '../../components/mypage/content/AccountContent';
import SharingContent from '../../components/mypage/content/SharingContent';

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
    });

    it('normalizes sharing for admins', () => {
      expect(resolveMyPageCategory('sharing', true)).toBe(DEFAULT_MY_PAGE_CATEGORY);
      expect(resolveMyPageCategory('sharing', false)).toBe('sharing');
    });

    it('preserves unknown categories', () => {
      expect(resolveMyPageCategory('weird', true)).toBe('weird');
    });
  });

  describe('getMyPageSidebarCategories', () => {
    it('includes admin-only categories only for admins', () => {
      const idsAdmin = getMyPageSidebarCategories(true).map((c) => c.id);
      expect(idsAdmin).toEqual(
        expect.arrayContaining(['account', 'admin-users', 'admin-settings', 'preferences'])
      );
      expect(idsAdmin).not.toEqual(expect.arrayContaining(['sharing']));
    });

    it('includes sharing only for non-admins', () => {
      const idsNonAdmin = getMyPageSidebarCategories(false).map((c) => c.id);
      expect(idsNonAdmin).toEqual(expect.arrayContaining(['account', 'sharing', 'preferences']));
      expect(idsNonAdmin).not.toEqual(expect.arrayContaining(['admin-users', 'admin-settings']));
    });
  });

  describe('isMyPageMultiCategory and getMyPageCategoryIcon', () => {
    it('sharing is multi-item; other known categories are not', () => {
      expect(isMyPageMultiCategory('sharing')).toBe(true);
      expect(isMyPageMultiCategory('account')).toBe(false);
      expect(isMyPageMultiCategory('preferences')).toBe(false);
    });

    it('returns expected icon component for known categories', () => {
      expect(getMyPageCategoryIcon('account')).toBe(PersonIcon);
      expect(getMyPageCategoryIcon('sharing')).toBe(ShareIcon);
      expect(getMyPageCategoryIcon('admin-users')).toBe(PeopleIcon);
      expect(getMyPageCategoryIcon('admin-settings')).toBe(SettingsIcon);
      expect(getMyPageCategoryIcon('preferences')).toBe(PaletteIcon);
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
