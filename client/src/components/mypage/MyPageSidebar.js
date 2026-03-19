import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';

const MyPageSidebar = ({ categories, selectedCategory, onSelectCategory, isMobile }) => {
  const { t } = useTranslation();

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
        {categories.map(({ id, icon: Icon, labelKey }) => (
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
            <ListItemText primary={t(labelKey)} />
          </ListItemButton>
        ))}
      </List>
    </>
  );
};

export default MyPageSidebar;
