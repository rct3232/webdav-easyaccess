/**
 * useCollectionMemberships — batched files-surface collection-membership read
 * (docs/spec/client/hooks/useCollectionMemberships.md). Chunks the visible
 * rows' nodeIds at 100 ids per request against the `getMemberships` seam
 * (`POST /api/collections/for-nodes`, `routes/collections.md`), resolves names
 * through the already-fetched `useCollections` rows (list order = chip order),
 * and re-reads on notifier events. IO never rejects (repository absorption,
 * `collectionsRepository.md`); a failed chunk degrades to NO chips. Admin and
 * share-link sessions pass the inert gateway — the hook then performs no HTTP
 * and yields an empty map (operator rule, PLAN §14 client sibling).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import explorerGateway from '../../../services/explorerGateway';

// The endpoint accepts 1–200 ids and rejects over-cap bodies; chunking at 100
// mirrors the gateway metadata helper (explorerGateway.loadNodesMetadata).
const MEMBERSHIP_CHUNK_LIMIT = 100;

const chunkIds = (ids) => {
  const chunks = [];
  for (let i = 0; i < ids.length; i += MEMBERSHIP_CHUNK_LIMIT) {
    chunks.push(ids.slice(i, i + MEMBERSHIP_CHUNK_LIMIT));
  }
  return chunks;
};

/**
 * @param {{ nodeIds: Array<number>, collections: Array<object>, gateway?: object }} params
 * @returns {{ membershipsByNodeId: Object<string, Array<{id:number,name:string}>> }}
 */
export const useCollectionMemberships = ({ nodeIds, collections, gateway } = {}) => {
  const io = gateway || explorerGateway;
  const [membershipsByNodeId, setMembershipsByNodeId] = useState({});
  const runTokenRef = useRef(0);

  // De-dupe + drop nullish ids; the joined key stabilizes the effect against
  // re-renders that carry the same SET in a different order.
  const uniqueIds = useMemo(
    () =>
      Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : []).filter((id) => id != null))).sort(
        (a, b) => a - b
      ),
    [nodeIds]
  );
  const idsKey = uniqueIds.join(',');

  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(',').map(Number) : [];
    if (ids.length === 0) {
      runTokenRef.current += 1; // any in-flight run is now stale
      setMembershipsByNodeId({});
      return;
    }
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    const settled = await Promise.all(
      chunkIds(ids).map(async (chunk) => {
        try {
          const payload = await io.getMemberships(chunk);
          return Array.isArray(payload?.memberships) ? payload.memberships : [];
        } catch (error) {
          // Defensive: the read seam absorbs failures to the fallback shape;
          // a contract-violating rejection must not break the map.
          // eslint-disable-next-line no-console
          console.error('[useCollectionMemberships] Failed to load a membership chunk:', error);
          return [];
        }
      })
    );
    if (runTokenRef.current !== token) return; // a newer run started — stale result
    const listRows = (Array.isArray(collections) ? collections : []).filter(
      (collection) => collection && collection.collection_id != null
    );
    // Chip order = collections-LIST order (stable against the store's id order);
    // ids missing from the list are dropped (no unresolvable names).
    const positionById = new Map(listRows.map((c, index) => [Number(c.collection_id), index]));
    const byNode = {};
    for (const row of settled.flat()) {
      if (!row || row.node_id == null) continue;
      const resolved = (Array.isArray(row.collection_ids) ? row.collection_ids : [])
        .map(Number)
        .filter((id) => positionById.has(id))
        .sort((a, b) => positionById.get(a) - positionById.get(b));
      if (resolved.length === 0) continue; // nodes without membership stay ABSENT
      byNode[row.node_id] = resolved.map((id) => ({
        id,
        name: listRows[positionById.get(id)].name,
      }));
    }
    setMembershipsByNodeId(byNode);
  }, [io, idsKey, collections]);

  useEffect(() => {
    load();
  }, [load]);

  // Any collections mutation fans the coarse notifier event — re-read the map
  // (silent evolution included; the payload-free channel is by contract).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const unsubscribe = io.subscribeToCollections(() => {
      loadRef.current();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [io]);

  return { membershipsByNodeId };
};

export default useCollectionMemberships;
