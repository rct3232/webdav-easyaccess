/**
 * useUndoToast controller tests.
 * @see docs/spec/client/hooks/useUndoToast.md
 * @see docs/spec/client/services/collectionsRepository.md §2.5 (gateway seam contract)
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useMessage } from '../useMessage';
import { useUndoToast } from '../useUndoToast';

jest.mock('../../i18n', () => ({
  __esModule: true,
  // plain function: CRA's resetMocks:true strips jest.fn implementations
  default: {
    t: (key, params) => `${key}${params ? `:${JSON.stringify(params)}` : ''}`,
  },
}));

const OK_UNDO = {
  ok: true,
  status: 200,
  undoneAt: '2026-09-17T10:00:00Z',
  cascadeUndone: [],
  itemsUndone: 1,
  itemsSkipped: 0,
};

function setup({ gateway, refresh } = {}) {
  const mockGateway = gateway || { undoAction: jest.fn() };
  const rendered = renderHook(() => {
    const message = useMessage();
    const undo = useUndoToast({ gateway: mockGateway, message, refresh });
    return { message, undo };
  });
  return { ...rendered, gateway: mockGateway };
}

/** Trigger the undo through the toast's action slot (the spec-visible seam). */
async function clickUndo(result) {
  await act(async () => {
    await result.current.message.message.action.onClick();
  });
}

describe('useUndoToast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('showUndoToast renders one toast with the undo action slot (labelKey actions.undo)', () => {
    const { result } = setup();

    act(() => {
      result.current.undo.showUndoToast({ actionId: 42, text: 'Move completed (12 items)' });
    });

    expect(result.current.message.message.show).toBe(true);
    expect(result.current.message.message.text).toBe('Move completed (12 items)');
    expect(result.current.message.message.action).toMatchObject({ labelKey: 'actions.undo' });
    expect(result.current.undo.busy).toBe(false);
  });

  it('a second showUndoToast replaces the pending one (one toast per command)', () => {
    const { result } = setup();

    act(() => result.current.undo.showUndoToast({ actionId: 1, text: 'First command' }));
    act(() => result.current.undo.showUndoToast({ actionId: 7, text: 'Second command' }));

    expect(result.current.message.message.text).toBe('Second command');
    expect(result.current.message.message.show).toBe(true);
  });

  it('tip undo: ok → refresh called once, then the count toast (no action slot)', async () => {
    const refresh = jest.fn();
    const gateway = { undoAction: jest.fn().mockResolvedValue({ ...OK_UNDO }) };
    const { result } = setup({ gateway, refresh });

    act(() => result.current.undo.showUndoToast({ actionId: 42, text: 'Move completed' }));
    await clickUndo(result);

    expect(gateway.undoAction).toHaveBeenCalledWith(42, {});
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.message.message.show).toBe(true);
    expect(result.current.message.message.text).toContain('actions.undoDone');
    expect(result.current.message.message.action).toBeNull();
  });

  it('mixed results render both counts', async () => {
    const gateway = {
      undoAction: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        undoneAt: '2026-09-17T10:00:00Z',
        cascadeUndone: [],
        itemsUndone: 11,
        itemsSkipped: 1,
      }),
    };
    const { result } = setup({ gateway });

    act(() =>
      result.current.undo.showUndoToast({ actionId: 42, text: 'Add completed (12 items)' })
    );
    await clickUndo(result);

    expect(result.current.message.message.text).toContain('actions.undoDoneMixed');
    expect(result.current.message.message.text).toContain('"undone":11');
    expect(result.current.message.message.text).toContain('"skipped":1');
  });

  it('non-tip 409 exposes cascadeConfirm.laterChanges; confirm re-posts confirmCascade', async () => {
    const gateway = {
      undoAction: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          errorCode: 'serverErrors.actions.cascadeConfirmRequired',
          params: { laterChanges: 2 },
        })
        .mockResolvedValueOnce({ ...OK_UNDO }),
    };
    const { result } = setup({ gateway });

    act(() => result.current.undo.showUndoToast({ actionId: 5, text: 'Create collection' }));
    await clickUndo(result);

    expect(result.current.undo.cascadeConfirm).toMatchObject({
      open: true,
      laterChanges: 2,
    });

    await act(async () => {
      await result.current.undo.cascadeConfirm.confirm();
    });

    expect(gateway.undoAction).toHaveBeenLastCalledWith(5, { confirmCascade: true });
    expect(result.current.undo.cascadeConfirm).toBeNull();
  });

  it('cascadeConfirm.cancel clears the dialog without posting', async () => {
    const gateway = {
      undoAction: jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        errorCode: 'serverErrors.actions.cascadeConfirmRequired',
        params: { laterChanges: 3 },
      }),
    };
    const { result } = setup({ gateway });

    act(() => result.current.undo.showUndoToast({ actionId: 5, text: 'Create collection' }));
    await clickUndo(result);
    expect(result.current.undo.cascadeConfirm).not.toBeNull();

    act(() => {
      result.current.undo.cascadeConfirm.cancel();
    });
    expect(result.current.undo.cascadeConfirm).toBeNull();
    expect(gateway.undoAction).toHaveBeenCalledTimes(1);
  });

  it('fingerprintMismatch shows the error and drops the action button', async () => {
    const gateway = {
      undoAction: jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        errorCode: 'serverErrors.actions.fingerprintMismatch',
      }),
    };
    const { result } = setup({ gateway });

    act(() => result.current.undo.showUndoToast({ actionId: 9, text: 'Add to collection' }));
    await clickUndo(result);

    expect(result.current.message.message.type).toBe('error');
    expect(result.current.message.message.action).toBeNull();
  });

  it('undo pressed twice: the second hits alreadyUndone → error path, no extra refresh', async () => {
    const refresh = jest.fn();
    const gateway = {
      undoAction: jest
        .fn()
        .mockResolvedValueOnce({ ...OK_UNDO })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          errorCode: 'serverErrors.actions.alreadyUndone',
        }),
    };
    const { result } = setup({ gateway, refresh });

    act(() => result.current.undo.showUndoToast({ actionId: 42, text: 'Move completed' }));
    await clickUndo(result);
    expect(refresh).toHaveBeenCalledTimes(1);

    // the success toast dropped the slot; the spec's double-press path is the
    // programmatic re-show: the second undo attempt reports the refusal.
    act(() => result.current.undo.showUndoToast({ actionId: 42, text: 'Move completed' }));
    await clickUndo(result);

    expect(refresh).toHaveBeenCalledTimes(1); // no refresh loop on the refusal
    expect(result.current.message.message.type).toBe('error');
  });

  it('busy blocks a second undo while one is in flight', async () => {
    let release;
    const gateway = {
      undoAction: jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      ),
    };
    const { result } = setup({ gateway });

    act(() => result.current.undo.showUndoToast({ actionId: 42, text: 'Move completed' }));

    let inFlight;
    act(() => {
      inFlight = result.current.message.message.action.onClick();
    });
    expect(result.current.undo.busy).toBe(true);

    // a second press while busy must not re-enter the gateway
    await act(async () => {
      await result.current.message.message.action.onClick();
    });
    expect(gateway.undoAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ ...OK_UNDO });
      await inFlight;
    });
    expect(result.current.undo.busy).toBe(false);
  });

  it('showReportToast renders without an action slot', () => {
    const { result } = setup();

    act(() => result.current.undo.showReportToast('1 item permanently deleted'));

    expect(result.current.message.message.show).toBe(true);
    expect(result.current.message.message.text).toBe('1 item permanently deleted');
    expect(result.current.message.message.action).toBeNull();
  });

  it('a payload without an action id shows no undo affordance (permanent-delete contract)', () => {
    const { result } = setup();

    // hosts must not call showUndoToast without actionId; showUndoToast with
    // no id renders report-only (defensive) — no dead [Undo] button.
    act(() => result.current.undo.showUndoToast({ text: 'Deleted permanently' }));

    expect(result.current.message.message.show).toBe(true);
    expect(result.current.message.message.action).toBeNull();
  });

  it('the ≤24h rule drops the action slot for programmatic re-shows of stale commands', () => {
    const { result } = setup();

    const stale = Date.now() - 25 * 3600 * 1000;
    act(() =>
      result.current.undo.showUndoToast({ actionId: 9, text: 'Old command', shownAt: stale })
    );

    expect(result.current.message.message.show).toBe(true);
    expect(result.current.message.message.action).toBeNull();
  });

  it('undo success with a failing refresh reports the refresh error', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('refresh blew up'));
    const gateway = { undoAction: jest.fn().mockResolvedValue({ ...OK_UNDO }) };
    const { result } = setup({ gateway, refresh });

    act(() => result.current.undo.showUndoToast({ actionId: 42, text: 'Move completed' }));
    await clickUndo(result);

    expect(result.current.message.message.type).toBe('error');
    expect(result.current.message.message.action).toBeNull();
  });

  it("per-call refresh replaces the mount-level refresh for that toast's undo", async () => {
    const mountRefresh = jest.fn();
    const overrideRefresh = jest.fn();
    const gateway = { undoAction: jest.fn().mockResolvedValue({ ...OK_UNDO }) };
    const { result } = setup({ gateway, refresh: mountRefresh });

    act(() =>
      result.current.undo.showUndoToast({
        actionId: 42,
        text: 'Move completed (2 items)',
        refresh: overrideRefresh,
      })
    );
    await clickUndo(result);

    expect(overrideRefresh).toHaveBeenCalledTimes(1);
    expect(mountRefresh).not.toHaveBeenCalled();
  });

  it('per-call refresh survives the 409 cascade-confirm re-post', async () => {
    const mountRefresh = jest.fn();
    const overrideRefresh = jest.fn();
    const gateway = {
      undoAction: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          errorCode: 'serverErrors.actions.cascadeConfirmRequired',
          params: { laterChanges: 1 },
        })
        .mockResolvedValueOnce({ ...OK_UNDO }),
    };
    const { result } = setup({ gateway, refresh: mountRefresh });

    act(() =>
      result.current.undo.showUndoToast({
        actionId: 5,
        text: 'Move completed',
        refresh: overrideRefresh,
      })
    );
    await clickUndo(result);
    expect(result.current.undo.cascadeConfirm).toMatchObject({ open: true, laterChanges: 1 });

    await act(async () => {
      await result.current.undo.cascadeConfirm.confirm();
    });

    expect(gateway.undoAction).toHaveBeenLastCalledWith(5, { confirmCascade: true });
    expect(overrideRefresh).toHaveBeenCalledTimes(1);
    expect(mountRefresh).not.toHaveBeenCalled();
  });
});
