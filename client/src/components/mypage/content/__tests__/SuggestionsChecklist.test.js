/**
 * SuggestionsChecklist tests — Q4 checkbox contract
 * (docs/spec/client/components/mypage/content/SuggestionsChecklist.md §2.3):
 * every row carries a checkbox; the ONLY accept control is `Accept selected (N)`;
 * dismiss stays per-row AND only for rows that carry an id (computed P0 rows
 * have none — §2.7 as-built note).
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../../../../test-utils';
import SuggestionsChecklist from '../SuggestionsChecklist';

const row = (overrides = {}) => ({
  node_id: 101,
  kind: 'exact_dup',
  path: '/testuser/photos/beach copy.jpg',
  size_bytes: 2048,
  reason: { kind: 'exact_dup', keep_node_id: 100 },
  ...overrides,
});

describe('SuggestionsChecklist', () => {
  it('renders unchecked checkbox rows and NO accept control at N=0 (absent, not disabled)', () => {
    renderWithProviders(
      <SuggestionsChecklist suggestions={[row(), row({ node_id: 102 })]} onAccept={jest.fn()} />
    );

    const checkboxes = screen.getAllByTestId('suggestion-checkbox');
    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach((box) => expect(box).not.toBeChecked());
    expect(screen.queryByTestId('suggestions-accept')).not.toBeInTheDocument();
    // single-control rule: no per-row accept buttons
    expect(screen.queryAllByRole('button', { name: /accept/i })).toHaveLength(0);
  });

  it('Accept selected (N) tracks the live checked count and sends ONLY checked ids', async () => {
    const onAccept = jest
      .fn()
      .mockResolvedValue({ trashed: [102], rejected_not_owned: [], skipped: [] });
    renderWithProviders(
      <SuggestionsChecklist suggestions={[row(), row({ node_id: 102 })]} onAccept={onAccept} />
    );

    const [first, second] = screen.getAllByTestId('suggestion-checkbox');
    await userEvent.click(second);

    const accept = screen.getByTestId('suggestions-accept');
    expect(accept).toHaveTextContent(/accept selected \(1\)/i);

    await userEvent.click(first);
    expect(screen.getByTestId('suggestions-accept')).toHaveTextContent(/accept selected \(2\)/i);

    await userEvent.click(first); // back to only-102
    await userEvent.click(accept);

    await waitFor(() => expect(onAccept).toHaveBeenCalledWith([102]));
    // success clears the selection
    await waitFor(() =>
      screen.getAllByTestId('suggestion-checkbox').forEach((box) => expect(box).not.toBeChecked())
    );
  });

  it('absorbed failure (null) keeps the checkboxes for retry', async () => {
    const onAccept = jest.fn().mockResolvedValue(null);
    renderWithProviders(<SuggestionsChecklist suggestions={[row()]} onAccept={onAccept} />);

    await userEvent.click(screen.getByTestId('suggestion-checkbox'));
    await userEvent.click(screen.getByTestId('suggestions-accept'));

    await waitFor(() => expect(onAccept).toHaveBeenCalled());
    expect(screen.getByTestId('suggestion-checkbox')).toBeChecked();
  });

  it('renders the basename + reason chip; computed rows (no id) get NO dismiss button', () => {
    renderWithProviders(<SuggestionsChecklist suggestions={[row()]} onAccept={jest.fn()} />);

    expect(screen.getByText('beach copy.jpg')).toBeInTheDocument();
    expect(screen.getByText(/exact duplicate/i)).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-dismiss-88')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/suggestion-dismiss/)).not.toBeInTheDocument();
  });

  it('persisted rows (T3.3 shape) carry a per-row dismiss that only removes that row', async () => {
    const onDismiss = jest.fn();
    renderWithProviders(
      <SuggestionsChecklist
        suggestions={[
          row({ id: 88, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }),
          row({ id: 89, node_id: 102 }),
        ]}
        onAccept={jest.fn()}
        onDismiss={onDismiss}
      />
    );

    await userEvent.click(screen.getByTestId('suggestion-dismiss-88'));
    expect(onDismiss).toHaveBeenCalledWith(88);
    // expiry footer appears only with persisted rows
    expect(screen.getByText(/kept until expiry/i)).toBeInTheDocument();
  });

  it('expiry footer gates on expires_at, not on id: retention-off rows (expires_at null) render no footer', () => {
    renderWithProviders(
      <SuggestionsChecklist
        suggestions={[row({ id: 91, expires_at: null }), row({ id: 92, node_id: 102, expires_at: null })]}
        onAccept={jest.fn()}
        onDismiss={jest.fn()}
      />
    );

    // dismiss controls DO render (rows carry ids) but the expiry footer does not
    expect(screen.getByTestId('suggestion-dismiss-91')).toBeInTheDocument();
    expect(screen.queryByText(/kept until expiry/i)).not.toBeInTheDocument();
  });

  it('loading renders skeleton rows and no interactive controls', () => {
    renderWithProviders(<SuggestionsChecklist suggestions={[]} onAccept={jest.fn()} loading />);

    expect(screen.getAllByTestId('suggestion-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('suggestions-accept')).not.toBeInTheDocument();
  });

  it('empty list (loaded) renders the empty note and no accept button', () => {
    renderWithProviders(<SuggestionsChecklist suggestions={[]} onAccept={jest.fn()} />);

    expect(screen.getByText(/nothing to clean up/i)).toBeInTheDocument();
    expect(screen.queryByTestId('suggestions-accept')).not.toBeInTheDocument();
  });
});
