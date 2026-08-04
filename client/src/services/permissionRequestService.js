import { get, post } from './apiClient';

const API_BASE = '/permission-requests';

export const createPermissionRequest = async ({ nodeId, permission, message } = {}) => {
  const body = { nodeId, permission, message };
  const response = await post(API_BASE, body);
  return response.data;
};

export const listInboxPermissionRequests = async ({ status } = {}) => {
  const response = await get(`${API_BASE}/inbox`, {
    params: status ? { status } : undefined,
  });
  return response.data;
};

export const listOutboxPermissionRequests = async ({ status } = {}) => {
  const response = await get(`${API_BASE}/outbox`, {
    params: status ? { status } : undefined,
  });
  return response.data;
};

export const approvePermissionRequest = async (id) => {
  const response = await post(`${API_BASE}/${id}/approve`);
  return response.data;
};

export const rejectPermissionRequest = async (id) => {
  const response = await post(`${API_BASE}/${id}/reject`);
  return response.data;
};

export const cancelPermissionRequest = async (id) => {
  const response = await post(`${API_BASE}/${id}/cancel`);
  return response.data;
};

export const checkOwnerExists = async (nodeId) => {
  const response = await get(`${API_BASE}/check-owner`, { params: { nodeId } });
  return response.data;
};
