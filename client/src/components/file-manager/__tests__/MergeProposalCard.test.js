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
  a_preview_items: [{ node_id: 110, name: 'beach.jpg', type: 'file', mime: 'image/jpeg' }],
  b_preview_items: [{ node_id: 220, name: 'seville.jpg', type: 'file', mime: 'image/jpeg' }],
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
    const actions = screen.getByTestId('merge-card-actions');
    const actionButtons = Array.from(actions.querySelectorAll('button'));
    expect(actionButtons.map((button) => button.dataset.testid)).toEqual([
      'merge-later',
      'merge-keep-separate',
      'merge-accept',
    ]);
    expect(screen.getByTestId('merge-later')).toHaveClass('MuiIconButton-root');
    expect(screen.getByTestId('merge-keep-separate')).toHaveClass('MuiIconButton-root');
    const mergeButton = screen.getByTestId('merge-accept');
    expect(mergeButton).toHaveClass('MuiButton-contained');
    expect(mergeButton).toHaveClass('MuiButton-colorPrimary');
    expect(mergeButton).not.toHaveClass('MuiIconButton-root');
    actionButtons.forEach((button) => {
      expect(button).not.toHaveClass('MuiButton-outlined');
    });
    expect(
      screen.getByTestId('merge-later').querySelector('[data-testid="SnoozeIcon"]')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('merge-keep-separate').querySelector('[data-testid="BlockIcon"]')
    ).toBeInTheDocument();
    expect(mergeButton.querySelector('[data-testid="MergeTypeIcon"]')).toBeInTheDocument();
    expect(mergeButton).toHaveTextContent('Merge');
    expect(screen.queryByTestId('merge-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('merge-cycle-chip')).not.toBeInTheDocument();
  });

  it('ellipsizes the row collection names, shows full names in the detail, and bolds only names', () => {
    render();
    const row = screen.getByTestId('merge-card-body-text');
    const rowB = within(row).getByText('2025 trip');
    const rowA = within(row).getByText('Europe');
    expect(getComputedStyle(rowB).fontWeight).toBe('600');
    expect(getComputedStyle(rowA).fontWeight).toBe('600');
    expect(getComputedStyle(rowB).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(rowA).textOverflow).toBe('ellipsis');
    const prefix = Array.from(row.querySelectorAll('span')).find(
      (span) => span.textContent === 'Merge "'
    );
    expect(prefix).toBeTruthy();
    expect(getComputedStyle(prefix).fontWeight).not.toBe('600');

    const panel = hoverOpen();
    const title = within(panel).getByTestId('merge-detail-title');
    expect(getComputedStyle(title).fontWeight).not.toBe('600');
    const detailB = within(title).getByText('2025 trip');
    const detailA = within(title).getByText('Europe');
    expect(getComputedStyle(detailB).fontWeight).toBe('600');
    expect(getComputedStyle(detailA).fontWeight).toBe('600');
    expect(getComputedStyle(detailB).textOverflow).not.toBe('ellipsis');
    expect(getComputedStyle(detailA).textOverflow).not.toBe('ellipsis');
  });

  it('renders no card DOM at all without suggestions (zero-footprint input)', () => {
    const { container } = render({ suggestions: [] });
    expect(screen.queryByTestId('merge-proposal-card')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('footer is centered text with aria-expanded, expands the remaining rows and caps the list at 40vh on desktop', () => {
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
    expect(screen.queryByTestId('merge-suggestion-row-89')).not.toBeInTheDocument();
    expect(screen.getByTestId('merge-suggestion-list')).toBeInTheDocument();
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

  it('detail shows only the title, B(absorbed) → A(survivor) collection previews and the counts reason', () => {
    render();
    const panel = hoverOpen();
    expect(within(panel).getByTestId('merge-detail-title')).toHaveTextContent('Europe');
    expect(within(panel).getByTestId('merge-detail-title')).toHaveTextContent('2025 trip');
    expect(within(panel).queryByText('Shared')).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Only in/)).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('merge-detail-shared')).not.toBeInTheDocument();

    const tiles = within(panel).getByTestId('merge-detail-tiles');
    // DOM order is the visual left-to-right order: B preview, arrow, A preview.
    expect(Array.from(tiles.children).map((el) => el.dataset.testid)).toEqual([
      'merge-detail-preview-b',
      'merge-detail-arrow',
      'merge-detail-preview-a',
    ]);
    expect(
      within(panel).getByTestId('merge-preview-b-220').querySelector('.MuiSvgIcon-root')
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId('merge-preview-a-110').querySelector('.MuiSvgIcon-root')
    ).toBeInTheDocument();
    // Collection-card previews never render member filename labels.
    expect(within(panel).queryByText('seville.jpg')).not.toBeInTheDocument();
    expect(within(panel).queryByText('beach.jpg')).not.toBeInTheDocument();
    const sharedStrip = within(panel).getByTestId('merge-detail-shared-strip');
    expect(within(sharedStrip).getByTestId('merge-shared-101')).toBeInTheDocument();
    expect(within(sharedStrip).getByTestId('merge-shared-102')).toBeInTheDocument();
    expect(within(sharedStrip).getByTestId('merge-shared-more')).toHaveTextContent('+39');
    expect(within(panel).getByTestId('merge-detail-reason')).toHaveTextContent(
      '41 of 58 files are shared; merging keeps them in one collection.'
    );
  });

  it('caps the shared strip at three tiles and shows +N from the total overlap count', () => {
    render({
      suggestions: [
        suggestion({
          overlap_count: 7,
          merged_count: 8,
          overlap_sample: [101, 102, 103, 104, 105, 106, 107].map((id) => ({
            a_node_id: id,
            b_node_id: id,
          })),
        }),
      ],
    });
    const panel = hoverOpen();
    const strip = within(panel).getByTestId('merge-detail-shared-strip');
    [101, 102, 103].forEach((id) => {
      expect(within(strip).getByTestId(`merge-shared-${id}`)).toBeInTheDocument();
    });
    expect(within(strip).queryByTestId('merge-shared-104')).not.toBeInTheDocument();
    expect(within(strip).getByTestId('merge-shared-more')).toHaveTextContent('+4');
  });

  it('shows all shared tiles without +N when the overlap count fits', () => {
    render({
      suggestions: [
        suggestion({
          overlap_count: 2,
          merged_count: 3,
          overlap_sample: [
            { a_node_id: 101, b_node_id: 101 },
            { a_node_id: 102, b_node_id: 102 },
          ],
        }),
      ],
    });
    const panel = hoverOpen();
    const strip = within(panel).getByTestId('merge-detail-shared-strip');
    expect(within(strip).getByTestId('merge-shared-101')).toBeInTheDocument();
    expect(within(strip).getByTestId('merge-shared-102')).toBeInTheDocument();
    expect(within(strip).queryByTestId('merge-shared-more')).not.toBeInTheDocument();
  });

  it('omits the shared strip when the pair has no shared files', () => {
    render({
      suggestions: [suggestion({ overlap_count: 0, merged_count: 2, overlap_sample: [] })],
    });
    const panel = hoverOpen();
    expect(within(panel).queryByTestId('merge-detail-shared-strip')).not.toBeInTheDocument();
    expect(within(panel).getByTestId('merge-detail-reason')).toBeInTheDocument();
  });

  it('centers the reason with or without the shared strip', () => {
    const { rerender } = render({
      suggestions: [suggestion({ overlap_count: 0, merged_count: 2, overlap_sample: [] })],
    });
    let panel = hoverOpen();
    expect(getComputedStyle(within(panel).getByTestId('merge-detail-reason')).textAlign).toBe(
      'center'
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });
    rerender(<MergeProposalCard suggestions={[suggestion()]} onAction={jest.fn()} />);
    panel = hoverOpen();
    expect(getComputedStyle(within(panel).getByTestId('merge-detail-reason')).textAlign).toBe(
      'center'
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

  it('every accordion item carries the same actions; the detail itself has none', () => {
    const onAction = jest.fn();
    render({ suggestions: [suggestion(), secondSuggestion()], onAction });
    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    const panel = hoverOpen('merge-suggestion-row-89');
    expect(within(panel).getByTestId('merge-detail-title')).toHaveTextContent('Kyoto');
    expect(within(panel).queryByTestId('merge-detail-accept')).not.toBeInTheDocument();
    expect(screen.getByTestId('merge-row-accept-89')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('merge-row-later-89'));
    expect(onAction).toHaveBeenCalledWith(89, 'later');
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();
  });

  it('portals the detail outside the accordion and card so the scroll box cannot clip it', () => {
    render({ suggestions: [suggestion(), secondSuggestion()] });
    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    const panel = hoverOpen('merge-suggestion-row-89');
    const list = screen.getByTestId('merge-suggestion-list');
    const card = screen.getByTestId('merge-proposal-card');
    expect(list.contains(panel)).toBe(false);
    expect(card.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
  });

  it('desktop accordion-row click is a no-op; keyboard Enter opens the row detail', () => {
    render({ suggestions: [suggestion(), secondSuggestion()] });
    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    const row = screen.getByTestId('merge-row-text-89');
    fireEvent.click(row);
    expect(screen.queryByTestId('merge-detail-panel')).not.toBeInTheDocument();

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    expect(screen.getByTestId('merge-detail-title')).toHaveTextContent('Kyoto');
  });

  it('keyboard Enter/Space on the body opens the detail', () => {
    render();
    const body = screen.getByTestId('merge-card-body-text');
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(body, { key: ' ' });
    expect(screen.getByTestId('merge-detail-panel')).toBeInTheDocument();
  });

  it('uses the 50vh accordion cap on mobile', () => {
    useResponsive.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    render({ suggestions: [suggestion(), secondSuggestion()] });
    fireEvent.click(screen.getByTestId('merge-more-toggle'));
    expect(screen.getByTestId('merge-suggestion-list')).toHaveStyle({ maxHeight: '50vh' });
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

  it('asks the host for the detail preview thumbnails only when the panel opens', () => {
    const onRequestThumbnails = jest.fn();
    render({ onRequestThumbnails });
    expect(onRequestThumbnails).not.toHaveBeenCalled();
    hoverOpen();
    expect(onRequestThumbnails).toHaveBeenCalledWith([110, 220, 101, 102]);
  });

  it('renders host thumbnailMap URLs where loaded and file-type icons where not (zero fabrication)', () => {
    render({
      thumbnailMap: new Map([[220, '/api/thumbnails/e2e.jpg?token=abc']]),
    });
    const panel = hoverOpen();
    const tile = within(panel).getByTestId('merge-preview-b-220');
    const image = tile.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/api/thumbnails/e2e.jpg?token=abc');
    // unloaded preview keeps its file-type icon — never a fake image
    expect(within(panel).getByTestId('merge-preview-a-110').querySelector('img')).toBeNull();
    expect(
      within(panel).getByTestId('merge-preview-a-110').querySelector('.MuiSvgIcon-root')
    ).toBeInTheDocument();
  });

  it('renders at most four collection-preview cells per side and ignores unique samples', () => {
    render({
      suggestions: [
        suggestion({
          a_preview_items: [
            { node_id: 1, name: 'a1.jpg', type: 'file', mime: 'image/jpeg' },
            { node_id: 2, name: 'a2.jpg', type: 'file', mime: 'image/jpeg' },
            { node_id: 3, name: 'a3.jpg', type: 'file', mime: 'image/jpeg' },
            { node_id: 4, name: 'a4.jpg', type: 'file', mime: 'image/jpeg' },
            { node_id: 5, name: 'a5.jpg', type: 'file', mime: 'image/jpeg' },
          ],
          a_unique_sample: [{ node_id: 999, name: 'only-a.jpg' }],
          b_unique_sample: [{ node_id: 998, name: 'only-b.jpg' }],
        }),
      ],
    });
    const panel = hoverOpen();
    expect(within(panel).queryByTestId('merge-preview-a-5')).not.toBeInTheDocument();
    [1, 2, 3, 4].forEach((id) => {
      expect(within(panel).getByTestId(`merge-preview-a-${id}`)).toBeInTheDocument();
    });
    expect(within(panel).queryByTestId('merge-unique-a-999')).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('merge-unique-b-998')).not.toBeInTheDocument();
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
      await waitFor(() =>
        expect(screen.getByTestId('merge-accept')).toHaveAttribute('aria-label', 'Merge')
      );
    }
  });
});
