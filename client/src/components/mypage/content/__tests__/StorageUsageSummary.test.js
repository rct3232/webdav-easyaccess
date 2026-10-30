/**
 * StorageUsageSummary — current breakdown + sparkline view contract
 * (docs/spec/client/components/mypage/content/StorageDashboard.md §2.3).
 */
import React from 'react';
import { screen, within } from '@testing-library/react';

import { renderWithProviders } from '../../../../test-utils';
import StorageUsageSummary, { buildSparklinePoints } from '../StorageUsageSummary';

const current = (overrides = {}) => ({
  total_bytes: 5242880,
  live_bytes: 4194304,
  trash_bytes: 524288,
  versions_bytes: 524288,
  version_history_supported: true,
  incomplete: false,
  ...overrides,
});

describe('StorageUsageSummary', () => {
  it('renders nothing without a current breakdown', () => {
    renderWithProviders(<StorageUsageSummary current={null} series={null} />);
    expect(screen.queryByTestId('storage-usage-summary')).not.toBeInTheDocument();
  });

  it('renders total/live/trash/versions with no quota or percentage copy', () => {
    renderWithProviders(<StorageUsageSummary current={current()} series={{ points: [] }} />);

    const summary = screen.getByTestId('storage-usage-summary');
    for (const label of ['Total', 'Live', 'Trash', 'Versions']) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/quota/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('accepts plain total/live/trash/versions aliases for the breakdown fields', () => {
    renderWithProviders(
      <StorageUsageSummary
        current={{
          total: 5242880,
          live: 4194304,
          trash: 524288,
          versions: 524288,
          version_history_supported: true,
          incomplete: false,
        }}
        series={null}
      />
    );

    const summary = screen.getByTestId('storage-usage-summary');
    expect(within(summary).getByText(/5 MB/i)).toBeInTheDocument();
    expect(within(summary).getByText('Versions')).toBeInTheDocument();
  });

  it('hides versions when version history is unsupported and warns on incomplete data', () => {
    renderWithProviders(
      <StorageUsageSummary
        current={current({ version_history_supported: false, incomplete: true })}
        series={null}
      />
    );

    const summary = screen.getByTestId('storage-usage-summary');
    expect(within(summary).queryByText('Versions')).not.toBeInTheDocument();
    expect(within(summary).getByTestId('storage-usage-incomplete')).toHaveTextContent(
      /may be incomplete/i
    );
  });

  it('renders the sparkline only from two points', () => {
    const { rerender } = renderWithProviders(
      <StorageUsageSummary
        current={current()}
        series={{ points: [{ day: '2026-10-01', bytes: 10 }] }}
      />
    );
    expect(screen.queryByTestId('storage-usage-sparkline')).not.toBeInTheDocument();

    rerender(
      <StorageUsageSummary
        current={current()}
        series={{
          points: [
            { day: '2026-10-01', bytes: 10 },
            { day: '2026-10-02', bytes: 20 },
          ],
        }}
      />
    );
    expect(screen.getByTestId('storage-usage-sparkline')).toBeInTheDocument();
  });

  it('buildSparklinePoints uses actual day spacing and falls back to index spacing', () => {
    const spaced = buildSparklinePoints([
      { day: '2026-10-01', bytes: 0 },
      { day: '2026-10-02', bytes: 0 },
      { day: '2026-10-04', bytes: 0 },
    ])
      .split(' ')
      .map((pair) => Number(pair.split(',')[0]));
    expect(spaced[1]).toBeCloseTo(100 / 3);

    const fallback = buildSparklinePoints([
      { day: 'not-a-day', bytes: 0 },
      { day: 'also-bad', bytes: 0 },
    ])
      .split(' ')
      .map((pair) => Number(pair.split(',')[0]));
    expect(fallback).toEqual([0, 100]);
  });
});
