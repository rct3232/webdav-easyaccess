import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { setupDragGhost } from '../utils/dragGhostImage';

export const useDragAndDrop = (
  onFileDrop,
  selectionMode,
  theme,
  onDropPermissionDenied,
  onDragStart,
  onDragEnd,
  internalDraggedNodeId
) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  // Latest-value refs so the handlers below can stay referentially stable
  // ([]) while still reading the current inputs at call time.
  const selectionModeRef = useRef(selectionMode);
  const themeRef = useRef(theme);
  const onFileDropRef = useRef(onFileDrop);
  const onDropPermissionDeniedRef = useRef(onDropPermissionDenied);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  const internalDraggedNodeIdRef = useRef(internalDraggedNodeId);
  const draggedFileRef = useRef(draggedFile);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
    themeRef.current = theme;
    onFileDropRef.current = onFileDrop;
    onDropPermissionDeniedRef.current = onDropPermissionDenied;
    onDragStartRef.current = onDragStart;
    onDragEndRef.current = onDragEnd;
    internalDraggedNodeIdRef.current = internalDraggedNodeId;
  });

  // Dual-write the dragged file so handlers read a synchronous, always-current
  // value while the state still drives rendering for external consumers.
  const setDraggedFileAll = useCallback((file) => {
    draggedFileRef.current = file;
    setDraggedFile(file);
  }, []);

  const handleDragStart = useCallback(
    (e, file) => {
      if (selectionModeRef.current) return;
      setDraggedFileAll(file);
      onDragStartRef.current?.(file.nodeId);
      // In real browsers `dataTransfer` always exists; in tests it may be missing.
      if (e?.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(file.nodeId));
      }

      // Set custom drag ghost image if theme is available
      if (themeRef.current && e?.dataTransfer) {
        setupDragGhost(e, file, themeRef.current, 1);
      }
    },
    [setDraggedFileAll]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedFileAll(null);
    setDropTarget(null);
    onDragEndRef.current?.();
  }, [setDraggedFileAll]);

  const handleDragOver = useCallback((e, file) => {
    if (selectionModeRef.current) return;
    const dragged = draggedFileRef.current;
    const fromList = dragged?.nodeId != null && dragged.nodeId !== file.nodeId;
    const fromTree = !dragged && e?.dataTransfer?.types?.includes('text/plain');
    const canDropOnFolder = file.type === 'directory' && (fromList || fromTree);
    if (canDropOnFolder) {
      e.preventDefault();
      if (e?.dataTransfer)
        e.dataTransfer.dropEffect = file.hasWritePermission === false ? 'none' : 'move';
      if (file.hasWritePermission === false) return;
      // No-op move: target is the parent of the dragged nodeId (item already lives there)
      const listNoOp = fromList && dragged.parentNodeId === file.nodeId;
      if (listNoOp) return;
      // Tree-origin no-op: target equals tree nodeId (drop on self)
      const treeNodeId = e?.dataTransfer?.getData?.('text/plain');
      const effectiveTreeNodeId = treeNodeId || internalDraggedNodeIdRef.current;
      const treeNoOp =
        fromTree &&
        effectiveTreeNodeId != null &&
        String(effectiveTreeNodeId) === String(file.nodeId);
      if (treeNoOp) return;
      setDropTarget(file.nodeId);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e, targetFolder) => {
      if (selectionModeRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const dragged = draggedFileRef.current;

      if (targetFolder.hasWritePermission === false) {
        onDropPermissionDeniedRef.current?.(targetFolder.nodeId);
        setDraggedFileAll(null);
        setDropTarget(null);
        return;
      }

      // List no-op: target is parent of dragged nodeId (same folder)
      if (
        dragged &&
        targetFolder.type === 'directory' &&
        dragged.parentNodeId === targetFolder.nodeId
      ) {
        setDraggedFileAll(null);
        setDropTarget(null);
        return;
      }
      // Tree no-op: tree nodeId equals target (drop on self)
      const treeNodeId = !dragged ? e?.dataTransfer?.getData?.('text/plain') : null;
      const effectiveTreeNodeId =
        treeNodeId || (!dragged ? internalDraggedNodeIdRef.current : null);
      if (
        effectiveTreeNodeId != null &&
        targetFolder.type === 'directory' &&
        String(effectiveTreeNodeId) === String(targetFolder.nodeId)
      ) {
        setDraggedFileAll(null);
        setDropTarget(null);
        return;
      }

      const fromList =
        dragged && targetFolder.type === 'directory' && dragged.nodeId !== targetFolder.nodeId;
      const fromTree =
        effectiveTreeNodeId != null &&
        targetFolder.type === 'directory' &&
        String(effectiveTreeNodeId) !== String(targetFolder.nodeId);

      if (fromList) {
        onFileDropRef.current?.(dragged, targetFolder);
      } else if (fromTree) {
        onFileDropRef.current?.({ nodeId: Number(effectiveTreeNodeId) }, targetFolder);
      }

      setDraggedFileAll(null);
      setDropTarget(null);
    },
    [setDraggedFileAll]
  );

  return useMemo(
    () => ({
      draggedFile,
      dropTarget,
      handleDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
      handleDrop,
    }),
    [
      draggedFile,
      dropTarget,
      handleDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
      handleDrop,
    ]
  );
};
