/**
 * useFileAiInfo — host fetch of the opened node's persisted AI enrichment
 * (docs/spec/client/hooks/useFileAiInfo.md). Page-local: the FileManager shell
 * feeds the properties dialog; the dialog itself performs no AI IO.
 *
 * Fetch-once per opened node, stale-guarded by a run token, and failures are
 * absorbed to `null` (absent-not-disabled — no error surface, no retry loop).
 */
import { useEffect, useRef, useState } from 'react';
import { getNodeEnrichment } from '../../../services/aiEnrichmentService';

/**
 * @param {{ nodeId?: number|null, enabled?: boolean }} params
 * @returns {{ enrichment: object|null }}
 */
export const useFileAiInfo = ({ nodeId = null, enabled = true } = {}) => {
  // The loaded node id is kept with the payload so a render that observes a
  // NEW node never displays the previous node's enrichment (the effect's
  // clearing state runs after that render).
  const [state, setState] = useState({ nodeId: null, enrichment: null });
  const runTokenRef = useRef(0);

  useEffect(() => {
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;

    if (!enabled || nodeId == null) {
      setState({ nodeId: null, enrichment: null });
      return undefined;
    }

    setState({ nodeId: null, enrichment: null });
    getNodeEnrichment(nodeId)
      .then((payload) => {
        if (runTokenRef.current !== token) return; // stale run
        setState({ nodeId, enrichment: payload?.enrichment ?? null });
      })
      .catch((error) => {
        if (runTokenRef.current !== token) return;
        // eslint-disable-next-line no-console
        console.error('[useFileAiInfo] Failed to load AI enrichment:', error);
        setState({ nodeId, enrichment: null });
      });

    return () => {
      // A newer effect (or unmount) invalidates this run.
      runTokenRef.current += 1;
    };
  }, [nodeId, enabled]);

  const enrichment = enabled && nodeId != null && state.nodeId === nodeId ? state.enrichment : null;
  return { enrichment };
};

export default useFileAiInfo;
