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

const keepBlock = (overrides = {}) => ({
  name: 'report.pdf',
  relative_score: 0.74,
  confidence: 'high',
  basis: 'resolution',
  factors: { activity: 0.9, quality: 1, name: 1, centrality: 0.5 },
  unopened_30d: false,
  score_version: 'v1',
  ...overrides,
});

const nearRow = (overrides = {}) =>
  row({
    node_id: 202,
    kind: 'near_dup',
    path: '/testuser/docs/report v2.pdf',
    size_bytes: 1024,
    reason: {
      kind: 'near_dup',
      keep_node_id: 201,
      score: 0.962,
      keep: keepBlock(),
    },
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
        suggestions={[
          row({ id: 91, expires_at: null }),
          row({ id: 92, node_id: 102, expires_at: null }),
        ]}
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

  it('near-dup keep block: label + collapsed accessible "Why this keeper?" detail', async () => {
    renderWithProviders(<SuggestionsChecklist suggestions={[nearRow()]} onAccept={jest.fn()} />);

    expect(screen.getByText(/keep: report\.pdf · resolution/i)).toBeInTheDocument();
    const why = screen.getByRole('button', { name: /why this keeper\?/i });
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/group-relative score/i)).not.toBeInTheDocument();

    await userEvent.click(why);

    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/group-relative score: 0\.74/i)).toBeInTheDocument();
    expect(screen.getByText(/group-relative factors/i)).toBeInTheDocument();
    for (const factor of ['activity', 'quality', 'name', 'centrality']) {
      expect(screen.getByTestId(`keeper-factor-${factor}`)).toBeInTheDocument();
    }
    // no raw activity counts/timestamps in the detail
    const detail = screen.getByTestId('keeper-detail-202');
    expect(detail.textContent).not.toMatch(/opens|downloads|last seen|2026-|unopened/i);
  });

  it('legacy near-dup rows without reason.keep render neither the label nor the disclosure', () => {
    renderWithProviders(
      <SuggestionsChecklist
        suggestions={[nearRow({ reason: { kind: 'near_dup', keep_node_id: 201, score: 0.962 } })]}
        onAccept={jest.fn()}
      />
    );

    expect(screen.queryByText(/keep:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /why this keeper/i })).not.toBeInTheDocument();
  });

  it('exact-dup and rule rows never render keeper exposure', () => {
    renderWithProviders(
      <SuggestionsChecklist
        suggestions={[
          row(),
          row({
            node_id: 103,
            kind: 'temp_pattern',
            reason: { kind: 'temp_pattern', pattern: 'temp' },
          }),
        ]}
        onAccept={jest.fn()}
      />
    );

    expect(screen.queryByText(/keep:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /why this keeper/i })).not.toBeInTheDocument();
  });

  it('en/ko keeper i18n keys mirror', () => {
    // eslint-disable-next-line global-require
    const en = require('../../../../locales/en.json');
    // eslint-disable-next-line global-require
    const ko = require('../../../../locales/ko.json');

    const enKeep = en.mypage.suggestionsKeepBasis;
    const koKeep = ko.mypage.suggestionsKeepBasis;
    expect(Object.keys(koKeep).sort()).toEqual(Object.keys(enKeep).sort());
    for (const key of Object.keys(enKeep)) {
      expect(typeof koKeep[key]).toBe('string');
      expect(koKeep[key].length).toBeGreaterThan(0);
    }
    for (const key of [
      'suggestionsKeep',
      'suggestionsKeepWhy',
      'suggestionsKeepScore',
      'suggestionsKeepFactorsLabel',
    ]) {
      expect(typeof en.mypage[key]).toBe('string');
      expect(typeof ko.mypage[key]).toBe('string');
    }
    expect(Object.keys(ko.mypage.suggestionsKeepFactor).sort()).toEqual(
      Object.keys(en.mypage.suggestionsKeepFactor).sort()
    );
  });
});
