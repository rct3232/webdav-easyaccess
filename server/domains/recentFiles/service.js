const recentFilesStore = require('../../store/recentFilesStore');
const { getComposition } = require('../../service/composition');

async function enrichRecentEntry(userId, entry) {
  const { fileNodeService } = getComposition();
  const node = await fileNodeService.getNode(entry.fileNodeId);
  if (!node) {
    return {
      fileNodeId: entry.fileNodeId,
      name: null,
      type: 'file',
      lastAccessed: entry.lastAccessed,
      displayPath: null,
    };
  }
  const displayPath = await fileNodeService.getNodePath(node.id);
  return {
    fileNodeId: node.id,
    name: node.name,
    type: node.type,
    lastAccessed: entry.lastAccessed,
    displayPath,
  };
}

async function getRecentFiles(userId) {
  const entries = await recentFilesStore.getUserRecentFiles(userId);
  const results = [];
  for (const entry of entries) {
    results.push(await enrichRecentEntry(userId, entry));
  }
  return results;
}

async function addRecentFile(userId, fileNodeId) {
  if (fileNodeId === null || fileNodeId === undefined || !Number.isFinite(Number(fileNodeId))) {
    throw new Error('pathRequired');
  }
  const nodeId = Number(fileNodeId);

  const { fileNodeService } = getComposition();
  const node = await fileNodeService.getNode(nodeId);
  if (!node) {
    const error = new Error('fileNotFound');
    error.status = 404;
    throw error;
  }

  await recentFilesStore.addRecentFile(userId, nodeId);
  const entries = await recentFilesStore.getUserRecentFiles(userId);
  const results = [];
  for (const entry of entries) {
    results.push(await enrichRecentEntry(userId, entry));
  }
  return results;
}

async function removeRecentFile(userId, fileNodeId) {
  if (fileNodeId === null || fileNodeId === undefined || !Number.isFinite(Number(fileNodeId))) {
    throw new Error('pathRequired');
  }
  const nodeId = Number(fileNodeId);
  const entries = await recentFilesStore.removeRecentFile(userId, nodeId);
  const results = [];
  for (const entry of entries) {
    results.push(await enrichRecentEntry(userId, entry));
  }
  return results;
}

async function clearRecentFiles(userId) {
  await recentFilesStore.clearRecentFiles(userId);
}

module.exports = {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
};
