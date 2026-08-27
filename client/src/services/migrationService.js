import { get, post } from './apiClient';

export const startBlobMigration = async (payload) => {
  const response = await post('/admin/migration/blobs', payload);
  return response.data;
};

export const getBlobMigrationStatus = async (jobId) => {
  const response = await get(`/admin/migration/jobs/${jobId}`);
  return response.data;
};

export const cancelBlobMigration = async (jobId) => {
  const response = await post(`/admin/migration/jobs/${jobId}/cancel`);
  return response.data;
};
