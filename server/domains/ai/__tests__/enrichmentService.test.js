/**
 * enrichmentService unit tests — ACL/state gate, no-row absence, safe media
 * projection and model-name-only provenance.
 * @see docs/spec/server/services/enrichmentService.md
 */
const { createEnrichmentService } = require('../enrichmentService');

function createService(overrides = {}) {
  const aiEnrichmentsStore = { get: jest.fn(), ...overrides.aiEnrichmentsStore };
  const llmModelsStore = { getModel: jest.fn(), ...overrides.llmModelsStore };
  const fileNodesStore = { getNode: jest.fn(), ...overrides.fileNodesStore };
  const aclService = { checkFilePermission: jest.fn(), ...overrides.aclService };
  const service = createEnrichmentService({
    aiEnrichmentsStore,
    llmModelsStore,
    fileNodesStore,
    aclService,
  });
  return { service, aiEnrichmentsStore, llmModelsStore, fileNodesStore, aclService };
}

const NODE = { id: 5, type: 'file', name: 'doc.txt' };

const ROW = {
  nodeId: 5,
  featuresModelId: 11,
  schemaVersion: 1,
  tags: ['beach', 'sunset'],
  summary: 'A sunset over the beach.',
  caption: 'Waves at golden hour.',
  captionModelId: 12,
  transcript: 'hello world',
  asrModelId: 13,
  probe: {
    durationSec: 12.5,
    width: 1920,
    height: 1080,
    streams: [{ codecName: 'h264' }, { codecName: 'aac' }, { codecName: 'h264' }],
    tags: { artist: 'hidden artist' },
  },
  truncated: true,
  mediaKind: 'music',
  updatedAt: '2026-10-30T10:00:00.000Z',
};

describe('enrichmentService.getNodeEnrichment', () => {
  it('404-masquerades unknown and trashed nodes without touching the enrichment store', async () => {
    const { service, fileNodesStore, aclService, aiEnrichmentsStore } = createService();
    fileNodesStore.getNode.mockResolvedValue(null);

    await expect(service.getNodeEnrichment(7, 999)).rejects.toMatchObject({
      message: 'notFound',
      status: 404,
    });
    expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    expect(aiEnrichmentsStore.get).not.toHaveBeenCalled();
  });

  it('404-masquerades an unreadable live node', async () => {
    const { service, fileNodesStore, aclService, aiEnrichmentsStore } = createService();
    fileNodesStore.getNode.mockResolvedValue(NODE);
    aclService.checkFilePermission.mockResolvedValue(false);

    await expect(service.getNodeEnrichment(7, 5)).rejects.toMatchObject({
      message: 'notFound',
      status: 404,
    });
    expect(aiEnrichmentsStore.get).not.toHaveBeenCalled();
  });

  it('returns enrichment: null for a readable node without a row', async () => {
    const { service, fileNodesStore, aclService, aiEnrichmentsStore } = createService();
    fileNodesStore.getNode.mockResolvedValue(NODE);
    aclService.checkFilePermission.mockResolvedValue(true);
    aiEnrichmentsStore.get.mockResolvedValue(null);

    await expect(service.getNodeEnrichment(7, 5)).resolves.toEqual({
      nodeId: 5,
      enrichment: null,
    });
  });

  it('projects the exact whitelist and model-name-only provenance (no raw probe/ids)', async () => {
    const { service, fileNodesStore, aclService, aiEnrichmentsStore, llmModelsStore } =
      createService();
    fileNodesStore.getNode.mockResolvedValue(NODE);
    aclService.checkFilePermission.mockResolvedValue(true);
    aiEnrichmentsStore.get.mockResolvedValue(ROW);
    llmModelsStore.getModel.mockImplementation(
      async (id) =>
        ({
          11: { id, modelName: 'qwen-features', baseUrlKey: 'secret-base-url' },
          12: { id, modelName: 'qwen-vision' },
          13: { id, modelName: 'whisper-large' },
        })[id]
    );

    const result = await service.getNodeEnrichment(7, 5);

    expect(result).toEqual({
      nodeId: 5,
      enrichment: {
        tags: ['beach', 'sunset'],
        summary: 'A sunset over the beach.',
        caption: 'Waves at golden hour.',
        transcript: 'hello world',
        media_kind: 'music',
        media: { duration_sec: 12.5, width: 1920, height: 1080, codecs: ['h264', 'aac'] },
        truncated: true,
        schema_version: 1,
        updated_at: '2026-10-30T10:00:00.000Z',
        provenance: {
          features: { model_name: 'qwen-features' },
          caption: { model_name: 'qwen-vision' },
          asr: { model_name: 'whisper-large' },
        },
      },
    });
    expect(llmModelsStore.getModel.mock.calls.map(([id]) => id)).toEqual([11, 12, 13]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('hidden artist');
    expect(serialized).not.toContain('secret-base-url');
    expect(serialized).not.toContain('featuresModelId');
    expect(serialized).not.toContain('captionModelId');
    expect(serialized).not.toContain('asrModelId');
    expect(serialized).not.toContain('probe');
  });

  it('defensively normalizes malformed tags/probe and degrades failed provenance lookups', async () => {
    const { service, fileNodesStore, aclService, aiEnrichmentsStore, llmModelsStore } =
      createService();
    fileNodesStore.getNode.mockResolvedValue(NODE);
    aclService.checkFilePermission.mockResolvedValue(true);
    aiEnrichmentsStore.get.mockResolvedValue({
      ...ROW,
      tags: 'not-an-array',
      probe: { streams: 'bad', durationSec: null, width: null, height: null },
      schemaVersion: 'one',
      updatedAt: null,
    });
    llmModelsStore.getModel.mockRejectedValue(new Error('registry down'));

    const { enrichment } = await service.getNodeEnrichment(7, 5);

    expect(enrichment.tags).toEqual([]);
    expect(enrichment.media).toBeNull();
    expect(enrichment.schema_version).toBeNull();
    expect(enrichment.updated_at).toBeNull();
    expect(enrichment.provenance).toEqual({ features: null, caption: null, asr: null });
  });
});
