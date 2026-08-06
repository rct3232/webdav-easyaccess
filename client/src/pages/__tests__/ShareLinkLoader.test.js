/**
 * ShareLinkLoader page tests.
 * Verifies loading, error, directory/file rendering per spec.
 * @see docs/spec/client/pages/ShareLinkLoader.md
 */
import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../setupTests';
import { renderWithProviders } from '../../test-utils';
import ShareLinkLoader from '../ShareLinkLoader';

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

jest.mock('../FileManager', () => function MockFileManager({ shareToken, linkInfo }) {
  return (
    <div data-testid="file-manager" data-share-token={shareToken}>
      FileManager: {linkInfo?.isDirectory ? 'directory' : 'file'}
    </div>
  );
});

jest.mock('../ShareLinkSingleFileView', () => function MockShareLinkSingleFileView({ token, linkInfo }) {
  return (
    <div data-testid="share-link-single-file-view" data-token={token}>
      SingleFile: {linkInfo?.fileName}
    </div>
  );
});

function renderShareLinkLoader(initialEntries = ['/share/valid-token']) {
  return renderWithProviders(
    <Routes>
      <Route path="/share/:token" element={<ShareLinkLoader />} />
    </Routes>,
    { initialEntries }
  );
}

describe('ShareLinkLoader', () => {
  it('shows loading state while fetching', async () => {
    const pendingInfoRequest = createDeferred();
    server.use(
      http.get('/api/share/:token/info', () =>
        pendingInfoRequest.promise.then(() =>
          HttpResponse.json({ token: 't1', filePath: '/a.pdf', fileName: 'a.pdf', isDirectory: false })
        )
      )
    );
    renderShareLinkLoader(['/share/valid-token']);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    act(() => {
      pendingInfoRequest.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('shows error state when fetch fails', async () => {
    server.use(
      http.get('/api/share/:token/info', () => HttpResponse.json({ errorCode: 'serverErrors.share.shareLinkNotFound' }, { status: 404 }))
    );
    renderShareLinkLoader(['/share/invalid']);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Link has expired or file could not be found/)).toBeInTheDocument();
  });

  it('shows error state for invalid token format (API returns 400)', async () => {
    server.use(
      http.get('/api/share/:token/info', () =>
        HttpResponse.json({ errorCode: 'serverErrors.utilsAuth.invalidOrExpiredToken' }, { status: 400 })
      )
    );
    renderShareLinkLoader(['/share/invalid-format']);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Invalid or expired token/)).toBeInTheDocument();
    expect(screen.getByText(/Link has expired or file could not be found/)).toBeInTheDocument();
    expect(screen.queryByTestId('file-manager')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-link-single-file-view')).not.toBeInTheDocument();
  });

  it('shows error state when 403 response is returned', async () => {
    server.use(
      http.get('/api/share/:token/info', () =>
        HttpResponse.json({ errorCode: 'serverErrors.files.accessDenied' }, { status: 403 })
      )
    );
    renderShareLinkLoader(['/share/forbidden-token']);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
    expect(screen.getByText(/Link has expired or file could not be found/)).toBeInTheDocument();
    expect(screen.queryByTestId('file-manager')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-link-single-file-view')).not.toBeInTheDocument();
  });

  it('shows the same error experience when the share link is expired (410)', async () => {
    server.use(
      http.get('/api/share/:token/info', () =>
        HttpResponse.json({ errorCode: 'serverErrors.share.shareLinkExpired' }, { status: 410 })
      )
    );
    renderShareLinkLoader(['/share/expired-token']);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /expired/i })).toBeInTheDocument();
    expect(screen.getByText(/Link has expired or file could not be found/)).toBeInTheDocument();
    expect(screen.queryByTestId('file-manager')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-link-single-file-view')).not.toBeInTheDocument();
  });

  it('renders FileManager for directory link', async () => {
    server.use(
      http.get('/api/share/:token/info', ({ params }) =>
        HttpResponse.json({
          token: params.token,
          filePath: '/shared/folder',
          fileName: 'folder',
          isDirectory: true,
          createdAt: new Date().toISOString(),
          expiresAt: null,
          downloadCount: 0,
          isExpired: false,
        })
      )
    );
    renderShareLinkLoader(['/share/dir-token']);

    await waitFor(() => {
      expect(screen.getByTestId('file-manager')).toBeInTheDocument();
    });
    expect(screen.getByTestId('file-manager')).toHaveAttribute('data-share-token', 'dir-token');
    expect(screen.getByText(/directory/)).toBeInTheDocument();
  });

  it('renders ShareLinkSingleFileView for single file link', async () => {
    server.use(
      http.get('/api/share/:token/info', ({ params }) =>
        HttpResponse.json({
          token: params.token,
          filePath: '/user/doc.pdf',
          fileName: 'doc.pdf',
          isDirectory: false,
          createdAt: new Date().toISOString(),
          expiresAt: null,
          downloadCount: 0,
          isExpired: false,
        })
      )
    );
    renderShareLinkLoader(['/share/file-token']);

    await waitFor(() => {
      expect(screen.getByTestId('share-link-single-file-view')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-link-single-file-view')).toHaveAttribute('data-token', 'file-token');
    expect(screen.getByText(/doc\.pdf/)).toBeInTheDocument();
  });
});
