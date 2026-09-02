import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, IconButton, Button, Alert } from '@mui/material';
import { Edit as EditIcon, Logout as LogoutIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePageHeader } from '../../../contexts/PageHeaderContext';
import { AccountEditDialog } from '../../dialogs';
import {
  updateEmail as updateEmailApi,
  updatePassword as updatePasswordApi,
} from '../../../services/userService';
import {
  validateEmail,
  validatePassword,
  validateMatch,
} from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../../utils/validationMessage';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const AccountContent = ({ user }) => {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { setTitle, setActions } = usePageHeader();

  const [email, setEmail] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
      setOriginalEmail(user.email || '');
    }
  }, [user]);

  const emailChanged = normalizeEmail(email) !== normalizeEmail(originalEmail);
  const passwordEntered = password.length > 0 || confirmPassword.length > 0;
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const passwordTooShort = passwordEntered && password.length > 0 && password.length < 4;
  const passwordConfirmMissing = passwordEntered && confirmPassword.length === 0;
  const emailEmpty = emailChanged && normalizeEmail(email).length === 0;

  const canSave =
    ((emailChanged && !emailEmpty) || passwordEntered) &&
    !(passwordEntered && (passwordMismatch || passwordTooShort || passwordConfirmMissing));

  const handleOpenEditDialog = useCallback(() => {
    if (!user) return;
    setOriginalEmail(email || user.email || '');
    setPassword('');
    setConfirmPassword('');
    setMessage({ type: '', text: '' });
    setEditDialogOpen(true);
  }, [user, email]);

  const handleCloseEditDialog = () => {
    setEmail(originalEmail || '');
    setPassword('');
    setConfirmPassword('');
    setEditDialogOpen(false);
  };

  const handleSaveAccountChanges = async () => {
    if (!user) return;
    if (!canSave) return;

    const trimmedEmail = String(email || '').trim();
    const shouldUpdateEmail = emailChanged;
    const shouldUpdatePassword = passwordEntered;

    if (shouldUpdateEmail) {
      const emailError = validateEmail(trimmedEmail);
      if (emailError) {
        setMessage({ type: 'error', text: getValidationMessage(emailError, t) });
        return;
      }
    }

    if (shouldUpdatePassword) {
      if (passwordConfirmMissing) {
        setMessage({ type: 'error', text: t('mypage.confirmPasswordRequired') });
        return;
      }
      const matchError = validateMatch(password, confirmPassword, t('login.password'));
      if (matchError) {
        setMessage({ type: 'error', text: getValidationMessage(matchError, t) });
        return;
      }
      const passwordError = validatePassword(password, { minLength: 4 });
      if (passwordError) {
        setMessage({ type: 'error', text: getValidationMessage(passwordError, t) });
        return;
      }
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    let emailUpdated = false;
    try {
      if (shouldUpdateEmail) {
        await updateEmailApi(user.id, trimmedEmail);
        emailUpdated = true;
        setOriginalEmail(trimmedEmail);
      }

      if (shouldUpdatePassword) {
        await updatePasswordApi(user.id, password);
        setMessage({
          type: 'success',
          text: t('mypage.passwordChangedSuccess'),
        });
        setPassword('');
        setConfirmPassword('');
        setEditDialogOpen(false);
        logout();
        return;
      }

      if (shouldUpdateEmail) {
        setMessage({ type: 'success', text: t('mypage.emailChangedSuccess') });
        setEditDialogOpen(false);
      }
    } catch (error) {
      const serverMsg = getServerErrorDisplay(error?.response?.data, t);
      if (emailUpdated && shouldUpdatePassword) {
        setMessage({
          type: 'error',
          text: serverMsg
            ? `${t('mypage.emailChangedPasswordFail')}: ${serverMsg}`
            : t('mypage.emailChangedPasswordFail'),
        });
      } else {
        setMessage({
          type: 'error',
          text: serverMsg || t('mypage.saveFail'),
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const showMessage = message.text;

  useEffect(() => {
    setTitle(t('mypage.accountInfo'));
    setActions(
      <IconButton
        aria-label={t('mypage.editAccountInfo')}
        onClick={handleOpenEditDialog}
        size="small"
      >
        <EditIcon />
      </IconButton>
    );
  }, [t, handleOpenEditDialog, setTitle, setActions]);

  if (!user) return null;

  return (
    <Box>
      {showMessage && (
        <Alert
          severity={message.type}
          sx={{ mb: 2 }}
          onClose={() => setMessage({ type: '', text: '' })}
        >
          {message.text}
        </Alert>
      )}

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('login.username')}
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {user.username}
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('dialogs.email')}
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {email || user.email || '-'}
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('mypage.accountStatus')}
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {user.status === 'approved'
            ? t('mypage.approvedStatus')
            : user.status === 'pending'
              ? t('mypage.pending')
              : user.status === 'rejected'
                ? t('mypage.rejected')
                : user.status}
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('mypage.permission')}
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {user.is_admin ? t('mypage.admin') : t('mypage.normalUser')}
        </Typography>
      </Box>

      <Button
        variant="outlined"
        color="inherit"
        startIcon={<LogoutIcon />}
        onClick={handleLogout}
        fullWidth
      >
        {t('nav.logout')}
      </Button>

      <AccountEditDialog
        open={editDialogOpen}
        onClose={handleCloseEditDialog}
        email={email}
        onEmailChange={setEmail}
        password={password}
        onPasswordChange={setPassword}
        confirmPassword={confirmPassword}
        onConfirmPasswordChange={setConfirmPassword}
        loading={loading}
        canSave={canSave}
        onSave={handleSaveAccountChanges}
        message={message}
        onClearMessage={() => setMessage({ type: '', text: '' })}
      />
    </Box>
  );
};

export default AccountContent;
