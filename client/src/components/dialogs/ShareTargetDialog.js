import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  List,
  ListItem,
  Select,
  MenuItem,
  FormControl,
  CircularProgress,
  Popper,
  Paper,
  ListItemButton,
} from '@mui/material';
import { useResponsive } from '../../hooks/useResponsive';
import { getApprovedUsers } from '../../services/userService';
import sharePermissionGateway from '../../services/sharePermissionGateway';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { getPermissionLabels } from '../../constants/permissions';
import { normalizePath } from '../../utils/pathUtils';
import { getParentPath } from '@webdav-easyaccess/shared/pathUtils';
import { createShareLink, getShareLinkUrl } from '../../services/shareLinkService';
import ExternalShareSection from './ExternalShareSection';
import { useSharedManage } from '../../hooks/useSharedManage';
import { getServerErrorDisplay } from '../../utils/errorUtils';
import SharedManageBody from './SharedManageBody';
import { shareTargetPermissionSaveUseCase } from '../../services/shareTargetPermissionSaveUseCase';

const getPermissionOptions = (t) => [
  { value: PERMISSIONS.WRITE, label: t('dialogs.editor') },
  { value: PERMISSIONS.READ, label: t('dialogs.viewer') },
  { value: 'revoke', label: t('dialogs.revoke') },
];

function permissionRank(p) {
  const idx = PERMISSIONS.ALL.indexOf(p);
  return idx < 0 ? -1 : idx;
}

/**
 * 파일 공유 시: 경로와 동일 + 경로보다 높은 권한만 옵션으로 (회수 없음).
 * 소유자(admin)는 선택 불가. 경로 권한이 소유자면 소유자 라벨만 표시.
 * 경로 권한이 없을 때(pathPermission == null): 열람자, 편집자, 삭제.
 * hasSameLevelFilePermission true면 경로 옵션은 편집자/열람자 라벨로 하고, '경로와 동일'(revoke) 옵션 추가.
 */
function getFilePermissionOptions(pathPermission, hasSameLevelFilePermission, t) {
  const labels = getPermissionLabels(t);
  if (pathPermission == null) {
    return [
      { value: PERMISSIONS.READ, label: labels[PERMISSIONS.READ] },
      { value: PERMISSIONS.WRITE, label: labels[PERMISSIONS.WRITE] },
      { value: 'revoke', label: t('common.delete') },
    ];
  }
  const path = pathPermission;
  if (path === PERMISSIONS.ADMIN) {
    return [{ value: PERMISSIONS.ADMIN, label: labels[PERMISSIONS.ADMIN] }];
  }
  const rank = permissionRank(path);
  const pathOptionLabel = hasSameLevelFilePermission ? labels[path] || path : t('dialogs.sameAsPath');
  const options = [{ value: path, label: pathOptionLabel }];
  PERMISSIONS.ALL.forEach((perm) => {
    if (perm !== PERMISSIONS.ADMIN && permissionRank(perm) > rank) {
      options.push({ value: perm, label: labels[perm] || perm });
    }
  });
  if (hasSameLevelFilePermission) {
    options.push({ value: 'revoke', label: t('dialogs.sameAsPath') });
  }
  return options;
}

/**
 * 공유 관리 영역 — hasAdmin false 일 때 (폴더/파일 통합)
 */
function ShareManageContent({ open, file, user, onMessage, onActionComplete, onClose }) {
  const targetPath = file?.path ? normalizePath(file.path) : null;
  const displayName = file?.basename || file?.name || '';
  const isDirectory = file?.type === 'directory';
  const directHasReadPermission =
    typeof file?.hasReadPermission === 'boolean' ? file.hasReadPermission : undefined;

  const {
    loading,
    initialLoading,
    confirmDialogOpen,
    setConfirmDialogOpen,
    hasReadPermission,
    hasWritePermission,
    pathPermission,
    filePermissionLevel,
    pendingRequest,
    ownerExists,
    handleCancelPendingRequest,
    handlePermissionRequest,
    handleRevokePermission,
  } = useSharedManage({
    open,
    targetPath,
    displayName,
    isDirectory,
    user,
    directHasReadPermission,
    onMessage,
    onActionComplete,
    onClose,
  });

  return (
    <SharedManageBody
      displayName={displayName}
      isDirectory={isDirectory}
      loading={loading}
      initialLoading={initialLoading}
      confirmDialogOpen={confirmDialogOpen}
      setConfirmDialogOpen={setConfirmDialogOpen}
      hasReadPermission={hasReadPermission}
      hasWritePermission={hasWritePermission}
      pathPermission={pathPermission}
      filePermissionLevel={filePermissionLevel}
      pendingRequest={pendingRequest}
      ownerExists={ownerExists}
      onRequestPermission={handlePermissionRequest}
      onCancelPendingRequest={handleCancelPendingRequest}
      onRevokePermission={handleRevokePermission}
      loadingVariant="skeleton"
    />
  );
}

const ShareTargetDialog = ({
  open,
  onClose,
  file,
  user,
  onMessage,
  onSave,
}) => {
  const { t } = useTranslation();
  const permissionLabels = React.useMemo(() => getPermissionLabels(t), [t]);
  const { isMobile } = useResponsive();
  const [users, setUsers] = useState([]);
  const [accessList, setAccessList] = useState([]);
  const [initialAccessList, setInitialAccessList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchAnchorEl, setSearchAnchorEl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // External share link state (file only)
  const [externalShareLoading, setExternalShareLoading] = useState(false);
  const [externalShareLink, setExternalShareLink] = useState(null);
  const [externalShareExpiresInDays, setExternalShareExpiresInDays] = useState(14);
  const [externalShareUnlimited, setExternalShareUnlimited] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const targetPath = file?.path ? normalizePath(file.path) : null;
  const isDirectory = file?.type === 'directory';
  const displayName = file?.basename || file?.name || '';
  const hasAdmin = Boolean(user?.is_admin || file?.hasAdminPermission);

  const loadUsers = useCallback(async () => {
    try {
      const data = await getApprovedUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load users:', err);
      if (onMessage) onMessage({ show: true, text: t('dialogs.userListLoadFail'), type: 'error' });
    }
  }, [onMessage, t]);

  const loadPermissions = useCallback(async () => {
    if (!targetPath) return;
    setLoading(true);
    try {
      const pathToQuery = isDirectory ? targetPath : getParentPath(targetPath);
      const filePathParam = isDirectory ? undefined : targetPath;
      const data = await sharePermissionGateway.getFolderPermissions(pathToQuery, false, filePathParam);
      const list = (data || [])
        .filter((p) => !p.is_admin)
        .map((p) => {
          if (isDirectory) {
            return {
              id: p.id,
              username: p.username || '',
              email: p.email || '',
              permission: p.permission || PERMISSIONS.READ,
            };
          }
          const pathPermission = p.permission ?? null;
          const filePermission = p.file_permission ?? null;
          return {
            id: p.id,
            username: p.username || '',
            email: p.email || '',
            pathPermission,
            filePermission,
            permission: filePermission ?? pathPermission ?? PERMISSIONS.READ,
          };
        });
      setAccessList(list);
      setInitialAccessList(list.map((u) => ({ ...u })));
    } catch (err) {
      console.error('Failed to load permissions:', err);
      if (onMessage) onMessage({ show: true, text: t('dialogs.permissionListLoadFail'), type: 'error' });
      setAccessList([]);
      setInitialAccessList([]);
    } finally {
      setLoading(false);
    }
  }, [targetPath, isDirectory, onMessage, t]);

  useEffect(() => {
    if (open) {
      if (hasAdmin) {
        loadUsers();
        if (targetPath) loadPermissions();
      }
      setSearchQuery('');
      setSearchOpen(false);
      setExternalShareLink(null);
      setExternalShareExpiresInDays(14);
      setExternalShareUnlimited(false);
      setLinkCopied(false);
    } else {
      setSearchAnchorEl(null);
    }
  }, [open, targetPath, hasAdmin, loadUsers, loadPermissions]);

  const filteredUsers = users.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  const addUser = useCallback((u) => {
    setAccessList((prev) => {
      if (prev.some((x) => x.id === u.id)) return prev;
      if (isDirectory) {
        return [...prev, { id: u.id, username: u.username, email: u.email || '', permission: PERMISSIONS.READ }];
      }
      return [...prev, {
        id: u.id,
        username: u.username,
        email: u.email || '',
        pathPermission: undefined,
        filePermission: null,
        permission: PERMISSIONS.READ,
      }];
    });
    setSearchQuery('');
    setSearchOpen(false);
  }, [isDirectory]);

  const setUserPermission = useCallback((userId, permission, pathPermissionOfUser) => {
    if (permission === 'revoke' && (isDirectory || pathPermissionOfUser == null)) {
      setAccessList((prev) => prev.filter((x) => x.id !== userId));
      return;
    }
    setAccessList((prev) =>
      prev.map((x) => (x.id === userId ? { ...x, permission } : x))
    );
  }, [isDirectory]);

  const handleSave = useCallback(async () => {
    if (!targetPath) return;
    setSaving(true);
    try {
      await shareTargetPermissionSaveUseCase({
        targetPath,
        isDirectory,
        initialAccessList,
        accessList,
      });

      if (onMessage) onMessage({ show: true, text: isDirectory ? t('dialogs.folderShareSuccess') : t('dialogs.permissionSaveSuccess'), type: 'success' });
      if (onSave) onSave();
      onClose();
    } catch (err) {
      const msg = getServerErrorDisplay(err?.response?.data, t) || (isDirectory ? t('dialogs.folderShareFail') : t('dialogs.permissionSaveFail'));
      if (onMessage) onMessage({ show: true, text: msg, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [
    targetPath,
    isDirectory,
    initialAccessList,
    accessList,
    onMessage,
    onSave,
    onClose,
    t,
  ]);

  const handleSearchFocus = (e) => {
    setSearchAnchorEl(e.currentTarget);
    setSearchOpen(true);
  };

  const handleSearchBlur = () => {
    setTimeout(() => setSearchOpen(false), 200);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: isMobile ? {} : { maxHeight: '85vh' },
        }}
      >
        <DialogTitle>{displayName ? `${displayName} ${t('dialogs.shareWith')}` : t('dialogs.shareWith')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, overflow: 'hidden' }}>
          {hasAdmin ? (
          <>
          <Box ref={(el) => setSearchAnchorEl(el || null)}>
            <TextField
              fullWidth
              size="small"
              placeholder={t('dialogs.userSearchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
            />
          </Box>
          <Popper open={searchOpen} anchorEl={searchAnchorEl} placement="bottom-start" style={{ zIndex: 1400 }} sx={{ width: searchAnchorEl ? searchAnchorEl.offsetWidth : undefined }}>
            <Paper elevation={2} sx={{ maxHeight: 280, overflow: 'auto' }}>
              {filteredUsers.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('dialogs.noSearchResults')}
                  </Typography>
                </Box>
              ) : (
                <List dense>
                  {filteredUsers.map((u) => (
                    <ListItem key={u.id} disablePadding>
                      <ListItemButton
                        onClick={() => addUser(u)}
                        disabled={accessList.some((x) => x.id === u.id)}
                      >
                        <Box>
                          <Typography variant="body2">{u.username}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {u.email || ''}
                          </Typography>
                        </Box>
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          </Popper>

          <Typography variant="subtitle2" color="text.secondary">
            {t('dialogs.usersWithAccess')}
          </Typography>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'auto', maxHeight: 280 }}>
              {accessList.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('dialogs.noUsersWithAccess')}
                  </Typography>
                </Box>
              ) : (
                <List dense>
                  {[...accessList]
                    .sort((a, b) => {
                      if (a.permission === PERMISSIONS.ADMIN && b.permission !== PERMISSIONS.ADMIN) return -1;
                      if (a.permission !== PERMISSIONS.ADMIN && b.permission === PERMISSIONS.ADMIN) return 1;
                      return 0;
                    })
                    .map((u) => (
                    <ListItem
                      key={u.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {u.username}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>
                          {u.email || ''}
                        </Typography>
                      </Box>
                      <FormControl size="small" sx={{ minWidth: 0 }}>
                        <Select
                          value={u.permission === PERMISSIONS.ADMIN ? PERMISSIONS.ADMIN : u.permission}
                          onChange={(e) => setUserPermission(u.id, e.target.value, u.pathPermission)}
                          displayEmpty
                          disabled={(isDirectory && u.permission === PERMISSIONS.ADMIN) || (!isDirectory && u.pathPermission === PERMISSIONS.ADMIN)}
                          renderValue={(v) => {
                            if (v === PERMISSIONS.ADMIN) return permissionLabels[PERMISSIONS.ADMIN];
                            if (v === 'revoke') return t('dialogs.sameAsPath');
                            if (!isDirectory && u.pathPermission != null && v === u.pathPermission) {
                              if (u.filePermission != null && u.filePermission === u.pathPermission) return permissionLabels[v] || v;
                              return t('dialogs.sameAsPath');
                            }
                            return permissionLabels[v] || v;
                          }}
                          variant="standard"
                          disableUnderline
                          IconComponent={() => null}
                          sx={{
                            color: 'text.secondary',
                            fontSize: '0.875rem',
                            cursor: (isDirectory && u.permission === PERMISSIONS.ADMIN) || (!isDirectory && u.pathPermission === PERMISSIONS.ADMIN) ? 'default' : 'pointer',
                            padding: 0,
                            textAlign: 'right',
                            backgroundColor: 'transparent',
                            '& .MuiSelect-select': {
                              padding: 0,
                              textAlign: 'right',
                              backgroundColor: 'transparent',
                            },
                            '&:hover:not(.Mui-disabled)': {
                              color: 'text.primary',
                              backgroundColor: 'transparent',
                            },
                            '&.Mui-focused': {
                              backgroundColor: 'transparent',
                              boxShadow: 'none',
                              outline: 'none',
                            },
                            '&.Mui-focused .MuiSelect-select': { backgroundColor: 'transparent' },
                            '& .MuiSelect-select:hover': { backgroundColor: 'transparent' },
                            '& .MuiSelect-select:focus': {
                              backgroundColor: 'transparent',
                              outline: 'none',
                              boxShadow: 'none',
                            },
                          }}
                        >
                          {((isDirectory && u.permission === PERMISSIONS.ADMIN) || (!isDirectory && u.pathPermission === PERMISSIONS.ADMIN)) && (
                            <MenuItem value={PERMISSIONS.ADMIN} disabled>
                              {permissionLabels[PERMISSIONS.ADMIN]}
                            </MenuItem>
                          )}
                          {isDirectory
                            ? getPermissionOptions(t).map((opt) => (
                                <MenuItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </MenuItem>
                              ))
                            : u.pathPermission !== PERMISSIONS.ADMIN &&
                              getFilePermissionOptions(u.pathPermission, u.filePermission != null && u.filePermission === u.pathPermission, t).map((opt) => (
                                <MenuItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </MenuItem>
                              ))}
                        </Select>
                      </FormControl>
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}

          {file && (
            <ExternalShareSection
              externalShareLink={externalShareLink}
              setExternalShareLink={setExternalShareLink}
              externalShareLoading={externalShareLoading}
              setExternalShareLoading={setExternalShareLoading}
              externalShareExpiresInDays={externalShareExpiresInDays}
              setExternalShareExpiresInDays={setExternalShareExpiresInDays}
              externalShareUnlimited={externalShareUnlimited}
              setExternalShareUnlimited={setExternalShareUnlimited}
              linkCopied={linkCopied}
              setLinkCopied={setLinkCopied}
              createShareLink={createShareLink}
              getShareLinkUrl={getShareLinkUrl}
              filePath={targetPath}
              fileName={displayName}
              onMessage={onMessage}
            />
          )}
          </>
          ) : (
          <ShareManageContent
            open={open}
            file={file}
            user={user}
            onMessage={onMessage}
            onActionComplete={onSave}
            onClose={onClose}
          />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          {hasAdmin ? (
            <>
              <Button onClick={onClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button variant="contained" color="primary" onClick={handleSave} disabled={saving || loading}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>
              {t('common.close')}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ShareTargetDialog;
