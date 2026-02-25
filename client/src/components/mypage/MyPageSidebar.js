import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Person as PersonIcon,
  Share as ShareIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  Palette as PaletteIcon,
} from '@mui/icons-material';

const CATEGORIES = [
  { id: 'account', icon: PersonIcon, showWhenAdmin: true },
  { id: 'sharing', icon: ShareIcon, showWhenAdmin: false },
  { id: 'admin-users', icon: PeopleIcon, showWhenAdmin: true },
  { id: 'admin-settings', icon: SettingsIcon, showWhenAdmin: true },
  { id: 'preferences', icon: PaletteIcon, showWhenAdmin: true },
];

const MyPageSidebar = ({ selectedCategory, onSelectCategory, user, isMobile }) => {
  const { t } = useTranslation();
  const isAdmin = Boolean(user?.is_admin);

  const getLabel = (id) => {
    if (id === 'account') return t('mypage.accountInfo');
    if (id === 'sharing') return t('mypage.shareManage');
    if (id === 'admin-users') return t('admin.users');
    if (id === 'admin-settings') return t('admin.systemSettings');
    if (id === 'preferences') return t('mypage.preferences');
    return id;
  };

  const visibleCategories = CATEGORIES.filter((cat) => {
    if (cat.id === 'admin-users' || cat.id === 'admin-settings') return isAdmin;
    if (cat.id === 'sharing') return !isAdmin;
    return true;
  });

  return (
    <>
      {isMobile && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            pl: 2,
            py: 2,
            minHeight: 56,
          }}
        >
          <Box
            component="img"
            src="/logo.png"
            alt={t('nav.logoAlt')}
            sx={{
              height: 33.75,
              maxWidth: '100%',
              objectFit: 'contain',
            }}
          />
        </Box>
      )}
      <List sx={{ py: 1, minWidth: 240 }}>
        {visibleCategories.map(({ id, icon: Icon }) => (
          <ListItemButton
            key={id}
            selected={selectedCategory === id}
            onClick={() => onSelectCategory(id)}
            sx={
              !isMobile
                ? {
                  py: 0.75,
                  minHeight: 42,
                  borderTopRightRadius: 24,
                  borderBottomRightRadius: 24,
                }
                : undefined
            }
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={getLabel(id)} />
          </ListItemButton>
        ))}
      </List>
    </>
  );
};

export default MyPageSidebar;
