/**
 * MergeProposalCard tests — the §2.9 verification scenarios (one card, never
 * stacked; the card IS the confirmation; real compare-overlay rows).
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md
 */
import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18n from '../../../i18n';
import { renderWithProviders } from '../../../test-utils';
import MergeProposalCard from '../MergeProposalCard';

const suggestion = (overrides = {}) => ({
  suggestion_id: 88,
  a_id: 17,
  a_name: 'Europe',
  b_id: 23,
  b_name: '2025 trip',
  overlap_count: 41,
  merged_count: 58,
  score: 812,
  dismiss_count: 0,
  created_at: '2026-09-16T03:00:00Z',
  recommendation: null,
  overlap_sample: [
    { a_node_id: 101, b_node_id: 101 },
    { a_node_id: 102, b_node_id: 102 },
  ],
  a_unique_sample: [{ node_id: 110, name: 'beach.jpg' }],
  b_unique_sample: [{ node_id: 220, name: 'seville.jpg' }],
  ...overrides,
});

const render = (props = {}) =>
  renderWithProviders(
    <MergeProposalCard
      suggestion={suggestion()}
      onMerge={jest.fn()}
      onKeepSeparate={jest.fn()}
      onLater={jest.fn()}
      {...props}
    />
  );

describe('MergeProposalCard', () => {
  it('renders the collapsed 68px one-liner with the strip and the three actions', () => {
    render();
    const card = screen.getByTestId('merge-proposal-card');
    expect(card).toHaveStyle({ minHeight: '68px' });
    // grammar: absorbed = b_name into survivor = a_name (a_id survives server-side)
    expect(card).toHaveTextContent('2025 trip');
    expect(card).toHaveTextContent('Europe');
    expect(card).toHaveTextContent('41');
    expect(card).toHaveTextContent('58');
    expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep separate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
    expect(screen.getByTestId('merge-strip')).toBeInTheDocument();
  });

  it('renders no card DOM at all without a suggestion (zero-footprint input)', () => {
    const { container } = render({ suggestion: null });
    expect(screen.queryByTestId('merge-proposal-card')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('shows the +N more cycle chip only when the pending set has more rows, and onCycle fires on click', () => {
    const onCycle = jest.fn();
    render({ remainingCount: 2, onCycle });
    const chip = screen.getByTestId('merge-cycle-chip');
    expect(chip).toHaveTextContent('+2 more');
    fireEvent.click(chip);
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it('omits the cycle chip entirely when remainingCount is 0 or absent', () => {
    render();
    expect(screen.queryByTestId('merge-cycle-chip')).not.toBeInTheDocument();
  });

  it('Merge dispatches with the pair ids and opens NO dialog (the card IS the confirmation)', () => {
    const onMerge = jest.fn();
    render({ onMerge });
    fireEvent.click(screen.getByTestId('merge-accept'));
    expect(onMerge).toHaveBeenCalledWith(17, 23);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Keep separate and Later dispatch reject/dismiss semantics distinctly with the pair ids', () => {
    const onKeepSeparate = jest.fn();
    const onLater = jest.fn();
    render({ onKeepSeparate, onLater });
    fireEvent.click(screen.getByRole('button', { name: 'Keep separate' }));
    expect(onKeepSeparate).toHaveBeenCalledWith(17, 23);
    expect(onLater).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onLater).toHaveBeenCalledWith(17, 23);
    expect(onKeepSeparate).toHaveBeenCalledTimes(1);
  });

  it('omits the recommendation row entirely when the field is absent (no placeholder)', () => {
    render();
    expect(screen.queryByTestId('merge-recommendation')).not.toBeInTheDocument();
  });

  it('renders the arbiter recommendation as a prefilled advisory row when present', () => {
    render({
      suggestion: suggestion({
        recommendation: { verdict: 'merge', reason: 'same theme, twice' },
      }),
    });
    const row = screen.getByTestId('merge-recommendation');
    expect(row).toHaveTextContent('same theme, twice');
    // advisory only — the Merge button is unchanged
    expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
  });

  it('asks the host for the strip thumbnails with the displayed sample ids', () => {
    const onRequestThumbnails = jest.fn();
    render({ onRequestThumbnails });
    expect(onRequestThumbnails).toHaveBeenCalledWith([101, 102]);
  });

  it('strip click opens the compare overlay with REAL sample rows, Esc closes it', () => {
    render();
    fireEvent.click(screen.getByTestId('merge-strip'));
    const overlay = screen.getByTestId('merge-compare-overlay');
    // shared tiles from overlap_sample
    expect(within(overlay).getByTestId('merge-sample-tile-101')).toBeInTheDocument();
    expect(within(overlay).getByTestId('merge-sample-tile-102')).toBeInTheDocument();
    // per-side unique rows carry the real names from the payload
    expect(within(overlay).getByTestId('merge-unique-a-110')).toHaveTextContent('beach.jpg');
    expect(within(overlay).getByTestId('merge-unique-b-220')).toHaveTextContent('seville.jpg');
    // side headers name the two collections
    expect(overlay).toHaveTextContent('Europe');
    expect(overlay).toHaveTextContent('2025 trip');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('merge-compare-overlay')).not.toBeInTheDocument();
  });

  it('outside click collapses the overlay back to the card', () => {
    render();
    fireEvent.click(screen.getByTestId('merge-strip'));
    expect(screen.getByTestId('merge-compare-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('merge-compare-backdrop'));
    expect(screen.queryByTestId('merge-compare-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('merge-proposal-card')).toBeInTheDocument();
  });

  it('renders host thumbnailMap URLs where loaded and placeholders where not (zero fabrication)', () => {
    render({
      thumbnailMap: new Map([[101, '/api/thumbnails/e2e.jpg?token=abc']]),
    });
    fireEvent.click(screen.getByTestId('merge-strip'));
    const overlay = screen.getByTestId('merge-compare-overlay');
    const tile = within(overlay).getByTestId('merge-sample-tile-101');
    expect(tile.tagName).toBe('IMG');
    expect(tile).toHaveAttribute('src', '/api/thumbnails/e2e.jpg?token=abc');
    // unloaded sample keeps a placeholder — never a fake image
    expect(within(overlay).getByTestId('merge-sample-tile-102').tagName).not.toBe('IMG');
  });

  it('the expand toggle also collapses (strip click is the toggle)', () => {
    render();
    fireEvent.click(screen.getByTestId('merge-strip'));
    expect(screen.getByTestId('merge-compare-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('merge-strip'));
    expect(screen.queryByTestId('merge-compare-overlay')).not.toBeInTheDocument();
  });

  it('ko grammar interpolates the particle picker variants for the absorbed name', async () => {
    const original = i18n.language;
    await i18n.changeLanguage('ko');
    try {
      render({
        suggestion: suggestion({ a_name: '사진', b_name: '여행' }),
      });
      // 여행 (final consonant ㄱ) takes 을; 사진 takes 과 with the comitative particle
      expect(screen.getByTestId('merge-proposal-card')).toHaveTextContent('여행을');
      expect(screen.getByTestId('merge-proposal-card')).toHaveTextContent('사진과');
    } finally {
      await i18n.changeLanguage(original);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument()
      );
    }
  });
});
