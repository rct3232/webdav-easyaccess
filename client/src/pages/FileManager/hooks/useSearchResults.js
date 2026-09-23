import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { computeHighlightRanges } from '../../../utils/searchHighlight';
import * as recentQueriesStorage from '../../../services/recentQueriesStorage';

/**
 * Search results-mode controller (docs/spec/client/hooks/useSearchResults.md):
 * distinguishes typing (client inline filter, unchanged) from Enter-submit
 * (server `POST /api/search` via the gateway seam), owns the two-section
 * result state, query chips, client-side highlight ranges and the
 * save-to-collection visibility rule (§4.6: `semantic_available === true`
 * AND `semantic.length > 0`, else the button is HIDDEN).
 *
 * Server call ONLY on submit (§4.6 two-stage rule). `usage_events(search_hit)`
 * logging is a server side effect of the response; the client only sends the
 * §3.4 list-entry-click signal at result open (`recordEntryClick`).
 */

const QUERY_MAX_LENGTH = 200;
const MAX_RECENT_QUERIES = 8;

function normalizeChipKey(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase();
}

/**
 * @param {{ node_id: number, name: string }} row
 * @param {string} query
 */
function attachHighlight(row, query) {
  return {
    ...row,
    highlights: computeHighlightRanges(row?.name ?? '', query),
  };
}

function filterRowsByFilterText(rows, filterText) {
  const q = (filterText || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => (row?.name ?? '').toLowerCase().includes(q));
}

function computeDisplaySections(nameMatches, semantic) {
  const hasName = nameMatches.length > 0;
  const hasSemantic = semantic.length > 0;
  if (hasName && hasSemantic) return 'both';
  if (hasName) return 'name';
  if (hasSemantic) return 'semantic';
  return 'none';
}

function upsertChip(queries, query, resultRef) {
  const key = normalizeChipKey(query);
  const entry = { id: key, query: String(query ?? '').trim(), ...(resultRef && { resultRef }) };
  const rest = queries.filter((chip) => chip.id !== key);
  return [entry, ...rest].slice(0, MAX_RECENT_QUERIES);
}

export const useSearchResults = ({ showError, gateway, onUndoable } = {}) => {
  const [mode, setMode] = useState('filter');
  const [submittedQuery, setSubmittedQuery] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [rawNameMatches, setRawNameMatches] = useState([]);
  const [semantic, setSemantic] = useState([]);
  const [counts, setCounts] = useState(null);
  const [resultRef, setResultRef] = useState(null);
  const [semanticAvailable, setSemanticAvailable] = useState(false);
  const [recentQueries, setRecentQueries] = useState(() =>
    recentQueriesStorage.loadRecentQueries()
  );

  const showErrorRef = useRef(showError);
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  const onUndoableRef = useRef(onUndoable);
  useEffect(() => {
    onUndoableRef.current = onUndoable;
  }, [onUndoable]);

  // Name rows carry client-side computed highlight ranges; the inline filter
  // re-filters the LOADED rows (same substring rule as the listing filter).
  const nameMatches = useMemo(() => {
    const highlighted = rawNameMatches.map((row) => attachHighlight(row, submittedQuery ?? ''));
    return filterRowsByFilterText(highlighted, filterText);
  }, [rawNameMatches, submittedQuery, filterText]);

  const filteredSemantic = useMemo(
    () => filterRowsByFilterText(semantic, filterText),
    [semantic, filterText]
  );

  const displaySections = useMemo(
    () => computeDisplaySections(nameMatches, filteredSemantic),
    [nameMatches, filteredSemantic]
  );

  const canSaveToCollection = useMemo(
    () => semanticAvailable && filteredSemantic.length > 0,
    [semanticAvailable, filteredSemantic]
  );

  const exitResults = useCallback(() => {
    setMode('filter');
    setSubmittedQuery(null);
    setFilterText('');
    setRawNameMatches([]);
    setSemantic([]);
    setCounts(null);
    setResultRef(null);
    setSemanticAvailable(false);
  }, []);

  /**
   * Runs a server query and lands the result state (typing never calls this;
   * §4.6 two-stage rule). Returns the raw payload (or null) so chip-save can
   * consume the SAME execution's result without a stale render closure.
   */
  const runQuery = useCallback(
    async (query) => {
      const resolvedGateway = gateway;
      const trimmed = String(query ?? '').trim();

      // Mode rule: an empty submit is the exit trigger (one ✕ clears both).
      if (trimmed.length === 0) {
        exitResults();
        return null;
      }

      // Client-side 1–200 guard mirroring the server 400s (search.md §2.4).
      if (trimmed.length > QUERY_MAX_LENGTH) {
        if (typeof showErrorRef.current === 'function') {
          showErrorRef.current('serverErrors.search.queryTooLong');
        }
        return null;
      }

      let payload = null;
      let envelope = null;
      if (resolvedGateway && typeof resolvedGateway.runSearch === 'function') {
        payload = await resolvedGateway.runSearch(
          { query: trimmed },
          {
            onError: (error) => {
              envelope = error;
            },
          }
        );
      }

      if (payload === null || payload === undefined) {
        // Transport/5xx or a still-returned 400 → mapped message, prior result
        // set stays intact (§2.6).
        const code =
          envelope?.errorCode === 'serverErrors.search.queryRequired' ||
          envelope?.errorCode === 'serverErrors.search.queryTooLong'
            ? envelope.errorCode
            : 'serverErrors.search.fail';
        if (typeof showErrorRef.current === 'function') {
          showErrorRef.current(code);
        }
        return null;
      }

      const nameMatches = Array.isArray(payload.name_matches) ? payload.name_matches : [];
      const semanticRows = Array.isArray(payload.semantic) ? payload.semantic : [];

      setMode('results');
      setSubmittedQuery(trimmed);
      setFilterText('');
      setRawNameMatches(nameMatches);
      setSemantic(semanticRows);
      setCounts(payload.counts ?? null);
      setResultRef(payload.result_ref ?? null);
      setSemanticAvailable(payload.semantic_available === true);

      // Chip upsert (dedup by normalized query, max 8, newest first).
      const chipResultRef = payload.result_ref ?? undefined;
      setRecentQueries((prev) => {
        const next = upsertChip(prev, trimmed, chipResultRef);
        recentQueriesStorage.saveRecentQueries(next);
        return next;
      });

      return payload;
    },
    [gateway, exitResults]
  );

  const submitSearch = useCallback(
    async (query) => {
      await runQuery(query);
    },
    [runQuery]
  );

  const saveResultsToCollection = useCallback(
    async (name) => {
      // §4.6: saved collections capture the SEMANTIC portion only —
      // name-match rows are structurally excluded from the definition.
      if (!canSaveToCollection || !resultRef) return null;

      const resolvedGateway = gateway;
      if (!resolvedGateway || typeof resolvedGateway.createCollection !== 'function') {
        return null;
      }
      const payload = await resolvedGateway.createCollection(
        { name, origin: 'search', resultRef },
        { onError: () => {} }
      );
      if (!payload) return null;
      if (typeof onUndoableRef.current === 'function' && payload?.undo?.action_id != null) {
        onUndoableRef.current(payload.undo);
      }
      return payload;
    },
    [gateway, canSaveToCollection, resultRef]
  );

  const saveChipQuery = useCallback(
    async (chip) => {
      const query = chip?.query;
      if (!query) return null;
      const payload = await runQuery(query);
      // §4.6 visibility rule on the fresh execution: the chip save is the
      // semantic-only collection with the query text as name (§4.10 default).
      if (!payload || payload.semantic_available !== true) return null;
      if (!Array.isArray(payload.semantic) || payload.semantic.length === 0) return null;
      if (!payload.result_ref) return null;

      const resolvedGateway = gateway;
      if (!resolvedGateway || typeof resolvedGateway.createCollection !== 'function') {
        return null;
      }
      const created = await resolvedGateway.createCollection(
        { name: String(query).trim(), origin: 'search', resultRef: payload.result_ref },
        { onError: () => {} }
      );
      if (!created) return null;
      if (typeof onUndoableRef.current === 'function' && created?.undo?.action_id != null) {
        onUndoableRef.current(created.undo);
      }
      return created;
    },
    [gateway, runQuery]
  );

  const recordEntryClick = useCallback(
    async (nodeId) => {
      const resolvedGateway = gateway;
      if (!resolvedGateway || typeof resolvedGateway.recordSearchClick !== 'function') {
        return false;
      }
      // Absorbed §3.4 signal: never toasts, never throws.
      return resolvedGateway.recordSearchClick(nodeId);
    },
    [gateway]
  );

  return {
    mode,
    submittedQuery,
    filterText,
    setFilterText,
    nameMatches,
    semantic: filteredSemantic,
    counts,
    resultRef,
    displaySections,
    canSaveToCollection,
    recentQueries,
    submitSearch,
    exitResults,
    saveResultsToCollection,
    saveChipQuery,
    recordEntryClick,
  };
};

export default useSearchResults;
