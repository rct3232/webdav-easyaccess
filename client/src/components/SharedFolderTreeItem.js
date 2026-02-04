import React from 'react';
import BaseFolderTreeItem from './BaseFolderTreeItem';

/**
 * 공유 폴더 트리 아이템 컴포넌트
 * BaseFolderTreeItem을 래핑하여 공유 폴더 전용 설정 적용
 * 
 * @deprecated BaseFolderTreeItem을 직접 사용하세요. 이 컴포넌트는 하위 호환성을 위해 유지됩니다.
 */
const SharedFolderTreeItem = ({ 
  node, 
  level = 0, 
  currentPath, 
  onPathClick, 
  expandedPaths, 
  onToggleExpand,
  user,
  treeUpdateTrigger,
  sharedFoldersMap,
  onExplorerDrop,
  isMobile = false,
}) => {
  return (
    <BaseFolderTreeItem
      node={node}
      level={level}
      currentPath={currentPath}
      onPathClick={onPathClick}
      expandedPaths={expandedPaths}
      onToggleExpand={onToggleExpand}
      user={user}
      treeUpdateTrigger={treeUpdateTrigger}
      sharedFoldersMap={sharedFoldersMap}
      onExplorerDrop={onExplorerDrop}
      isMobile={isMobile}
      useHiddenFilesFilter={false}
      renderChild={(child, childLevel) => (
        <SharedFolderTreeItem
          key={child.path}
          node={child}
          level={childLevel}
          currentPath={currentPath}
          onPathClick={onPathClick}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          user={user}
          treeUpdateTrigger={treeUpdateTrigger}
          sharedFoldersMap={sharedFoldersMap}
          onExplorerDrop={onExplorerDrop}
          isMobile={isMobile}
        />
      )}
    />
  );
};

export default SharedFolderTreeItem;
