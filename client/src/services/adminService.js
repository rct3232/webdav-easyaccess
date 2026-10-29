import { get, post, put, del } from './apiClient';

export const getPendingUsers = async () => {
  const response = await get('/admin/users/pending');
  return response.data;
};

export const getUsers = async () => {
  const response = await get('/admin/users');
  return response.data;
};

export const getSettings = async () => {
  const response = await get('/admin/settings');
  return response.data;
};

export const updateSettings = async (settings) => {
  await put('/admin/settings', settings);
};

export const getConfig = async () => {
  const response = await get('/admin/config');
  return response.data?.config ?? {};
};

export const getConfigStatus = async () => {
  const response = await get('/admin/config');
  return response.data;
};

export const updateConfig = async (values) => {
  const response = await put('/admin/config', { values });
  return response.data;
};

export const getConfigSyncReport = async () => {
  const response = await get('/admin/config/sync-report');
  return response.data;
};

export const syncConfigFromEnv = async () => {
  const response = await post('/admin/config/sync-from-env', {});
  return response.data;
};

export const approveUser = async (userId) => {
  await post(`/admin/users/${userId}/approve`);
};

export const rejectUser = async (userId) => {
  await post(`/admin/users/${userId}/reject`);
};

export const deleteUser = async (userId) => {
  await del(`/admin/users/${userId}`);
};

export const createUser = async ({ username, email, password }) => {
  await post('/admin/users', { username, email, password });
};

export const cleanupOrphaned = async () => {
  const response = await post('/admin/cleanup/orphaned', {});
  return response.data;
};

export const ensureHomeOwnerAdmin = async () => {
  const response = await post('/admin/permissions/ensure-home-owner-admin', {});
  return response.data;
};

export const testConfig = async (target, values) => {
  try {
    const response = await post('/admin/config/test', { target, ...values }, { maxRetries: 0 });
    return response.data;
  } catch (err) {
    const data = err?.response?.data;
    const message = data?.message || err.message || 'Config connection test failed';
    const normalized = new Error(message);
    normalized.errorCode = data?.errorCode || 'errors.unknown';
    normalized.reason = data?.reason;
    throw normalized;
  }
};

export const getAdminHealth = async () => {
  const response = await get('/admin/health');
  return response.data;
};

export const getAiAdminSummary = async () => {
  const response = await get('/admin/ai/summary');
  return response.data;
};

export const getAiReembedPreview = async () => {
  const response = await get('/admin/ai/reembed/preview');
  return response.data;
};

export const startAiReembed = async () => {
  const response = await post('/admin/ai/reembed', {});
  return response.data;
};

export const getSettingsJournal = async () => {
  const response = await get('/actions', { params: { domain: 'settings' } });
  return response.data;
};

export const undoSettingsAction = async (actionId) => {
  const response = await post(`/actions/${actionId}/undo`, {});
  return response.data;
};

export const probeLlmRole = async (role) => {
  return testConfig('llm', { role });
};

export const getAdminReports = async () => {
  const response = await get('/admin/reports');
  return response.data;
};

export const getAdminReport = async (id) => {
  const response = await get(`/admin/reports/${id}`);
  return response.data;
};

export const repairAdminReport = async (id, { action, nodeId, repairAction } = {}) => {
  const response = await post(`/admin/reports/${id}/repair`, { action, nodeId, repairAction });
  return response.data;
};

export const getPublicHealth = async () => {
  const response = await get('/health');
  return response.data;
};
