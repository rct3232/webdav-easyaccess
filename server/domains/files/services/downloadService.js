'use strict';

const crypto = require('crypto');
const archiver = require('archiver');
const { forbiddenError } = require('../../../utils/errorHandler');

/**
 * Factory: nodeId-based multi-file ZIP download service.
 * Replaces path-based legacy code with async permission checks per file.
 * All blob retrieval goes through blobStorageService.
 */
function createDownloadService({ fileNodeService, blobStorageService, aclService }) {
	const progressStore = new Map();

	async function downloadMultiple(nodeIds, userId) {
		if (!nodeIds || nodeIds.length === 0) {
			throw forbiddenError('No files selected for download');
		}

		// Permission pre-check: async per file via Promise.allSettled
		const permissionChecks = nodeIds.map((id) =>
			aclService.checkFolderPermission(userId, id, 'read')
		);
		const results = await Promise.allSettled(permissionChecks);

		const allowedNodeIds = [];
		const errors = [];

		results.forEach((r, idx) => {
			if (r.status === 'fulfilled' && r.value) {
				allowedNodeIds.push(nodeIds[idx]);
			} else {
				errors.push({ nodeId: nodeIds[idx], reason: 'permission_denied' });
			}
		});

		if (allowedNodeIds.length === 0) {
			throw forbiddenError('No files selected for download');
		}

		const downloadId = crypto.randomUUID();
		const totalFiles = allowedNodeIds.length;

		progressStore.set(downloadId, { completed: 0, total: totalFiles, percentage: 0 });

		const archive = archiver('zip', { zlib: { level: 6 } });

		let successCount = 0;
		for (let i = 0; i < allowedNodeIds.length; i++) {
			const nodeId = allowedNodeIds[i];

			try {
				let displayName = `file_${nodeId}`;
				try {
					const node = await fileNodeService.getNode(nodeId);
					if (node && node.name) {
						displayName = node.name;
					}
				} catch (_) {
					// getNode unavailable — use fallback name
				}

				const buffer = await blobStorageService.downloadBlob(nodeId);
				if (buffer == null) {
					errors.push({ nodeId, reason: 'blob_error', detail: 'No content returned' });
					continue;
				}

				archive.append(buffer, { name: displayName });
				successCount++;
			} catch (err) {
				errors.push({ nodeId, reason: 'blob_error', detail: err.message || String(err) });
			}

			const completed = i + 1;
			progressStore.set(downloadId, {
				completed,
				total: totalFiles,
				percentage: Math.round((completed / totalFiles) * 100),
			});
		}

		progressStore.set(downloadId, {
			completed: successCount,
			total: totalFiles,
			percentage: totalFiles > 0 ? Math.round((successCount / totalFiles) * 100) : 0,
		});

		return { zipStream: archive, totalFiles: successCount, downloadId, errors };
	}

	function getDownloadProgress(downloadId) {
		const entry = progressStore.get(downloadId);
		if (!entry) return null;
		return { ...entry };
	}

	return { downloadMultiple, getDownloadProgress };
}

module.exports = { createDownloadService };
