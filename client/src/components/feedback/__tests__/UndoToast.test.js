/**
 * UndoToast component tests.
 * @see docs/spec/client/components/feedback/UndoToast.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import UndoToast from '../UndoToast';

describe('UndoToast', () => {
  it('renders the label and the action button; click invokes onAction once', async () => {
    const onAction = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <UndoToast
        show
        text="Move completed (12 items)"
        type="success"
        action={{ label: 'Undo', onAction }}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('Move completed (12 items)')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders no button when action is null (report-only path)', () => {
    renderWithProviders(
      <UndoToast show text="1 item permanently deleted" type="success" action={null} onClose={jest.fn()} />
    );

    expect(screen.getByText('1 item permanently deleted')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disabled action blocks clicks without unmounting the label', async () => {
    const onAction = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <UndoToast
        show
        text="Add to collection completed"
        action={{ label: 'Undo', onAction, disabled: true }}
        onClose={jest.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText('Add to collection completed')).toBeInTheDocument();
  });

  it('holds no timers: the toast stays open while the message state says so', () => {
    jest.useFakeTimers();
    try {
      renderWithProviders(
        <UndoToast show text="Moved" action={{ label: 'Undo', onAction: jest.fn() }} onClose={jest.fn()} />
      );

      jest.advanceTimersByTime(60000);
      expect(screen.getByText('Moved')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('dismissal reaches onClose via the alert close affordance', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <UndoToast show text="Rename completed" action={{ label: 'Undo', onAction: jest.fn() }} onClose={onClose} />
    );

    await user.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});