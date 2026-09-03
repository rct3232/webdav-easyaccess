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
    const response = await post('/admin/config/test', { target, ...values });
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

export const getPublicHealth = async () => {
  const response = await get('/health');
  return response.data;
};
