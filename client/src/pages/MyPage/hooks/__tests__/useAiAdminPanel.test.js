import { act, renderHook } from '@testing-library/react';

import { useAiAdminPanel } from '../useAiAdminPanel';

function buildService(overrides = {}) {
  return {
    getAiAdminSummary: jest.fn().mockResolvedValue({ pipeline: { queue: {} } }),
    getSettingsJournal: jest.fn().mockResolvedValue({ actions: [] }),
    getAiReembedPreview: jest.fn().mockResolvedValue({ plan: { union_count: 2 } }),
    startAiReembed: jest.fn().mockResolvedValue({ enqueued: 2 }),
    updateConfig: jest.fn().mockResolvedValue({ applied: [] }),
    probeLlmRole: jest.fn().mockResolvedValue({ ok: true }),
    undoSettingsAction: jest.fn().mockResolvedValue({ status: 'undone' }),
    ...overrides,
  };
}

describe('useAiAdminPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls the summary and loads the settings journal', async () => {
    const service = buildService();
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 1000 }));

    await act(async () => {});
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(1);
    expect(service.getSettingsJournal).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toEqual({ pipeline: { queue: {} } });
    expect(result.current.loading).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(2);
  });

  it('guards against overlapping summary reads', async () => {
    let resolve;
    const service = buildService({
      getAiAdminSummary: jest.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      ),
    });
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 100000 }));

    await act(async () => {});
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(1);

    const pending = result.current.refresh();
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ pipeline: { queue: { pending: 1 } } });
      await pending;
    });
    expect(result.current.summary.pipeline.queue.pending).toBe(1);
  });

  it('clears the interval and drops late responses on unmount', async () => {
    const service = buildService();
    const { unmount } = renderHook(() => useAiAdminPanel({ service, pollMs: 1000 }));
    await act(async () => {});
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(1);
  });

  it('launch refreshes the summary and journal; preview stays read-only', async () => {
    const service = buildService();
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 100000 }));
    await act(async () => {});

    await act(async () => {
      await result.current.loadPreview();
    });
    expect(result.current.preview.plan.union_count).toBe(2);
    expect(service.startAiReembed).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.launch();
    });
    expect(service.startAiReembed).toHaveBeenCalledTimes(1);
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(2);
    expect(service.getSettingsJournal).toHaveBeenCalledTimes(2);
  });

  it('saves gates and refreshes both surfaces', async () => {
    const service = buildService();
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 100000 }));
    await act(async () => {});

    await act(async () => {
      await result.current.saveSettings({ AI_EVOLUTION_ENABLED: 'false' });
    });
    expect(service.updateConfig).toHaveBeenCalledWith({ AI_EVOLUTION_ENABLED: 'false' });
    expect(service.getAiAdminSummary).toHaveBeenCalledTimes(2);
    expect(service.getSettingsJournal).toHaveBeenCalledTimes(2);
  });

  it('returns the journal rows and keeps a journal failure separate from summary errors', async () => {
    const rows = [{ action_id: 1, subject: 'settings:AI_EVOLUTION_ENABLED' }];
    const service = buildService({
      getSettingsJournal: jest
        .fn()
        .mockResolvedValueOnce({ actions: [] })
        .mockResolvedValueOnce({ actions: rows })
        .mockRejectedValueOnce(new Error('journal down')),
    });
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 100000 }));
    await act(async () => {});

    let returned;
    await act(async () => {
      returned = await result.current.refreshJournal();
    });
    expect(returned).toEqual(rows);
    expect(result.current.journal).toEqual(rows);
    expect(result.current.journalError).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      returned = await result.current.refreshJournal();
    });
    expect(returned).toEqual([]);
    expect(result.current.journalError).toBeInstanceOf(Error);
    expect(result.current.error).toBeNull();
  });

  it('exposes the settings busy key while a gate save is in flight', async () => {
    let resolveSave;
    const service = buildService({
      updateConfig: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          })
      ),
    });
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 100000 }));
    await act(async () => {});

    let pending;
    await act(async () => {
      pending = result.current.saveSettings({ AI_EVOLUTION_ENABLED: 'false' });
      await Promise.resolve();
    });
    expect(result.current.busyKey).toBe('settings');
    await act(async () => {
      resolveSave({ applied: [] });
      await pending;
    });
    expect(result.current.busyKey).toBeNull();
  });

  it('probes every role and isolates a per-role failure', async () => {
    const service = buildService({
      probeLlmRole: jest
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(Object.assign(new Error('probe failed'), { reason: 'transport' }))
        .mockResolvedValueOnce({ ok: true }),
    });
    const { result } = renderHook(() => useAiAdminPanel({ service, pollMs: 100000 }));
    await act(async () => {});

    let results;
    await act(async () => {
      results = await result.current.probeRoles();
    });
    expect(results.map((row) => row.role)).toEqual(['chat', 'vision', 'asr']);
    expect(results.map((row) => row.ok)).toEqual([true, false, true]);
  });
});
