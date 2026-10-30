/**
 * MergeProposalCard tests — the §2.10 verification scenarios (sticky card,
 * footer accordion, hover/tap detail, B→A tiles, deterministic reason).
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md
 */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18n from '../../../i18n';
import { renderWithProviders } from '../../../test-utils';
import MergeProposalCard from '../MergeProposalCard';
import { useResponsive } from '../../../hooks/useResponsive';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  const base = createUseResponsiveModuleMock();
  return { ...base, useResponsive: jest.fn(base.useResponsive) };
});

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

const secondSuggestion = () =>
  suggestion({
    suggestion_id: 89,
    a_id: 30,
    a_name: 'Kyoto',
    b_id: 31,
    b_name: 'Osaka',
    overlap_count: 12,
    merged_count: 20,
    score: 640,
  });

const render = (props = {}) =>
  renderWithProviders(
    <MergeProposalCard suggestions={[suggestion()]} onAction={jest.fn()} {...props} />
  );

let fakeTimers = false;
const enableFakeTimers = () => {
  jest.useFakeTimers();
  fakeTimers = true;
};

const hoverOpen = (testId = 'merge-card-body') => {
  enableFakeTimers();
  fireEvent.mouseEnter(screen.getByTestId(testId));
  act(() => {
    jest.advanceTimersByTime(200);
  });
  return screen.getByTestId('merge-detail-panel');
};

beforeEach(() => {
  useResponsive.mockReturnValue({ isMobile: false, isTablet: false, isDesktop: true });
});

afterEach(() => {
  if (fakeTimers) {
    jest.clearAllTimers();
    jest.useRealTimers();
    fakeTimers = false;
  }
});

describe('MergeProposalCard', () => {
  it('renders the top pair body, the three card actions and no expand strip/chip', () => {
    render();
    const card = screen.getByTestId('merge-proposal-card');
    // grammar: absorbed = b_name into survivor = a_name (a_id survives server-side)
    expect(card).toHaveTextContent('2025 trip');
    expect(card).toHaveTextContent('Europe');
    expect(card).toHaveTextContent('41');
    expect(card).toHaveTextContent('58');
    expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep separate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
    expect(screen.queryByTestId('merge-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('merge-cycle-chip')).not.toBeInTheDocument();
  });

  it('renders no card DOM at all without suggestions (zero-footprint input)', () => {
    const { container } = render({ suggestions: [] });
    expect(screen.queryByTestId('merge-proposal-card')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('footer is centered text with aria-expanded, expands the remaining rows and caps the list at 40vh', () => {
    render({ suggestions: [suggestion(), secondSuggestion()] });
    expect(screen.queryByTestId('merge-cycle-chip')).not.toBeInTheDocument();
    const footer = screen.getByTestId('merge-more-toggle');
    expect(footer).toHaveTextContent('+1 more');
    expect(footer).toHaveAttribute('role', 'button');
    expect(footer).toHaveAttribute('aria-expanded', 'false');
    expect(footer).not.toHaveClass('MuiChip-root');

    fireEvent.click(footer);
    expect(footer).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('merge-suggestion-list');
    expect(list).toHaveStyle({ maxHeight: '40vh' });
    const row = within(list).getByTestId('merge-suggestion-row-89');
    expect(row).toHaveTextContent('Kyoto');
    expect(row).toHaveTextContent('Osaka');

    fireEvent.click(footer);
    expect(screen.queryByTestId('merge-suggestion-list')).not.toBeInTheDocument();
  });

  it('omits the footer entirely when only one suggestion is pending', () => {
    render();
    expect(screen.queryByTestId('merge-more-toggle')).not.toBeInTheDocument();
  });

  it('Merge dispatches (suggestionId, merge) and opens NO dialog (the card IS the confirmation)', () => {
    const onAction = jest.fn();
    render({ onAction });
    fireEvent.click(screen.getByTestId('merge-accept'));
    expect(onAction).toHaveBeenCalledWith(88, 'merge');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Keep separate and Later dispatch distinct action strings with the row id', () => {
    const onAction = jest.fn();
    render({ onAction });
    fireEvent.click(screen.getByTestId('merge-keep-separate'));
    expect(onAction).toHaveBeenCalledWith(88, 'keep-separate');
    fireEvent.click(screen.getByTestId('merge-later'));
    expect(onAction).toHaveBeenCalledWith(88, 'later');
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('desktop hover opens the detail after 200ms, leaving closes after the 300ms grace', () => {
    render();
    enableFakeTimers();
    fireEvent.mouseEnter(screen.getByTestId('merge-card-body'));
    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('merge-proposal-card'));
    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();
  });

  it('pointer enter on the detail panel cancels the hover close grace', () => {
    render();
    const panel = hoverOpen();
    fireEvent.mouseLeave(screen.getByTestId('merge-proposal-card'));
    act(() => {
      jest.advanceTimersByTime(250);
    });
    fireEvent.mouseEnter(panel);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
  });

  it('detail shows only the title, B(absorbed) → A(survivor) large tiles and the counts reason', () => {
    render();
    const panel = hoverOpen();
    expect(within(panel).getByTestId('merge-detail-title')).toHaveTextContent('Europe');
    expect(within(panel).getByTestId('merge-detail-title')).toHaveTextContent('2025 trip');
    expect(within(panel).queryByText('Shared')).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Only in/)).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('merge-detail-shared')).not.toBeInTheDocument();

    const tiles = within(panel).getByTestId('merge-detail-tiles');
    // DOM order is the visual left-to-right order: B unique, arrow, A unique.
    expect(Array.from(tiles.children).map((el) => el.dataset.testid)).toEqual([
      'merge-detail-unique-b',
      'merge-detail-arrow',
      'merge-detail-unique-a',
    ]);
    expect(within(panel).getByTestId('merge-unique-b-220')).toHaveTextContent('seville.jpg');
    expect(within(panel).getByTestId('merge-unique-a-110')).toHaveTextContent('beach.jpg');
    expect(within(panel).getByTestId('merge-detail-reason')).toHaveTextContent(
      '41 of 58 files are shared; merging keeps them in one collection.'
    );
  });

  it('uses recommendation.reason verbatim when the arbiter supplied one', () => {
    render({
      suggestions: [
        suggestion({ recommendation: { verdict: 'merge', reason: 'same theme, twice' } }),
      ],
    });
    const panel = hoverOpen();
    expect(within(panel).getByTestId('merge-detail-reason')).toHaveTextContent('same theme, twice');
    expect(within(panel).getByTestId('merge-detail-reason')).not.toHaveTextContent(
      '41 of 58 files are shared'
    );
  });

  it('Esc, outside pointer-down and the close button all dismiss the detail', () => {
    render();
    hoverOpen();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('merge-card-body'));
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('merge-card-body'));
    act(() => {
      jest.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByTestId('merge-detail-close'));
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();
  });

  it('detail actions dispatch the displayed row and close the panel', () => {
    const onAction = jest.fn();
    render({ suggestions: [suggestion(), secondSuggestion()], onAction });
    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    const panel = hoverOpen('merge-suggestion-row-89');
    expect(within(panel).getByTestId('merge-detail-title')).toHaveTextContent('Kyoto');
    fireEvent.click(within(panel).getByTestId('merge-detail-later'));
    expect(onAction).toHaveBeenCalledWith(89, 'later');
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();
  });

  it('desktop accordion-row click is a no-op; keyboard Enter opens the row detail', () => {
    render({ suggestions: [suggestion(), secondSuggestion()] });
    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    const row = screen.getByTestId('merge-suggestion-row-89');
    fireEvent.click(row);
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    expect(screen.getByTestId('merge-detail-title')).toHaveTextContent('Kyoto');
  });

  it('keyboard Enter/Space on the body opens the detail', () => {
    render();
    const body = screen.getByTestId('merge-card-body');
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(body, { key: ' ' });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
  });

  it('mobile tap opens the detail; an accordion row tap opens that row', () => {
    useResponsive.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    render({ suggestions: [suggestion(), secondSuggestion()] });
    fireEvent.click(screen.getByTestId('merge-card-body'));
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    fireEvent.click(screen.getByTestId('merge-suggestion-row-89'));
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    expect(screen.getByTestId('merge-detail-title')).toHaveTextContent('Kyoto');
  });

  it('asks the host for the detail sample thumbnails only when the panel opens', () => {
    const onRequestThumbnails = jest.fn();
    render({ onRequestThumbnails });
    expect(onRequestThumbnails).not.toHaveBeenCalled();
    hoverOpen();
    expect(onRequestThumbnails).toHaveBeenCalledWith([110, 220]);
  });

  it('renders host thumbnailMap URLs where loaded and placeholders where not (zero fabrication)', () => {
    render({
      thumbnailMap: new Map([[220, '/api/thumbnails/e2e.jpg?token=abc']]),
    });
    const panel = hoverOpen();
    const tile = within(panel).getByTestId('merge-unique-b-220');
    const image = tile.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/api/thumbnails/e2e.jpg?token=abc');
    // unloaded sample keeps a placeholder — never a fake image
    expect(within(panel).getByTestId('merge-unique-a-110').querySelector('img')).toBeNull();
  });

  it('keeps the same card DOM node when the resolved top row leaves the set', () => {
    const { rerender } = render({ suggestions: [suggestion(), secondSuggestion()] });
    const card = screen.getByTestId('merge-proposal-card');
    rerender(<MergeProposalCard suggestions={[secondSuggestion()]} onAction={jest.fn()} />);
    expect(screen.getByTestId('merge-proposal-card')).toBe(card);
    expect(card).toHaveTextContent('Kyoto');
  });

  it('ko grammar interpolates the particle picker variants for the absorbed name', async () => {
    const original = i18n.language;
    await i18n.changeLanguage('ko');
    useResponsive.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    try {
      render({
        suggestions: [suggestion({ a_name: '사진', b_name: '여행' })],
      });
      // 여행 (final consonant ㄱ) takes 을; 사진 takes 과 with the comitative particle
      expect(screen.getByTestId('merge-proposal-card')).toHaveTextContent('여행을');
      expect(screen.getByTestId('merge-proposal-card')).toHaveTextContent('사진과');
      fireEvent.click(screen.getByTestId('merge-card-body'));
      expect(screen.getByTestId('merge-detail-reason')).toHaveTextContent(
        '58개 중 41개가 공유되어 있습니다'
      );
    } finally {
      await i18n.changeLanguage(original);
      await waitFor(() => expect(screen.getByTestId('merge-accept')).toHaveTextContent('Merge'));
    }
  });
});
