/**
 * Pure invalid-destination validator for FolderPickerDialog.
 * Returns whether the selectedNodeId is an invalid copy/move destination.
 *
 * Without server ancestor calls the only reliably checkable invalid destination is
 * the source nodeId itself (moving/copying into the source folder).
 */
export function isInvalidFolderPickerDestination({
  action,
  selectedNodeId,
  sourceNodeId,
  sourceNodeIds,
}) {
  if (action !== 'copy' && action !== 'move') return false;

  if (selectedNodeId == null) return false;

  const sourceIds = sourceNodeId != null ? [sourceNodeId] : (sourceNodeIds || []);

  return sourceIds.some((id) => id != null && id === selectedNodeId);
}
