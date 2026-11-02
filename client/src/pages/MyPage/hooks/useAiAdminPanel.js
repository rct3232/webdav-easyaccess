import { useCallback, useEffect, useRef, useState } from 'react';

import * as adminService from '../../../services/adminService';

const DEFAULT_POLL_MS = 15000;

/**
 * Page-local controller for AiAdminContent (useAiAdminPanel.md).
 * Polling is the only refresh channel; a slow read never overlaps the next
 * tick, and unmount clears the timer and drops late responses.
 */
export function useAiAdminPanel({ service = adminService, pollMs = DEFAULT_POLL_MS } = {}) {
  const [summary, setSummary] = useState(null);
  const [preview, setPreview] = useState(null);
  const [journal, setJournal] = useState([]);
  const [journalError, setJournalError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const journalInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const data = await service.getAiAdminSummary();
      if (mountedRef.current) {
        setSummary(data ?? null);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(err);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [service]);

  const refreshJournal = useCallback(async () => {
    if (journalInFlightRef.current) return [];
    journalInFlightRef.current = true;
    try {
      const data = await service.getSettingsJournal();
      const actions = Array.isArray(data?.actions) ? data.actions : [];
      if (mountedRef.current) {
        setJournal(actions);
        setJournalError(null);
      }
      return actions;
    } catch (err) {
      if (mountedRef.current) setJournalError(err);
      return [];
    } finally {
      journalInFlightRef.current = false;
    }
  }, [service]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    refreshJournal();
    const id = setInterval(() => {
      refresh();
      refreshJournal();
    }, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh, refreshJournal, pollMs]);

  const loadPreview = useCallback(async () => {
    setBusyKey('preview');
    try {
      const data = await service.getAiReembedPreview();
      if (mountedRef.current) setPreview(data ?? null);
      return data;
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [service]);

  const launch = useCallback(async () => {
    setBusyKey('launch');
    try {
      const result = await service.startAiReembed();
      await refresh();
      await refreshJournal();
      return result;
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [refresh, refreshJournal, service]);

  const saveSettings = useCallback(
    async (values) => {
      setBusyKey('settings');
      try {
        const result = await service.updateConfig(values);
        await refresh();
        await refreshJournal();
        return result;
      } finally {
        if (mountedRef.current) setBusyKey(null);
      }
    },
    [refresh, refreshJournal, service]
  );

  const probeRoles = useCallback(async () => {
    setBusyKey('probe');
    const roles = ['chat', 'vision', 'asr'];
    const results = [];
    try {
      for (const role of roles) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await service.probeLlmRole(role);
          results.push({ role, ok: true, result });
        } catch (err) {
          results.push({ role, ok: false, error: err });
        }
      }
      await refresh();
      return results;
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  }, [refresh, service]);

  const undoJournal = useCallback(
    async (actionId) => {
      setBusyKey('undo');
      try {
        const result = await service.undoSettingsAction(actionId);
        await refresh();
        await refreshJournal();
        return result;
      } finally {
        if (mountedRef.current) setBusyKey(null);
      }
    },
    [refresh, refreshJournal, service]
  );

  return {
    summary,
    preview,
    journal,
    journalError,
    loading,
    error,
    busyKey,
    refresh,
    refreshJournal,
    loadPreview,
    launch,
    saveSettings,
    probeRoles,
    undoJournal,
  };
}

export default useAiAdminPanel;
