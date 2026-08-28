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

export const updateConfig = async (values) => {
  const response = await put('/admin/config', { values });
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
