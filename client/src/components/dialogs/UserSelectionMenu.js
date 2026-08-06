import React from 'react';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import {
  Menu,
  MenuItem,
  ListItemText,
  Box,
  Chip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Edit as EditIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { deriveShareFolderAccessView } from '../../utils/deriveShareFolderAccessView';

const UserSelectionMenu = ({
  folderMenuAnchor,
  onClose,
  folderMenuPath,
  folderPermissions,
  isAdminMode,
  userId,
  username,
  user,
  userInfoMap,
  users,
  getUserName,
  handleTogglePermission,
  handleRemoveUser,
  folderMenuView,
  setFolderMenuView,
  isShareMode,
  isReviewMode,
  handleAddUser,
  permissionRequest,
  handleUserSelect,
}) => {
  const { t } = useTranslation();
  if (!folderMenuPath) return null;

  const {
    displayUsers,
    availableUsers,
    currentIsUserBaseFolder,
    reviewRequesterOption,
  } = deriveShareFolderAccessView({
    nodeId: folderMenuPath,
    folderPermissions,
    isAdminMode,
    userId,
    username,
    user,
    userInfoMap,
    users,
    getUserName,
    isReviewMode,
    permissionRequest,
  });

  const renderManageView = () => (
    <>
      {displayUsers.map(({ userId: targetUserId, permission, userName }) => {
          const canEdit = !currentIsUserBaseFolder || targetUserId !== userId;
          const isWrite = permission === PERMISSIONS.WRITE;
          
          return (
            <MenuItem
              key={targetUserId}
              onClick={(e) => {
                e.stopPropagation();
              }}
              sx={{ py: 0.5 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
                <Chip
                  label={userName}
                  size="small"
                  avatar={
                    <Box
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canEdit) {
                          handleTogglePermission(folderMenuPath, targetUserId);
                        }
                      }}
                      sx={{ 
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        backgroundColor: isWrite ? 'primary.main' : 'grey.400',
                        cursor: canEdit ? 'pointer' : 'default',
                        '&:hover': canEdit ? { opacity: 0.8 } : {},
                        marginLeft: '4px',
                        marginRight: '-4px'
                      }}
                    >
                      <EditIcon sx={{ fontSize: 12, color: 'white' }} />
                    </Box>
                  }
                  onDelete={(e) => {
                    e.stopPropagation();
                    if (canEdit) {
                      handleRemoveUser(folderMenuPath, targetUserId);
                    }
                  }}
                  deleteIcon={<CloseIcon />}
                  sx={{ 
                    backgroundColor: 'grey.200',
                    border: 'none',
                    flex: 1,
                    '& .MuiChip-avatar': {
                      marginLeft: '4px',
                      marginRight: '-4px'
                    }
                  }}
                />
              </Box>
            </MenuItem>
          );
        })}
      
      {displayUsers.length > 0 && (
        <MenuItem disabled sx={{ py: 0 }}>
          <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
        </MenuItem>
      )}
      
      <MenuItem
        onClick={(e) => {
          e.stopPropagation();
          if (isShareMode || isReviewMode) {
            setFolderMenuView('selectUser');
          } else {
            handleAddUser(folderMenuPath);
          }
        }}
      >
        <ListItemText 
          primary={t('dialogs.addUser')} 
          primaryTypographyProps={{ 
            sx: { 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1 
            } 
          }}
        />
        <AddIcon fontSize="small" sx={{ ml: 1 }} />
      </MenuItem>
    </>
  );

  const renderSelectUserView = () => {
    if (reviewRequesterOption) {
      const requesterName =
        reviewRequesterOption.userName
        || t('dialogs.userIdFallback', { id: reviewRequesterOption.userId });

      return (
        <>
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              setFolderMenuView('manage');
            }}
          >
            <ListItemText primary={t('dialogs.back')} />
          </MenuItem>
          
          <MenuItem disabled sx={{ py: 0 }}>
            <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
          </MenuItem>
          
          {!reviewRequesterOption.alreadyAdded ? (
            <MenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleUserSelect(
                  reviewRequesterOption.userId,
                  requesterName
                );
              }}
            >
              <ListItemText 
                primary={requesterName}
                secondary={t('dialogs.applicant')}
              />
            </MenuItem>
          ) : (
            <MenuItem disabled>
              <ListItemText primary={t('dialogs.alreadyAdded')} />
            </MenuItem>
          )}
        </>
      );
    }

    return (
      <>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            setFolderMenuView('manage');
          }}
        >
          <ListItemText primary={t('dialogs.back')} />
        </MenuItem>
        
        <MenuItem disabled sx={{ py: 0 }}>
          <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
        </MenuItem>
        
        {availableUsers.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary={t('dialogs.noUsersToAdd')} />
          </MenuItem>
        ) : (
          availableUsers.map((targetUser) => (
            <MenuItem
              key={targetUser.id}
              onClick={(e) => {
                e.stopPropagation();
                handleUserSelect(targetUser.id, targetUser.username);
              }}
            >
              <ListItemText 
                primary={targetUser.username}
                secondary={targetUser.email}
              />
            </MenuItem>
          ))
        )}
      </>
    );
  };

  return (
    <Menu
      anchorEl={folderMenuAnchor}
      open={Boolean(folderMenuAnchor)}
      onClose={onClose}
      PaperProps={{
        style: {
          maxHeight: '75vh',
          minWidth: 200,
        },
      }}
    >
      {folderMenuView === 'manage' ? renderManageView() : renderSelectUserView()}
    </Menu>
  );
};

export default UserSelectionMenu;
