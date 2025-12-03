import axios from 'axios';

const API_BASE = '/api/files';

export const listFiles = async (path = '/') => {
  const response = await axios.get(`${API_BASE}/list`, {
    params: { path },
  });
  return response.data;
};

export const downloadFile = async (filePath) => {
  const response = await axios.get(`${API_BASE}/download`, {
    params: { path: filePath },
    responseType: 'blob',
  });
  
  // Create download link
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filePath.split('/').pop());
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const uploadFile = async (file, path = '/') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);

  const response = await axios.post(`${API_BASE}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const deleteFile = async (filePath) => {
  const response = await axios.delete(`${API_BASE}/delete`, {
    params: { path: filePath },
  });
  return response.data;
};

export const renameFile = async (oldPath, newName) => {
  const response = await axios.put(`${API_BASE}/rename`, {
    oldPath,
    newName,
  });
  return response.data;
};

export const moveFile = async (sourcePath, destinationPath) => {
  const response = await axios.put(`${API_BASE}/move`, {
    sourcePath,
    destinationPath,
  });
  return response.data;
};

export const copyFile = async (sourcePath, destinationPath) => {
  const response = await axios.post(`${API_BASE}/copy`, {
    sourcePath,
    destinationPath,
  });
  return response.data;
};

export const createFolder = async (folderPath) => {
  const response = await axios.post('/api/folders/create', {
    path: folderPath,
  });
  return response.data;
};

