# folderUtils Spec — REMOVED (Wave 4)

## Status: DELETED

The `client/src/utils/folderUtils.js` file was deleted during Wave 4 as part of the path-to-nodeId migration. Its sole export, `collectSubfolderPaths`, is no longer available.

### What Was Here

| Function              | Signature                           | Purpose                                                                    |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| collectSubfolderPaths | `(folderPath) => Promise<string[]>` | Recursively collected folder and subfolder paths via fileService.listFiles |

### Why Removed

Server-side permission inheritance via the closure table eliminates the need for client-side recursive path collection. Permission grants on a directory node automatically propagate to descendants through `node_ancestors`, so the client no longer needs to enumerate subfolder paths for permission operations.

### Replacement

No direct replacement — callers that previously used this function now operate on nodeId-based permissions where inheritance is resolved server-side by the store layer (`permissionStore.checkPermission` traverses ancestors via closure table).

### Affected Code

- `shareTargetPermissionSaveUseCase.js` — migrated to `targetNodeId`; no longer collects subfolder paths (Wave 4 Task W4.8)
