/**
 * AI Info HTTP seam (docs/spec/client/services/aiEnrichmentService.md,
 * docs/spec/server/routes/aiEnrichments.md). JWT-only endpoint — no share
 * token is ever attached. Failures reject unchanged; `useFileAiInfo` owns the
 * absorb-to-null contract.
 */
import { get } from './apiClient';

/**
 * @param {number} nodeId
 * @returns {Promise<{ node_id: number, enrichment: object|null }>}
 */
export const getNodeEnrichment = async (nodeId) => {
  const response = await get(`/ai/enrichments/${nodeId}`);
  return response?.data ?? null;
};

export default { getNodeEnrichment };
