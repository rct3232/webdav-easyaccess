import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  computeHighlightRanges,
  matchesAllTerms,
  matchesTerm,
} from '../../../utils/searchHighlight';
import { sortFiles } from '../../../utils/fileUtils';
import * as recentQueriesStorage from '../../../services/recentQueriesStorage';

/**
 * Search results-mode controller (docs/spec/client/hooks/useSearchResults.md):
 * mode machine (`browse` / `pending` / `results`), the committed refinement
 * chain with per-step snapshots (`intersect-name` — RAG refines through the
 * one `applyStep(prevSnapshot, response, term)` seam without touching chip /
 * undo / snapshot mechanics), zone composition for the accordion listing
 * (Zone A = session rows in the snapshot set, Zone B = enriched server rows
 * deduped for display, Zone C = semantic snapshot rows), live-filter
 * promotion + dual-color highlights (rows are never hidden), server-row
 * metadata enrichment through the gateway seam, entry-click recording and
 * recent-query persistence (sessionStorage adapter).
 */

const QUERY_MAX_LENGTH = 200;
const MAX_RECENT_QUERIES = 8;
const INTERSECT_NAME_OP = 'intersect-name';

const EMPTY_SNAPSHOT = { zoneAIds: new Set(), zoneBRows: [], zoneCRows: [], resultRef: null };

function rowName(row) {
  return row?.basename || row?.name || '';
}

function normalizeChipKey(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase();
}

function upsertChip(queries, query, resultRef) {
  const key = normalizeChipKey(query);
  const entry = { id: key, query: String(query ?? '').trim(), ...(resultRef && { resultRef }) };
  const rest = queries.filter((chip) => chip.id !== key);
  return [entry, ...rest].slice(0, MAX_RECENT_QUERIES);
}

function committedRanges(name, terms) {
  return computeHighlightRanges(name, terms, 'committed');
}

function liveRanges(name, liveText) {
  const term = String(liveText ?? '').trim();
  return term ? computeHighlightRanges(name, [term], 'live') : [];
}

/**
 * Zone B/C adapter row (FileManagerView.md §3 toMemberRow idiom): explorer-row
 * shape from the snapshot `{ node_id, name }` plus the enrichment fields once
 * the metadata chunk arrives. `hasWritePermission === false` (enriched) feeds
 * the read-only badge + bulk gate; the size caption stays suppressed while
 * `size == null` (`isSearchServerRow` rule in the row components).
 */
function toSearchRow(raw, meta, terms, liveText) {
  const name = raw.name ?? '';
  const row = {
    nodeId: raw.node_id,
    path: '',
    name,
    basename: name,
    isSearchServerRow: true,
    rowTestId: `server-search-row-${raw.node_id}`,
    highlights: [...committedRanges(name, terms), ...liveRanges(name, liveText)],
  };
  if (meta) {
    row.type = meta.type ?? null;
    row.size = meta.size ?? null;
    row.lastmod = meta.lastmod ?? null;
    row.mime = meta.mime ?? null;
    row.hasReadPermission = meta.hasReadPermission === true;
    row.hasWritePermission = meta.hasWritePermission === true;
    if (meta.thumbnailUrl) row.thumbnailUrl = meta.thumbnailUrl;
  }
  return row;
}

/**
 * Zone ordering (useSearchResults.md §2.3): session `sortMode` via `sortFiles`
 * with the live split — `[matches by sortMode] ++ [non-matches by sortMode]`;
 * empty live text = pure sortMode order. Unenriched server rows sort on a null
 * `lastmod`, which `sortFiles` keeps in original (stable) order.
 */
function orderZoneRows(rows, sortMode, liveText) {
  const sorted = sortFiles(rows, sortMode);
  const term = String(liveText ?? '').trim();
  if (!term) return sorted;
  const promoted = [];
  const rest = [];
  for (const row of sorted) {
    (matchesTerm(rowName(row), term) ? promoted : rest).push(row);
  }
  return [...promoted, ...rest];
}

export const useSearchResults = ({
  showError,
  gateway,
  files = [],
  sortMode = 'name_asc',
  liveText = '',
} = {}) => {
  const [mode, setMode] = useState('browse');
  const [chain, setChain] = useState([]);
  const [enrichment, setEnrichment] = useState(() => ({}));
  const [recentQueries, setRecentQueries] = useState(() =>
    recentQueriesStorage.loadRecentQueries()
  );

  const showErrorRef = useRef(showError);
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  const filesRef = useRef(files);
  filesRef.current = files;
  const chainRef = useRef(chain);
  chainRef.current = chain;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const attemptedEnrichmentRef = useRef(new Set());

  const fail = useCallback((code) => {
    if (typeof showErrorRef.current === 'function') showErrorRef.current(code);
  }, []);

  // op seam — `intersect-name`: step 1 takes the response `name_matches`,
  // step k>1 intersects the previous snapshot ids; Zone A membership is
  // recomputed client-side over ALL committed terms at every step.
  const applyStep = useCallback((prevSnapshot, response, term) => {
    const nameMatches = Array.isArray(response.name_matches) ? response.name_matches : [];
    const semanticRows = Array.isArray(response.semantic) ? response.semantic : [];
    const terms = [...chainRef.current.map((step) => step.term), term];
    const zoneAIds = new Set(
      (filesRef.current ?? [])
        .filter((file) => file?.nodeId != null && matchesAllTerms(rowName(file), terms))
        .map((file) => file.nodeId)
    );
    let zoneBRows;
    if (prevSnapshot) {
      const incomingIds = new Set(nameMatches.map((row) => row.node_id));
      zoneBRows = prevSnapshot.zoneBRows.filter((row) => incomingIds.has(row.node_id));
    } else {
      zoneBRows = nameMatches;
    }
    const zoneCRows =
      semanticRows.length > 0 ? semanticRows : prevSnapshot ? prevSnapshot.zoneCRows : [];
    return { zoneAIds, zoneBRows, zoneCRows, resultRef: response.result_ref ?? null };
  }, []);

  const submitSearch = useCallback(
    async (query) => {
      const trimmed = String(query ?? '').trim();
      if (trimmed.length === 0) return;
      if (trimmed.length > QUERY_MAX_LENGTH) {
        fail('serverErrors.search.queryTooLong');
        return;
      }
      if (!gateway || typeof gateway.runSearch !== 'function') return;

      const previousMode = modeRef.current;
      const previousChain = chainRef.current;
      const prevSnapshot =
        previousMode === 'results' && previousChain.length > 0
          ? previousChain[previousChain.length - 1].snapshot
          : null;

      setMode('pending');

      let payload = null;
      let envelope = null;
      payload = await gateway.runSearch(
        { query: trimmed },
        {
          onError: (error) => {
            envelope = error;
          },
        }
      );

      if (payload === null || payload === undefined) {
        const code =
          envelope?.errorCode === 'serverErrors.search.queryRequired' ||
          envelope?.errorCode === 'serverErrors.search.queryTooLong'
            ? envelope.errorCode
            : 'serverErrors.search.fail';
        fail(code);
        setMode(previousMode);
        return;
      }

      const snapshot = applyStep(prevSnapshot, payload, trimmed);
      const step = {
        term: trimmed,
        op: INTERSECT_NAME_OP,
        snapshot,
        inputTextAtCommit: String(query ?? ''),
      };
      setChain(prevSnapshot ? [...previousChain, step] : [step]);
      setMode('results');

      setRecentQueries((prev) => {
        const next = upsertChip(prev, trimmed, payload.result_ref ?? undefined);
        recentQueriesStorage.saveRecentQueries(next);
        return next;
      });
    },
    [gateway, applyStep, fail]
  );

  // Pure client-side snapshot restore — no server call, no re-search.
  const undoToStep = useCallback((index) => {
    setChain((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.slice(0, index + 1);
    });
  }, []);

  const exitResults = useCallback(() => {
    setMode('browse');
    setChain([]);
    setEnrichment({});
    attemptedEnrichmentRef.current = new Set();
  }, []);

  const currentSnapshot = chain.length > 0 ? chain[chain.length - 1].snapshot : EMPTY_SNAPSHOT;
  const zoneAIds = currentSnapshot.zoneAIds;
  const terms = useMemo(() => chain.map((step) => step.term), [chain]);

  // Enrichment: snapshot row ids missing from the map go through the gateway
  // metadata seam (chunked ≤100/POST inside `loadNodesMetadata`); failures and
  // missing rows leave rows unenriched (no toast, no blocking).
  const enrichmentKey = useMemo(
    () =>
      currentSnapshot.zoneBRows
        .concat(currentSnapshot.zoneCRows)
        .map((row) => row.node_id)
        .filter((nodeId) => nodeId != null && enrichment[nodeId] === undefined)
        .join(','),
    [currentSnapshot, enrichment]
  );

  useEffect(() => {
    if (!gateway || typeof gateway.loadNodesMetadata !== 'function') return undefined;
    if (!enrichmentKey) return undefined;
    const ids = enrichmentKey
      .split(',')
      .map(Number)
      .filter((nodeId) => !attemptedEnrichmentRef.current.has(nodeId));
    if (ids.length === 0) return undefined;
    let cancelled = false;
    const markAttempted = () => ids.forEach((nodeId) => attemptedEnrichmentRef.current.add(nodeId));
    Promise.resolve(gateway.loadNodesMetadata(ids))
      .then((rows) => {
        markAttempted();
        if (cancelled || !Array.isArray(rows)) return;
        setEnrichment((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const row of rows) {
            if (row?.nodeId != null && next[row.nodeId] === undefined) {
              next[row.nodeId] = row;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      })
      .catch(() => {
        markAttempted();
      });
    return () => {
      cancelled = true;
    };
  }, [gateway, enrichmentKey]);

  const zoneARows = useMemo(() => {
    if (terms.length === 0) return [];
    const matched = (files ?? [])
      .filter((file) => file?.nodeId != null && zoneAIds.has(file.nodeId))
      .map((file) => {
        const name = rowName(file);
        const other = (Array.isArray(file.highlights) ? file.highlights : []).filter(
          (range) => range && range.kind !== 'live' && range.kind !== 'committed'
        );
        return {
          ...file,
          highlights: [...other, ...committedRanges(name, terms), ...liveRanges(name, liveText)],
        };
      });
    return orderZoneRows(matched, sortMode, liveText);
  }, [files, zoneAIds, terms, sortMode, liveText]);

  const zoneBRows = useMemo(() => {
    if (chain.length === 0) return [];
    const rows = currentSnapshot.zoneBRows
      .filter((raw) => !zoneAIds.has(raw.node_id))
      .map((raw) => toSearchRow(raw, enrichment[raw.node_id], terms, liveText));
    return orderZoneRows(rows, sortMode, liveText);
  }, [chain, currentSnapshot, zoneAIds, enrichment, terms, liveText, sortMode]);

  const zoneCRows = useMemo(() => {
    if (chain.length === 0) return [];
    const rows = currentSnapshot.zoneCRows.map((raw) =>
      toSearchRow(raw, enrichment[raw.node_id], terms, liveText)
    );
    return orderZoneRows(rows, sortMode, liveText);
  }, [chain, currentSnapshot, enrichment, terms, liveText, sortMode]);

  const zoneCounts = useMemo(
    () => ({
      zoneA: zoneAIds.size,
      zoneB: currentSnapshot.zoneBRows.length,
      zoneC: currentSnapshot.zoneCRows.length,
    }),
    [zoneAIds, currentSnapshot]
  );

  const libraryAddTarget = useMemo(
    () =>
      new Set([
        ...zoneAIds,
        ...currentSnapshot.zoneBRows.map((row) => row.node_id).filter((id) => id != null),
      ]),
    [zoneAIds, currentSnapshot]
  );

  const recordEntryClick = useCallback(
    async (nodeId) => {
      if (!gateway || typeof gateway.recordSearchClick !== 'function') return false;
      // Absorbed §3.4 signal: never toasts, never throws.
      try {
        return await gateway.recordSearchClick(nodeId);
      } catch {
        return false;
      }
    },
    [gateway]
  );

  return {
    mode,
    chain,
    terms,
    zoneAIds,
    zoneARows,
    zoneBRows,
    zoneCRows,
    zoneCounts,
    libraryAddTarget,
    recentQueries,
    submitSearch,
    undoToStep,
    exitResults,
    recordEntryClick,
  };
};

export default useSearchResults;
