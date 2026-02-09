import React from 'react';
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
  if (!folderMenuPath) return null;

  const currentFolderUserPerms = folderPermissions.get(folderMenuPath) || new Map();
  const currentFolderUsers = Array.from(currentFolderUserPerms.entries());
  
  const currentDisplayUsers = isAdminMode 
    ? currentFolderUsers.filter(([uid]) => uid === userId)
    : currentFolderUsers.filter(([targetUserId]) => {
        if (user && targetUserId === user.id) return false;
        const userInfo = userInfoMap.get(targetUserId);
        if (userInfo && userInfo.is_admin) return false;
        const fullUser = users.find(u => u.id === targetUserId);
        if (fullUser && fullUser.is_admin) return false;
        return true;
      });
  
  const currentUserBaseFolder = isAdminMode ? `/${username}` : null;
  const currentIsUserBaseFolder = isAdminMode && folderMenuPath === currentUserBaseFolder;

  const renderManageView = () => (
    <>
      {currentDisplayUsers
        .filter(([targetUserId]) => {
          const userName = getUserName(targetUserId);
          return userName && userName.trim() !== '';
        })
        .map(([targetUserId, permission]) => {
          const userName = getUserName(targetUserId);
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
      
      {currentDisplayUsers.filter(([targetUserId]) => {
        const userName = getUserName(targetUserId);
        return userName && userName.trim() !== '';
      }).length > 0 && (
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
          primary="사용자 추가" 
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
    if (isReviewMode && permissionRequest) {
      const requesterId = permissionRequest.requester_id;
      const folderUserPerms = folderPermissions.get(folderMenuPath);
      const isAlreadyAdded = folderUserPerms && folderUserPerms.has(requesterId);
      
      return (
        <>
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              setFolderMenuView('manage');
            }}
          >
            <ListItemText primary="← 뒤로" />
          </MenuItem>
          
          <MenuItem disabled sx={{ py: 0 }}>
            <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
          </MenuItem>
          
          {!isAlreadyAdded ? (
            <MenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleUserSelect(
                  requesterId, 
                  permissionRequest.requester_username || `사용자 ${requesterId}`
                );
              }}
            >
              <ListItemText 
                primary={permissionRequest.requester_username || `사용자 ${requesterId}`}
                secondary="신청자"
              />
            </MenuItem>
          ) : (
            <MenuItem disabled>
              <ListItemText primary="이미 추가된 사용자입니다." />
            </MenuItem>
          )}
        </>
      );
    }
    
    const availableUsers = users.filter(u => {
      const folderUserPerms = folderPermissions.get(folderMenuPath);
      if (folderUserPerms && folderUserPerms.has(u.id)) return false;
      if (user && u.id === user.id) return false;
      if (u.is_admin) return false;
      return true;
    });
    
    return (
      <>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            setFolderMenuView('manage');
          }}
        >
          <ListItemText primary="← 뒤로" />
        </MenuItem>
        
        <MenuItem disabled sx={{ py: 0 }}>
          <Box sx={{ width: '100%', height: 1, bgcolor: 'divider' }} />
        </MenuItem>
        
        {availableUsers.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary="추가할 수 있는 사용자가 없습니다." />
          </MenuItem>
        ) : (
          availableUsers.map(u => (
            <MenuItem
              key={u.id}
              onClick={(e) => {
                e.stopPropagation();
                handleUserSelect(u.id, u.username);
              }}
            >
              <ListItemText 
                primary={u.username}
                secondary={u.email}
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
