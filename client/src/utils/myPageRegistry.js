import {
  Person as PersonIcon,
  Share as ShareIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  Palette as PaletteIcon,
} from '@mui/icons-material';

import AccountContent from '../components/mypage/content/AccountContent';
import SharingContent from '../components/mypage/content/SharingContent';
import UserManagementContent from '../components/mypage/content/UserManagementContent';
import SystemSettingsContent from '../components/mypage/content/SystemSettingsContent';
import PreferencesContent from '../components/mypage/content/PreferencesContent';

export const DEFAULT_MY_PAGE_CATEGORY = 'account';

export const MY_PAGE_MULTI_CATEGORIES = ['sharing'];

const MY_PAGE_CATEGORY_META = [
  {
    id: 'account',
    icon: PersonIcon,
    labelKey: 'mypage.accountInfo',
    visibility: 'all',
  },
  {
    id: 'sharing',
    icon: ShareIcon,
    labelKey: 'mypage.shareManage',
    visibility: 'nonAdminOnly',
  },
  {
    id: 'admin-users',
    icon: PeopleIcon,
    labelKey: 'admin.users',
    visibility: 'adminOnly',
  },
  {
    id: 'admin-settings',
    icon: SettingsIcon,
    labelKey: 'admin.systemSettings',
    visibility: 'adminOnly',
  },
  {
    id: 'preferences',
    icon: PaletteIcon,
    labelKey: 'mypage.preferences',
    visibility: 'all',
  },
];

export function isMyPageMultiCategory(categoryId) {
  return MY_PAGE_MULTI_CATEGORIES.includes(categoryId);
}

export function getMyPageCategoryIcon(categoryId) {
  return MY_PAGE_CATEGORY_META.find((c) => c.id === categoryId)?.icon;
}

export function getMyPageSidebarCategories(isAdmin) {
  return MY_PAGE_CATEGORY_META.filter((cat) => {
    if (cat.visibility === 'adminOnly') return Boolean(isAdmin);
    if (cat.visibility === 'nonAdminOnly') return !Boolean(isAdmin);
    return true;
  });
}

export function getMyPageContentDescriptor({
  selectedCategory,
  selectedContentItem,
  onSelectContentItem,
  user,
  onMessage,
}) {
  const inDetailView = isMyPageMultiCategory(selectedCategory) && selectedContentItem != null;
  const onBack = inDetailView ? () => onSelectContentItem(null) : undefined;

  if (selectedCategory === 'account') {
    return {
      categoryIcon: getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: AccountContent,
      contentProps: { user, onMessage },
    };
  }

  if (selectedCategory === 'preferences') {
    return {
      categoryIcon: getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: PreferencesContent,
      contentProps: {},
    };
  }

  if (selectedCategory === 'sharing') {
    return {
      categoryIcon: inDetailView ? null : getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: SharingContent,
      contentProps: {
        selectedContentItem,
        onSelectContentItem,
        user,
        onMessage,
      },
    };
  }

  if (selectedCategory === 'admin-users') {
    return {
      categoryIcon: getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: UserManagementContent,
      contentProps: { user, onMessage },
    };
  }

  if (selectedCategory === 'admin-settings') {
    return {
      categoryIcon: getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: SystemSettingsContent,
      contentProps: { onMessage },
    };
  }

  return {
    categoryIcon: null,
    onBack,
    ContentComponent: null,
    contentProps: {},
  };
}

// Normalizes route-state categories based on role/visibility rules.
// Preserves unknown ids (caller views will just not highlight anything).
export function resolveMyPageCategory(categoryId, isAdmin) {
  if (!categoryId) return DEFAULT_MY_PAGE_CATEGORY;

  if (categoryId === 'admin') {
    return isAdmin ? 'admin-users' : DEFAULT_MY_PAGE_CATEGORY;
  }

  if (categoryId === 'admin-users' || categoryId === 'admin-settings') {
    return isAdmin ? categoryId : DEFAULT_MY_PAGE_CATEGORY;
  }

  if (categoryId === 'sharing' && isAdmin) {
    return DEFAULT_MY_PAGE_CATEGORY;
  }

  return categoryId;
}

