import {
  Person as PersonIcon,
  Share as ShareIcon,
  Storage as StorageIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  Palette as PaletteIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material';

import AccountContent from '../components/mypage/content/AccountContent';
import SharingContent from '../components/mypage/content/SharingContent';
import UserManagementContent from '../components/mypage/content/UserManagementContent';
import SystemSettingsContent from '../components/mypage/content/SystemSettingsContent';
import PreferencesContent from '../components/mypage/content/PreferencesContent';
import CollectionDashboard from '../components/mypage/content/CollectionDashboard';
import AiAdminContent from '../components/mypage/content/AiAdminContent';

export const DEFAULT_MY_PAGE_CATEGORY = 'account';

const MY_PAGE_MULTI_CATEGORIES = ['sharing'];

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
    id: 'storage',
    icon: StorageIcon,
    labelKey: 'mypage.storage',
    // Operator rule (PLAN §14 client half): the collections dashboard is a
    // user surface — admin is a pure operator, never a participant.
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
    id: 'admin-ai',
    icon: SmartToyIcon,
    labelKey: 'mypage.adminAiOps',
    visibility: 'adminOnly',
  },
  {
    id: 'preferences',
    icon: PaletteIcon,
    labelKey: 'mypage.preferences',
    visibility: 'all',
  },
];

function isMyPageMultiCategory(categoryId) {
  return MY_PAGE_MULTI_CATEGORIES.includes(categoryId);
}

function getMyPageCategoryIcon(categoryId) {
  return MY_PAGE_CATEGORY_META.find((c) => c.id === categoryId)?.icon;
}

export function getMyPageSidebarCategories(isAdmin) {
  return MY_PAGE_CATEGORY_META.filter((cat) => {
    if (cat.visibility === 'adminOnly') return Boolean(isAdmin);
    if (cat.visibility === 'nonAdminOnly') return !isAdmin;
    return true;
  });
}

export function getMyPageContentDescriptor({
  selectedCategory,
  selectedContentItem,
  onSelectContentItem,
  user,
  onMessage,
  onNavigate,
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

  if (selectedCategory === 'storage') {
    return {
      categoryIcon: getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: CollectionDashboard,
      contentProps: { user, onNavigate, onMessage },
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

  if (selectedCategory === 'admin-ai') {
    return {
      categoryIcon: getMyPageCategoryIcon(selectedCategory),
      onBack,
      ContentComponent: AiAdminContent,
      contentProps: {},
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

  if (
    categoryId === 'admin-users' ||
    categoryId === 'admin-settings' ||
    categoryId === 'admin-ai'
  ) {
    return isAdmin ? categoryId : DEFAULT_MY_PAGE_CATEGORY;
  }

  if (categoryId === 'sharing' && isAdmin) {
    return DEFAULT_MY_PAGE_CATEGORY;
  }

  // Operator rule (PLAN §14 client half): storage (collections dashboard)
  // deep-links fall back for admins — mirrors the `sharing` precedent.
  if (categoryId === 'storage' && isAdmin) {
    return DEFAULT_MY_PAGE_CATEGORY;
  }

  return categoryId;
}
