/**
 * ShareLinkSingleFileView page tests.
 * Verifies observable outcomes: single file preview renders with file name.
 * @see docs/spec/client/pages/ShareLinkSingleFileView.md
 * @see docs/TESTING_STRATEGY.md — verify What (outcomes), not How.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils';
import ShareLinkSingleFileView from '../ShareLinkSingleFileView';

jest.mock('../../components/dialogs', () => ({
  FilePreviewDialog: ({ file, shareToken }) => (
    <div data-testid="file-preview-dialog">
      <span data-testid="file-name">{file?.name || ''}</span>
      <span data-testid="file-node-id">{file?.nodeId || ''}</span>
      <span data-testid="share-token">{shareToken || ''}</span>
    </div>
  ),
}));

describe('ShareLinkSingleFileView', () => {
  it('renders single file preview with file name derived from linkInfo', () => {
    const linkInfo = { filePath: '/user/docs/report.pdf', fileName: 'report.pdf', nodeId: 42 };
    const token = 'share-token-123';

    renderWithProviders(<ShareLinkSingleFileView token={token} linkInfo={linkInfo} />);

    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('file-name')).toHaveTextContent('report.pdf');
  });

  it('passes shareToken so preview can use it for download', () => {
    const linkInfo = { filePath: '/a.pdf', fileName: 'a.pdf' };
    const token = 'my-token';

    renderWithProviders(<ShareLinkSingleFileView token={token} linkInfo={linkInfo} />);

    expect(screen.getByTestId('share-token')).toHaveTextContent('my-token');
  });

  it('passes nodeId so preview can fetch the shared blob', () => {
    const linkInfo = { filePath: '/a.pdf', fileName: 'a.pdf', nodeId: 7 };
    const token = 'my-token';

    renderWithProviders(<ShareLinkSingleFileView token={token} linkInfo={linkInfo} />);

    expect(screen.getByTestId('file-node-id')).toHaveTextContent('7');
  });
});
