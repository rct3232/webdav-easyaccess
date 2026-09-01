import { get, post } from './apiClient';

export const getMigrationInfo = async () => {
  const response = await get('/admin/migration/info');
  return response.data;
};

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

export const getMigrationStatus = async () => {
  const response = await get('/migration/status');
  return response.data;
};

export const getTargetScan = async ({ targetBackend, pg, sqlitePath }) => {
  const response = await get('/admin/migration/target-scan', {
    params: { targetBackend, ...pg, sqlitePath },
  });
  return response.data;
};

export const startMetadataMigration = async ({ targetBackend, pg, sqlitePath, wipeTarget }) => {
  const response = await post('/admin/migration/metadata', {
    targetBackend,
    pg,
    sqlitePath,
    wipeTarget,
  });
  return response.data;
};

export const getMigrationPresence = async () => {
  const response = await get('/admin/migration/presence');
  return response.data;
};
