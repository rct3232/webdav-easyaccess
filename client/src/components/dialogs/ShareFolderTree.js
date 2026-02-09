import React from 'react';
import {
  Box,
  IconButton,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  GroupAdd as GroupAddIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { FileTreeSkeleton } from '../file-manager/FileSkeletons';

const ShareFolderTree = ({
  rootPath,
  folderTree,
  expandedPaths,
  loadingPaths,
  toggleExpand,
  folderPermissions,
  isAdminMode,
  userId,
  user,
  userInfoMap,
  users,
  getUserName,
  hasPermissionChanged,
  setFolderMenuAnchor,
  setFolderMenuPath,
  loadingPermissions,
  isMobile,
  level = 0,
}) => {
  const node = folderTree.get(rootPath);
  if (!node) return null;
  
  const isExpanded = expandedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.path);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <Box key={node.path} sx={{ width: '100%', overflow: 'visible' }}>
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          py: 0.5, 
          pl: level * 1, 
          width: '100%',
          overflow: 'visible',
        }}
      >
        {/* 왼쪽: 폴더 트리 */}
        <Box sx={{ display: 'flex', alignItems: 'center', flex: '1 0 0', minWidth: 0 }}>
          <IconButton
            size="small"
            onClick={() => toggleExpand(node.path)}
            disabled={isLoading}
            sx={{ mr: 0.5, flexShrink: 0 }}
          >
            {isLoading ? (
              <CircularProgress size={16} />
            ) : isExpanded ? (
              <ExpandMoreIcon />
            ) : (
              <ChevronRightIcon />
            )}
          </IconButton>
          {isExpanded ? <FolderOpenIcon sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} /> : <FolderIcon sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} />}
          <Box
            sx={{
              flex: '1 0 0',
              minWidth: 0,
              mr: 1,
              overflow: 'hidden',
              position: 'relative',
            }}
            onMouseEnter={isMobile ? undefined : (e) => {
              const container = e.currentTarget;
              const text = container.querySelector('span');
              if (text) {
                const isOverflowing = text.scrollWidth > container.clientWidth;
                if (isOverflowing) {
                  const scrollDistance = text.scrollWidth - container.clientWidth;
                  container.style.setProperty('--scroll-distance', `${scrollDistance}px`);
                  
                  const scrollSpeed = 50;
                  const scrollTime = scrollDistance / scrollSpeed;
                  const animationDuration = scrollTime + 0.5;
                  const scrollPercentage = (scrollTime / animationDuration) * 100;
                  
                  const animationName = `scrollText-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
                  const keyframes = `
                    @keyframes ${animationName} {
                      0% { transform: translateX(0); }
                      ${scrollPercentage}% { transform: translateX(calc(-1 * ${scrollDistance}px)); }
                      100% { transform: translateX(calc(-1 * ${scrollDistance}px)); }
                    }
                  `;
                  
                  const styleId = `style-${animationName}`;
                  let styleElement = document.getElementById(styleId);
                  if (!styleElement) {
                    styleElement = document.createElement('style');
                    styleElement.id = styleId;
                    document.head.appendChild(styleElement);
                  }
                  styleElement.textContent = keyframes;
                  
                  text.style.animation = 'none';
                  text.style.transform = 'translateX(0)';
                  setTimeout(() => {
                    text.style.animation = `${animationName} ${animationDuration}s linear infinite`;
                  }, 10);
                }
              }
            }}
            onMouseLeave={isMobile ? undefined : (e) => {
              const text = e.currentTarget.querySelector('span');
              if (text) {
                text.style.animation = 'none';
                text.style.transform = 'translateX(0)';
              }
            }}
          >
            <Typography
              variant="body2"
              component="span"
              sx={{
                display: 'inline-block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {node.name || node.path}
            </Typography>
          </Box>
        </Box>
        
        {/* 오른쪽: 드롭다운 메뉴 버튼 */}
        {(() => {
          const currentFolderUserPerms = folderPermissions.get(node.path) || new Map();
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
          
          const userCount = currentDisplayUsers.filter(([targetUserId]) => {
            const userName = getUserName(targetUserId);
            return userName && userName.trim() !== '';
          }).length;
          
          const isChanged = hasPermissionChanged(node.path);
          
          return (
            <Box
              component="button"
              onClick={(e) => {
                e.stopPropagation();
                setFolderMenuAnchor(e.currentTarget);
                setFolderMenuPath(node.path);
              }}
              sx={{ 
                display: 'flex',
                alignItems: 'center',
                border: 'none',
                borderRadius: '20px',
                backgroundColor: 'grey.300',
                color: 'text.primary',
                cursor: 'pointer',
                flexShrink: 0,
                height: 28,
                pl: 1,
                pr: 0,
                gap: 0.5,
                overflow: 'visible',
                '&:hover': {
                  backgroundColor: 'grey.400',
                }
              }}
            >
              {loadingPermissions ? (
                <CircularProgress size={12} sx={{ mr: 0.5 }} />
              ) : (
                <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                  {userCount}
                </Typography>
              )}
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: 'success.main',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative',
                  overflow: 'visible',
                }}
              >
                <GroupAddIcon sx={{ fontSize: 16 }} />
                {isChanged && (
                  <EditIcon
                    sx={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      fontSize: 8,
                      backgroundColor: 'primary.main',
                      color: 'white',
                      borderRadius: '50%',
                      padding: '1px',
                      border: '1px solid white',
                      width: 12,
                      height: 12,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  />
                )}
              </Box>
            </Box>
          );
        })()}
      </Box>
      
      {isExpanded && (hasChildren || isLoading) && (
        <Box sx={{ pl: 1 }}>
          {isLoading && !hasChildren ? (
            <FileTreeSkeleton level={level + 1} count={3} />
          ) : (
            node.children.map(child => (
              <ShareFolderTree
                key={child.path}
                rootPath={child.path}
                folderTree={folderTree}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                toggleExpand={toggleExpand}
                folderPermissions={folderPermissions}
                isAdminMode={isAdminMode}
                userId={userId}
                user={user}
                userInfoMap={userInfoMap}
                users={users}
                getUserName={getUserName}
                hasPermissionChanged={hasPermissionChanged}
                setFolderMenuAnchor={setFolderMenuAnchor}
                setFolderMenuPath={setFolderMenuPath}
                loadingPermissions={loadingPermissions}
                isMobile={isMobile}
                level={level + 1}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  );
};

export default ShareFolderTree;
