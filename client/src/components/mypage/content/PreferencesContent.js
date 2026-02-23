import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { getFlagEmoji } from '../../../utils/flagEmoji';
import i18n from '../../../i18n';
import { usePageHeader } from '../../../contexts/PageHeaderContext';

const LANGUAGES = [
  { code: 'ko', label: 'ko' },
  { code: 'en', label: 'en' },
];

const PreferencesContent = () => {
  const { t } = useTranslation();
  const { setTitle, setActions } = usePageHeader();
  const [anchorEl, setAnchorEl] = useState(null);

  useEffect(() => {
    setTitle(t('mypage.preferences'));
    setActions(null);
  }, [t, setTitle, setActions]);

  const handleOpenMenu = (e) => setAnchorEl(e.currentTarget);
  const handleCloseMenu = () => setAnchorEl(null);
  const handleSelect = (code) => {
    i18n.changeLanguage(code);
    handleCloseMenu();
  };

  const currentLang = LANGUAGES.find(
    (l) => i18n.language === l.code || i18n.language?.startsWith(l.code)
  );
  const isSelected = (code) =>
    i18n.language === code || i18n.language?.startsWith(code);

  return (
    <Box>
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('mypage.language')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('mypage.languageDesc')}</Typography>
        </Box>
        <IconButton
          onClick={handleOpenMenu}
          aria-label={t('mypage.language')}
          aria-controls={anchorEl ? 'language-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={Boolean(anchorEl)}
          color="primary"
          sx={{ ml: 2 }}
        >
          <Box
            component="span"
            sx={{ fontSize: '1.25rem', lineHeight: 1 }}
            aria-hidden
          >
            {currentLang ? getFlagEmoji(currentLang.code) : ''}
          </Box>
        </IconButton>
      </Box>
      <Menu
        id="language-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {LANGUAGES.map(({ code, label }) => (
          <MenuItem
            key={code}
            onClick={() => handleSelect(code)}
            selected={isSelected(code)}
          >
            <span style={{ marginRight: 8 }}>{getFlagEmoji(code)}</span>
            {label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

export default PreferencesContent;
