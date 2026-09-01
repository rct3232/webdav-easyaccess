/**
 * Pure breadcrumbs derivation for FolderPickerDialog.
 * No React hooks, gateways, or side effects.
 *
 * The hook maintains a nodeId-first navigation stack ({ nodeId, name } entries whose
 * first entry is the home or shared root), so this helper only normalizes the stack
 * into the breadcrumb model ({ name, nodeId }) rendered by the dialog.
 */
export function buildFolderPickerBreadcrumbs({ homeNodeId, homeLabel, navStack, sharedLabel }) {
  if (!Array.isArray(navStack) || navStack.length === 0) {
    return [{ name: homeLabel, nodeId: homeNodeId ?? null }];
  }

  return navStack.map((entry) => ({
    name: entry.isSharedRoot ? sharedLabel : entry.name || homeLabel,
    nodeId: entry.nodeId ?? null,
  }));
}
