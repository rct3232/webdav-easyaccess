/**
 * useCollections — collections-list controller for the FileManager overlay
 * (docs/spec/client/hooks/useCollections.md). Owns list/sort/include state,
 * CRUD call sequencing, merge-suggestion data, and refresh-on-notify. IO
 * routes through the explorerGateway seams (never collectionsRepository/
 * collectionsNotifier imports); absorbed failures branch on `null`/`false`
 * and surface the mapped server error — never an undo affordance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import explorerGateway from '../../../services/explorerGateway';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

const DEFAULT_SORT = 'activity';

/**
 * @param {Object} params
 * @param {(message: string) => void} params.showError user-visible error feedback
 * @param {Object} [params.gateway] collections seams (defaults to the real explorerGateway)
 * @param {(payload: Object, textKey: string, params?: Object) => void} [params.onUndoable]
 *   forwards mutation payloads (undo.action_id) to the undo-toast controller
 * @param {'mine,shared'|'mine,archived'} [params.include] virtual-route driven
 * @returns {{
 *   collections: Array<Object>, loading: boolean,
 *   sort: string, setSort: (string) => Promise<void>,
 *   include: string, refresh: () => Promise<void>,
 *   renameCollection, setPinned, setPublishMode, archiveCollection,
 *   restoreCollection, deleteCollectionPermanent,
 *   suggestions: Array<Object>, mergePair, dismissMergeSuggestion, rejectMergeSuggestion,
 * }}
 */
export const useCollections = ({ showError, gateway, onUndoable, include } = {}) => {
  const { t } = useTranslation();
  const io = gateway || explorerGateway;
  const [collections, setCollections] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSortState] = useState(DEFAULT_SORT);
  const [activeInclude, setActiveInclude] = useState(include ?? 'mine,shared');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(
    async ({ sort: nextSort, include: nextInclude }) => {
      setLoading(true);
      try {
        const [list, merge] = await Promise.all([
          io.loadCollections({
            sort: nextSort ?? DEFAULT_SORT,
            include: nextInclude ?? 'mine,shared',
          }),
          io.getMergeSuggestions().catch(() => ({ suggestions: [] })),
        ]);
        if (!mountedRef.current) return;
        setCollections(list?.collections ?? []);
        setSuggestions(merge?.suggestions ?? []);
      } catch (error) {
        // 404 masquerades read as an empty list — an empty view is not an error
        // eslint-disable-next-line no-console
        console.error('Failed to load collections:', error);
        if (mountedRef.current) {
          setCollections([]);
          setSuggestions([]);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [io]
  );

  const refresh = useCallback(
    () => loadData({ sort, include: activeInclude }),
    [loadData, sort, activeInclude]
  );

  // keep the notifier subscription on the latest refresh without re-subscribing
  const refreshRef = useRef(null);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // initial load + re-read on include change (virtual-route switch)
  useEffect(() => {
    const nextInclude = include ?? 'mine,shared';
    setActiveInclude(nextInclude);
    loadData({ sort, include: nextInclude });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [include]);

  // notifier events refresh the list; unsubscribe on unmount
  useEffect(() => {
    const unsubscribe = io.subscribeToCollections(() => {
      if (refreshRef.current) refreshRef.current();
    });
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io]);

  const setSort = useCallback(
    (nextSort) => {
      setSortState(nextSort);
      loadData({ sort: nextSort, include: activeInclude });
    },
    [loadData, activeInclude]
  );

  /**
   * Shared mutation plumbing: the repository absorbs failures into `null` and
   * hands the error envelope to onError; the hook branches on null → mapped
   * showError, never onUndoable. Success → refresh + undo-toast forward.
   */
  const runMutation = useCallback(
    async (mutation, { textKey } = {}) => {
      let envelope = null;
      const options = {
        onError: (error) => {
          envelope = error;
        },
      };
      const payload = await mutation(options);
      if (!mountedRef.current) return payload;
      if (payload === null) {
        if (showError) {
          showError(getServerErrorDisplay(envelope, t));
        }
        return null;
      }
      await refresh();
      if (onUndoable) {
        onUndoable(payload, textKey);
      }
      return payload;
    },
    [showError, onUndoable, refresh, t]
  );

  const renameCollection = useCallback(
    (id, value) =>
      runMutation((options) => io.updateCollection(id, { name: value }, options), {
        textKey: 'collections.undoRenamed',
      }),
    [io, runMutation]
  );

  const setPinned = useCallback(
    (id, value) =>
      runMutation((options) => io.updateCollection(id, { pinned: value }, options), {
        textKey: 'collections.undoPinChanged',
      }),
    [io, runMutation]
  );

  const setPublishMode = useCallback(
    (id, value) =>
      runMutation((options) => io.updateCollection(id, { publishMode: value }, options), {
        textKey: 'collections.undoPublishModeChanged',
      }),
    [io, runMutation]
  );

  const archiveCollection = useCallback(
    (id) =>
      runMutation((options) => io.archiveCollection(id, options), {
        textKey: 'collections.undoArchived',
      }),
    [io, runMutation]
  );

  const restoreCollection = useCallback(
    (id) =>
      runMutation((options) => io.restoreCollection(id, options), {
        textKey: 'collections.undoRestored',
      }),
    [io, runMutation]
  );

  /** Archived-only 2-step permanent delete — never yields an undo affordance. */
  const deleteCollectionPermanent = useCallback(
    async (id) => {
      let envelope = null;
      const ok = await io.deleteCollection(id, {
        onError: (error) => {
          envelope = error;
        },
      });
      if (!mountedRef.current) return ok === true;
      if (ok === true) {
        await refresh();
      } else if (showError) {
        showError(getServerErrorDisplay(envelope, t));
      }
      return ok === true;
    },
    [io, showError, refresh, t]
  );

  const mergePair = useCallback(
    (id, otherId) =>
      runMutation((options) => io.mergeCollections(id, otherId, options), {
        textKey: 'collections.undoMerged',
      }),
    [io, runMutation]
  );

  // dismiss/reject touch proposal state only (non-journaled) — no undo affordance
  const dismissMergeSuggestion = useCallback((id, otherId) => io.dismissMerge(id, otherId), [io]);
  const rejectMergeSuggestion = useCallback((id, otherId) => io.rejectMerge(id, otherId), [io]);

  return {
    collections,
    loading,
    sort,
    setSort,
    include: activeInclude,
    refresh,
    renameCollection,
    setPinned,
    setPublishMode,
    archiveCollection,
    restoreCollection,
    deleteCollectionPermanent,
    suggestions,
    mergePair,
    dismissMergeSuggestion,
    rejectMergeSuggestion,
  };
};

export default useCollections;
