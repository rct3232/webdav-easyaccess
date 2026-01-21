import axios from 'axios';

const API_BASE = '/api/permission-requests';

export const createPermissionRequest = async ({ folderPath, permission, message } = {}) => {
  const response = await axios.post(API_BASE, { folderPath, permission, message });
  return response.data;
};

export const listInboxPermissionRequests = async ({ status } = {}) => {
  const response = await axios.get(`${API_BASE}/inbox`, {
    params: status ? { status } : undefined,
  });
  return response.data;
};

export const listOutboxPermissionRequests = async ({ status } = {}) => {
  const response = await axios.get(`${API_BASE}/outbox`, {
    params: status ? { status } : undefined,
  });
  return response.data;
};

export const approvePermissionRequest = async (id) => {
  const response = await axios.post(`${API_BASE}/${id}/approve`);
  return response.data;
};

export const rejectPermissionRequest = async (id) => {
  const response = await axios.post(`${API_BASE}/${id}/reject`);
  return response.data;
};

export const cancelPermissionRequest = async (id) => {
  const response = await axios.post(`${API_BASE}/${id}/cancel`);
  return response.data;
};

