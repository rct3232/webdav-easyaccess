import { get, post } from './apiClient';

export const getSetupStatus = async () => {
  const response = await get('/setup/status');
  return response.data;
};

export const testSetup = async (target, payload) => {
  try {
    const response = await post('/setup/test', { target, ...payload });
    return response.data;
  } catch (err) {
    const data = err?.response?.data;
    const message = data?.message || err.message || 'Setup connection test failed';
    const normalized = new Error(message);
    normalized.errorCode = data?.errorCode || 'errors.unknown';
    throw normalized;
  }
};

export const applySetup = async (payload) => {
  const response = await post('/setup/apply', payload);
  return response.data;
};
