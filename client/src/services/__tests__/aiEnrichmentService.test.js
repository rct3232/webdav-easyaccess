/**
 * aiEnrichmentService tests — URL, verbatim payload, rejection passthrough.
 * @see docs/spec/client/services/aiEnrichmentService.md
 */
import { get } from '../apiClient';
import { getNodeEnrichment } from '../aiEnrichmentService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
}));

describe('aiEnrichmentService.getNodeEnrichment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GETs the node-scoped endpoint and returns the payload verbatim', async () => {
    const payload = { node_id: 5, enrichment: { tags: ['beach'] } };
    get.mockResolvedValueOnce({ data: payload });

    await expect(getNodeEnrichment(5)).resolves.toEqual(payload);
    expect(get).toHaveBeenCalledWith('/ai/enrichments/5');
  });

  it('returns the null-enrichment shape verbatim', async () => {
    const payload = { node_id: 9, enrichment: null };
    get.mockResolvedValueOnce({ data: payload });

    await expect(getNodeEnrichment(9)).resolves.toEqual(payload);
  });

  it('propagates transport errors unchanged (the hook owns absorption)', async () => {
    const error = new Error('boom');
    get.mockRejectedValueOnce(error);

    await expect(getNodeEnrichment(5)).rejects.toBe(error);
  });
});
