/**
 * Undo-toast controller — turns a mutation's `undo: { action_id }` pointer
 * into ONE bottom toast per command, executes undo through the gateway seam,
 * and drives the tip/cascade/fingerprint/mixed-result outcomes
 * (docs/spec/client/hooks/useUndoToast.md). Owns the ≤24 h undo-window rule
 * of the toast surface; rendering belongs to UndoToast, queue mechanics to
 * the (extended) useMessage bundle.
 */
import { useCallback, useRef, useState } from 'react';
import i18n from '../i18n';
import explorerGateway from '../services/explorerGateway';
import { useMessage } from './useMessage';

// Undo toasts stay 8 s (longer than the default success duration) so the
// action is reachable; the ≤24 h window guards programmatic re-show paths.
const UNDO_TOAST_DURATION_MS = 8000;
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

const CASCADE_ERROR_CODE = 'serverErrors.actions.cascadeConfirmRequired';

/**
 * @param {Object} [options]
 * @param {Object} [options.gateway] - `undoAction(actionId, options?)` seam
 *   resolving the structured result (`collectionsRepository.md` §2.5 — never
 *   throws, 409s surface as `{ ok: false, errorCode, params }`); defaults to
 *   the explorerGateway re-export.
 * @param {Object} [options.message] - `useMessage()` bundle carrying the
 *   action-slot extension; hosts inject THEIR bundle so the toast renders in
 *   their snackbar host. A private fallback bundle is used when omitted.
 * @param {() => void|Promise<void>} [options.refresh] - host listing re-read
 *   invoked after a successful undo.
 * @returns {{ showUndoToast, showReportToast, cascadeConfirm, busy }}
 */
export const useUndoToast = ({ gateway, message, refresh } = {}) => {
  const fallbackMessage = useMessage();
  const msg = message || fallbackMessage;
  const resolvedGateway = gateway || explorerGateway;

  const [busy, setBusy] = useState(false);
  const [cascadeConfirm, setCascadeConfirm] = useState(null);
  // Mirror of `busy` for the click guard inside long-lived toast closures.
  const busyRef = useRef(false);

  /**
   * Execute one undo attempt. Guard failures map per §2.4: cascade-required
   * arms the confirm dialog (409-then-repost); terminal refusals report via
   * showError and drop the action slot (never a dead [Undo] button).
   */
  const runUndo = async (actionId, { confirmCascade = false } = {}) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await resolvedGateway.undoAction(
        actionId,
        confirmCascade ? { confirmCascade: true } : {}
      );

      if (result && result.ok) {
        if (typeof refresh === 'function') {
          try {
            await refresh();
          } catch (refreshError) {
            // refresh failure: report it, do not re-show undo (already undone)
            msg.showError(
              refreshError?.response?.data?.errorCode
                ? i18n.t(refreshError.response.data.errorCode)
                : refreshError?.message || i18n.t('errors.unknown')
            );
            return;
          }
        }
        const undoneCount = Number(result.itemsUndone ?? 0);
        const skippedCount = Number(result.itemsSkipped ?? 0);
        msg.showSuccess(
          skippedCount > 0
            ? i18n.t('actions.undoDoneMixed', { undone: undoneCount, skipped: skippedCount })
            : i18n.t('actions.undoDone', { count: undoneCount })
        );
        setCascadeConfirm(null);
        return;
      }

      const errorCode = result && result.errorCode;
      if (errorCode === CASCADE_ERROR_CODE) {
        setCascadeConfirm({
          open: true,
          laterChanges: Number((result && result.params && result.params.laterChanges) || 0),
          confirm: () => {
            setCascadeConfirm(null);
            runUndo(actionId, { confirmCascade: true });
          },
          cancel: () => setCascadeConfirm(null),
        });
        return;
      }

      // Terminal refusal (fingerprintMismatch | expired | alreadyUndone |
      // notFound): error toast replaces the undo toast — the action slot dies.
      msg.showError(errorCode ? i18n.t(errorCode, result.params) : i18n.t('errors.unknown'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const showUndoToast = useCallback(
    ({ actionId, action_id, text, params, shownAt } = {}) => {
      const resolvedActionId = actionId != null ? actionId : action_id != null ? action_id : null;
      const shownAtMs =
        shownAt instanceof Date
          ? shownAt.getTime()
          : typeof shownAt === 'number'
            ? shownAt
            : shownAt != null
              ? Date.parse(shownAt)
              : Date.now();
      const withinWindow = Number.isFinite(shownAtMs) && Date.now() - shownAtMs <= UNDO_WINDOW_MS;

      const action =
        resolvedActionId != null && withinWindow
          ? { labelKey: 'actions.undo', onClick: () => runUndo(resolvedActionId) }
          : null;

      msg.showMessage(
        params ? i18n.t(text, params) : text,
        'success',
        UNDO_TOAST_DURATION_MS,
        action
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msg]
  );

  const showReportToast = useCallback(
    (text, params) => {
      msg.showMessage(params ? i18n.t(text, params) : text, 'success');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msg]
  );

  return { showUndoToast, showReportToast, cascadeConfirm, busy };
};

export default useUndoToast;
