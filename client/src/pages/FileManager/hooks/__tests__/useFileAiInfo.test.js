/**
 * useFileAiInfo tests — fetch-once, disabled no-IO, failure absorption and
 * the stale-run guard.
 * @see docs/spec/client/hooks/useFileAiInfo.md
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useFileAiInfo } from '../useFileAiInfo';
import { getNodeEnrichment } from '../../../../services/aiEnrichmentService';

jest.mock('../../../../services/aiEnrichmentService', () => ({
  getNodeEnrichment: jest.fn(),
}));

const ENRICHMENT = { tags: ['beach'], summary: 'Sunset.' };

describe('useFileAiInfo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches once for an enabled node and exposes payload.enrichment', async () => {
    getNodeEnrichment.mockResolvedValue({ node_id: 5, enrichment: ENRICHMENT });
    const { result } = renderHook(() => useFileAiInfo({ nodeId: 5 }));

    await waitFor(() => expect(result.current.enrichment).toEqual(ENRICHMENT));
    expect(getNodeEnrichment).toHaveBeenCalledTimes(1);
    expect(getNodeEnrichment).toHaveBeenCalledWith(5);
  });

  it('returns null when the payload has no enrichment', async () => {
    getNodeEnrichment.mockResolvedValue({ node_id: 5, enrichment: null });
    const { result } = renderHook(() => useFileAiInfo({ nodeId: 5 }));

    await waitFor(() => expect(getNodeEnrichment).toHaveBeenCalledTimes(1));
    expect(result.current.enrichment).toBeNull();
  });

  it('absorbs failures into null without throwing', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    getNodeEnrichment.mockRejectedValue(new Error('boom'));
    try {
      const { result } = renderHook(() => useFileAiInfo({ nodeId: 5 }));
      await waitFor(() => expect(consoleSpy).toHaveBeenCalled());
      expect(result.current.enrichment).toBeNull();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('performs zero IO when disabled or without a nodeId', async () => {
    const { result, rerender } = renderHook(
      ({ nodeId, enabled }) => useFileAiInfo({ nodeId, enabled }),
      { initialProps: { nodeId: 5, enabled: false } }
    );
    expect(result.current.enrichment).toBeNull();
    expect(getNodeEnrichment).not.toHaveBeenCalled();

    rerender({ nodeId: null, enabled: true });
    expect(getNodeEnrichment).not.toHaveBeenCalled();
    expect(result.current.enrichment).toBeNull();
  });

  it('same nodeId re-render does not issue a second fetch', async () => {
    getNodeEnrichment.mockResolvedValue({ node_id: 5, enrichment: ENRICHMENT });
    const { result, rerender } = renderHook(() => useFileAiInfo({ nodeId: 5 }));

    await waitFor(() => expect(result.current.enrichment).toEqual(ENRICHMENT));
    rerender();
    expect(getNodeEnrichment).toHaveBeenCalledTimes(1);
  });

  it('drops a stale first response after nodeId changes', async () => {
    let resolveFirst;
    let resolveSecond;
    getNodeEnrichment.mockImplementation(
      (nodeId) =>
        new Promise((resolve) => {
          if (nodeId === 5) resolveFirst = resolve;
          else resolveSecond = resolve;
        })
    );

    const { result, rerender } = renderHook(({ nodeId }) => useFileAiInfo({ nodeId }), {
      initialProps: { nodeId: 5 },
    });
    await waitFor(() => expect(getNodeEnrichment).toHaveBeenCalledWith(5));

    rerender({ nodeId: 6 });
    await waitFor(() => expect(getNodeEnrichment).toHaveBeenCalledWith(6));
    // The previous node's enrichment must not survive the node switch.
    expect(result.current.enrichment).toBeNull();

    resolveSecond({ node_id: 6, enrichment: { summary: 'second' } });
    await waitFor(() => expect(result.current.enrichment).toEqual({ summary: 'second' }));

    // The first (superseded) response must not overwrite the current state.
    resolveFirst({ node_id: 5, enrichment: { summary: 'first' } });
    await Promise.resolve();
    expect(result.current.enrichment).toEqual({ summary: 'second' });
  });
});
