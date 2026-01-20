import React from 'react';
import { render, screen } from '../../test-utils';
import DownloadProgress from '../DownloadProgress';

describe('DownloadProgress', () => {
  it('shows skipped paths list for warning items', () => {
    render(
      <DownloadProgress
        items={[
          {
            id: 'op-1',
            type: 'move',
            status: 'warning',
            name: '폴더 이동',
            progress: 1,
            total: 1,
            error: '권한으로 제외된 항목: 1개',
            skippedPaths: ['/a/b'],
            skippedCount: 1,
          },
        ]}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('제외된 항목: 1개')).toBeInTheDocument();
    expect(screen.getByText('/a/b')).toBeInTheDocument();
  });
});

