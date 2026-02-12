import { get, post } from './apiClient';

export const getMe = async () => {
  const response = await get('/auth/me');
  return response.data;
};

export const login = async (username, password) => {
  const response = await post('/auth/login', { username, password });
  return response.data;
};

export const register = async (username, email, password) => {
  const response = await post('/auth/register', { username, email, password });
  return response.data;
};
