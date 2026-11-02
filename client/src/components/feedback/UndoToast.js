/**
 * UndoToast — bottom toast with an action slot: `[icon] {label} [Undo]`
 * (docs/spec/client/components/feedback/UndoToast.md). The message-bar view
 * for user-triggered commands carrying an undo pointer; fully props-driven,
 * it holds no timers — auto-dismiss is driven by the passed message state.
 */
import React from 'react';
import PropTypes from 'prop-types';
import { Snackbar, Alert, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

const UndoToast = ({ show, text, type = 'success', action = null, onClose }) => {
  const { t } = useTranslation();

  return (
    <Snackbar
      open={Boolean(show)}
      autoHideDuration={null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={onClose} severity={type} sx={{ width: '100%', alignItems: 'center' }}>
        {text}
        {action ? (
          <Button
            color="inherit"
            size="small"
            data-testid="undo-toast-action"
            disabled={Boolean(action.disabled)}
            onClick={action.onAction}
            sx={{ minWidth: 44, minHeight: 44, ml: 2, flexShrink: 0 }}
          >
            {t('actions.undo')}
          </Button>
        ) : null}
      </Alert>
    </Snackbar>
  );
};

UndoToast.propTypes = {
  show: PropTypes.bool.isRequired,
  text: PropTypes.string.isRequired,
  type: PropTypes.string,
  action: PropTypes.shape({
    label: PropTypes.string,
    onAction: PropTypes.func,
    disabled: PropTypes.bool,
  }),
  onClose: PropTypes.func.isRequired,
};

export default UndoToast;
