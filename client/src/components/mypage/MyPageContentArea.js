import React from 'react';
import {
  Person as PersonIcon,
  Share as ShareIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  Palette as PaletteIcon,
} from '@mui/icons-material';
import MyPageContentPanel from './MyPageContentPanel';
import AccountContent from './content/AccountContent';
import SharingContent from './content/SharingContent';
import UserManagementContent from './content/UserManagementContent';
import SystemSettingsContent from './content/SystemSettingsContent';
import PreferencesContent from './content/PreferencesContent';

const MULTI_CATEGORIES = ['sharing'];

const CATEGORY_ICONS = {
  account: PersonIcon,
  sharing: ShareIcon,
  'admin-users': PeopleIcon,
  'admin-settings': SettingsIcon,
  preferences: PaletteIcon,
};

const MyPageContentArea = ({ selectedCategory, selectedContentItem, onSelectContentItem, user, onMessage }) => {
  const isMulti = MULTI_CATEGORIES.includes(selectedCategory);
  const inDetailView = isMulti && selectedContentItem != null;

  const onBack = inDetailView ? () => onSelectContentItem(null) : undefined;

  const renderContent = () => {
    if (selectedCategory === 'account') {
      return <AccountContent user={user} onMessage={onMessage} />;
    }
    if (selectedCategory === 'preferences') {
      return <PreferencesContent />;
    }
    if (selectedCategory === 'sharing') {
      return (
        <SharingContent
          selectedContentItem={selectedContentItem}
          onSelectContentItem={onSelectContentItem}
          user={user}
          onMessage={onMessage}
        />
      );
    }
    if (selectedCategory === 'admin-users') {
      return <UserManagementContent user={user} onMessage={onMessage} />;
    }
    if (selectedCategory === 'admin-settings') {
      return <SystemSettingsContent onMessage={onMessage} />;
    }
    return null;
  };

  const CategoryIcon = onBack ? null : CATEGORY_ICONS[selectedCategory];

  return (
    <MyPageContentPanel onBack={onBack} categoryIcon={CategoryIcon}>
      {renderContent()}
    </MyPageContentPanel>
  );
};

export default MyPageContentArea;
