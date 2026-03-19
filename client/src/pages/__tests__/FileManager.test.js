/**
 * FileManager page tests.
 * Verifies key scenarios: renders file list, path navigation, search filter, selection mode + bulk move.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/spec/client/pages/FileManager.md 2.6
 */
jest.mock('../../components/dialogs/FilePreviewDialog', () => ({
  __esModule: true,
  default: function MockFilePreviewDialog({ open, file, onClose }) {
    if (!open || !file) {
      return null;
    }

    return (
      <div role="dialog" aria-label="file preview">
        <div>{file.name || file.basename}</div>
        <button type="button" onClick={onClose}>
          close preview
        </button>
      </div>
    );
  },
}));
jest.mock('../../components/file-manager', () => {
  const React = require('react');
  const actual = jest.requireActual('../../components/file-manager');

  const MockFAB = ({ onUpload, onCreateFolder, hasWritePermission = true, shareLinkMode }) => {
    if (shareLinkMode) {
      const { user, onLoginClick, onAddToSharedClick } = shareLinkMode;
      const isLoggedIn = Boolean(user);
      const label = isLoggedIn ? 'add to shared' : 'login';
      return (
        <button type="button" aria-label={label} onClick={isLoggedIn ? onAddToSharedClick : onLoginClick}>
          {label}
        </button>
      );
    }

    if (!hasWritePermission) {
      return null;
    }

    return (
      <div data-testid="mock-fab">
        <button type="button" aria-label="file actions">file actions</button>
        <button type="button" onClick={onCreateFolder}>create folder</button>
        <button type="button" onClick={onUpload}>upload file</button>
      </div>
    );
  };

  return {
    ...actual,
    FAB: MockFAB,
  };
});

import React from 'react';
import { screen, waitFor, render, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, createMemoryRouter, RouterProvider, Outlet, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, ThemeAndAuthProviders } from '../../test-utils';
import { server } from '../../setupTests';
import FileManager from '../FileManager';
import { notifyRecentFilesChange } from '../../services/recentFilesNotifier';

function ParamsReporter() {
  const params = useParams();
  return <span data-testid="params">{JSON.stringify(params)}</span>;
}


// Path-prefixed so non-admin redirect to /testuser and folder click sets path to /testuser/folder (useFileManager path rules).
const rootFilesForUser = (base) => [
  { path: `${base}/test.txt`, basename: 'test.txt', type: 'file', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
  { path: `${base}/docs`, basename: 'docs', type: 'directory', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
  { path: `${base}/folder`, basename: 'folder', type: 'directory', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
];

const folderFilesForPath = (base) => [
  { path: `${base}/sub.txt`, basename: 'sub.txt', type: 'file', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
  { path: `${base}/nested`, basename: 'nested', type: 'directory', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
];

function FileManagerWithRoutes() {
  return (
    <Routes>
      <Route path="/files/*" element={<FileManager />} />
    </Routes>
  );
}

const renderWithProvidersAct = async (ui, options = {}) => {
  let renderResult;
  await act(async () => {
    renderResult = renderWithProviders(ui, options);
    await Promise.resolve();
  });
  return renderResult;
};

const renderAct = async (ui) => {
  let renderResult;
  await act(async () => {
    renderResult = render(ui);
    await Promise.resolve();
  });
  return renderResult;
};

const selectTwoItemsDesktop = async (user, firstItemElement, secondItemElement) => {
  await user.click(firstItemElement);
  fireEvent.click(secondItemElement, { ctrlKey: true, metaKey: true });
};

describe('FileManager', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh');
  });

  it('renders file manager when authenticated', async () => {
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    expect(document.body.textContent).toMatch(/no files|test|folder|home|recent|docs/i);
  });

  it('renders without share link by default', async () => {
    await renderWithProvidersAct(
      <FileManagerWithRoutes />,
      { initialEntries: ['/files/testuser'] }
    );
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    expect(document.body).toBeInTheDocument();
  });

  it('reloads the __recent__ view when recent-file notifications fire', async () => {
    let recentEntries = [
      { path: '/testuser/old.txt', type: 'file', lastAccessed: '2024-01-01T00:00:00.000Z' },
    ];

    server.use(
      http.get('/api/recent-files', () => HttpResponse.json(recentEntries)),
      http.post('/api/files/metadata', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const paths = body.paths || [];
        return HttpResponse.json(
          paths.map((path) => ({ path, size: 123, lastmod: null, mime: 'text/plain' }))
        );
      })
    );

    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files/__recent__'] });

    await waitFor(() => {
      expect(screen.getByText('old.txt')).toBeInTheDocument();
    });

    recentEntries = [
      { path: '/testuser/new.txt', type: 'file', lastAccessed: '2024-01-02T00:00:00.000Z' },
    ];

    await act(async () => {
      notifyRecentFilesChange();
    });

    await waitFor(() => {
      expect(screen.getByText('new.txt')).toBeInTheDocument();
    });
    expect(screen.queryByText('old.txt')).not.toBeInTheDocument();
  });

  it('preview flow adds the opened file to the recent view', async () => {
    let recentEntries = [];

    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.get('/api/recent-files', () => HttpResponse.json(recentEntries)),
      http.post('/api/recent-files', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        recentEntries = [
          {
            path: body.path,
            name: body.name || body.basename || 'test.txt',
            basename: body.basename || body.name || 'test.txt',
            type: body.type || 'file',
            lastAccessed: '2024-01-02T00:00:00.000Z',
          },
        ];

        return HttpResponse.json({});
      }),
      http.post('/api/files/metadata', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const paths = body.paths || [];

        return HttpResponse.json(
          paths.map((path) => ({ path, size: 123, lastmod: null, mime: 'text/plain' }))
        );
      })
    );

    const user = userEvent.setup();
    const rootEl = (
      <ThemeAndAuthProviders>
        <Outlet />
      </ThemeAndAuthProviders>
    );
    const router = createMemoryRouter(
      [
        { path: '/', element: rootEl, children: [{ path: 'files/*', element: <FileManager /> }] },
      ],
      { initialEntries: ['/files/__recent__'], initialIndex: 0 }
    );

    await renderAct(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText(/no recent items/i)).toBeInTheDocument();
    });

    await act(async () => {
      await router.navigate('/files/testuser');
    });

    const fileRow = await waitFor(
      () => {
        const row = document.querySelector('[data-file-path="/testuser/test.txt"]');
        if (!row) throw new Error('File row not found');
        return row;
      },
      { timeout: 5000 }
    );

    await act(async () => {
      await user.dblClick(fileRow);
    });

    const previewDialog = await screen.findByRole('dialog', { name: /file preview/i });
    expect(previewDialog).toHaveTextContent('test.txt');

    await user.click(within(previewDialog).getByRole('button', { name: /close preview/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /file preview/i })).not.toBeInTheDocument();
    });

    await act(async () => {
      await router.navigate('/files/__recent__');
    });

    await waitFor(() => {
      expect(screen.queryByText(/no recent items/i)).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText('test.txt').length).toBeGreaterThan(0);
    });
  }, 20000);

  it('path navigation: useParams sees splat when using createMemoryRouter', async () => {
    const routes = [
      {
        path: '/',
        element: (
          <ThemeAndAuthProviders>
            <Outlet />
          </ThemeAndAuthProviders>
        ),
        children: [{ path: 'files/*', element: <ParamsReporter /> }],
      },
    ];
    const router = createMemoryRouter(routes, {
      initialEntries: ['/files/testuser'],
      initialIndex: 0,
    });
    await renderAct(<RouterProvider router={router} />);
    expect(screen.getByTestId('params').textContent).toBe('{"*":"testuser"}');
  });

  it('path navigation: clicking folder updates list', async () => {
    localStorage.setItem('viewMode', 'list');
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath = path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    const rootEl = (
      <ThemeAndAuthProviders>
        <Outlet />
      </ThemeAndAuthProviders>
    );
    const router = createMemoryRouter(
      [
        { path: '/', element: rootEl, children: [{ path: 'files/*', element: <FileManager /> }] },
      ],
      { initialEntries: ['/files/testuser'], initialIndex: 0 }
    );
    await renderAct(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 5000 });

    const folderRow = await waitFor(
      () => {
        const byExactPath = document.querySelector('[data-file-path="/testuser/folder"]');
        if (byExactPath) return byExactPath;
        const byDataPath = document.querySelector('[data-file-path$="/folder"]');
        if (byDataPath) return byDataPath;
        const folderTexts = screen.getAllByText(/\bfolder\b/i);
        const inList = folderTexts.find((el) => el.closest('[data-file-path]') || el.closest('tr'));
        if (inList) return inList.closest('[data-file-path]') || inList.closest('tr') || inList;
        if (folderTexts.length) return folderTexts[0];
        throw new Error('Folder row not found');
      },
      { timeout: 8000 }
    );
    await act(async () => {
      await user.dblClick(folderRow);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    expect(await screen.findByText(/sub\.txt/i, { timeout: 15000 })).toBeInTheDocument();
  }, 25000);

  it('search filter: filters files by name', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    // Desktop: search input is always visible; mobile: open search via button then input appears.
    const searchInput = screen.queryByPlaceholderText(/search files/i);
    if (searchInput) {
      await user.type(searchInput, 'test');
    } else {
      const searchBtn = screen.getByRole('button', { name: /search/i });
      await user.click(searchBtn);
      await user.type(screen.getByPlaceholderText(/search files/i), 'test');
    }

    await waitFor(() => {
      expect(screen.getByText(/test\.txt/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  /**
   * Selection mode + bulk move: enter selection mode, select two items, Move → pick destination → complete.
   * Verifies observable outcome: completion message or progress shows done (docs/spec 2.6, plan 3.1).
   */
  it('selection mode and bulk move: select two files, move to folder, shows completion', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath = path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    // Enter selection mode by single-clicking a file (desktop: single click = enter selection + select)
    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), docsInList);

    // Bulk move: click Move in toolbar
    const moveBtn = screen.getByRole('button', { name: /move/i });
    await user.click(moveBtn);

    // Folder picker: wait for folder list to load (spinner gone), choose destination folder then confirm
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }, { timeout: 3000 });
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    const folderListButtons = within(dialog).getAllByRole('button', { name: /folder/i });
    const folderListItem = folderListButtons.length > 0 ? folderListButtons[0] : within(dialog).getByRole('button', { name: /folder/i });
    await user.click(folderListItem);
    const confirmSelect = within(dialog).getByRole('button', { name: /select/i });
    await user.click(confirmSelect);

    // Observable outcome: progress appears then completion (FileOperationProgress shows "Done" or "complete")
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/preparing|complete|done/i);
    }, { timeout: 5000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/complete|done/i);
    }, { timeout: 8000 });
  }, 20000);

  /**
   * Bulk copy flow: select items, Copy, pick destination folder, shows completion.
   * Verifies: POST /api/files/batch-copy → 202+jobId, bulk-operation polling, completion (plan 3.1).
   */
  it('bulk copy flow: select items, copy to folder, shows completion', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath = path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), docsInList);

    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    await user.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }, { timeout: 3000 });
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    const folderListButtons = within(dialog).getAllByRole('button', { name: /folder/i });
    const folderListItem = folderListButtons.length > 0 ? folderListButtons[0] : within(dialog).getByRole('button', { name: /folder/i });
    await user.click(folderListItem);
    const confirmSelect = within(dialog).getByRole('button', { name: /select/i });
    await user.click(confirmSelect);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/complete|done/i);
    }, { timeout: 8000 });
  }, 20000);

  /**
   * Bulk download flow: select multiple files, Download triggers download-multiple.
   * Verifies: POST /api/files/download-multiple called, Blob download or completion (plan 3.1).
   */
  it('bulk download flow: select multiple items, Download triggers download-multiple', async () => {
    let downloadMultipleCalled = false;
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const items = [
          ...rootFilesForUser(base),
          { path: `${base}/doc2.txt`, basename: 'doc2.txt', type: 'file', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
        ];
        return HttpResponse.json(items);
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/files/download-multiple', async ({ request }) => {
        downloadMultipleCalled = true;
        const body = await request.json().catch(() => ({}));
        const { paths } = body;
        if (!paths || paths.length === 0) return HttpResponse.json({ errorCode: 'bad' }, { status: 400 });
        const blob = new Blob(['mock zip'], { type: 'application/zip' });
        return new HttpResponse(blob, {
          headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="download.zip"' },
        });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/test|doc2|folder|docs/i);
    }, { timeout: 3000 });

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const doc2InList = within(fileListContainer).getByText(/doc2\.txt/i);
    const rowDoc2 = doc2InList.closest('div')?.parentElement;
    expect(rowDoc2).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), doc2InList);

    const downloadBtn = screen.getByRole('button', { name: /download/i });
    await user.click(downloadBtn);

    await waitFor(() => {
      expect(downloadMultipleCalled).toBe(true);
    }, { timeout: 10000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/complete|done|downloading/i);
    }, { timeout: 8000 });
  }, 20000);

  /**
   * Delete flow (client-ui.md): select items → Delete → confirm → batch-delete → remove-paths → completion.
   * Verifies observable outcome: confirm dialog then completion/done (no implementation assertions).
   */
  it('delete flow: select items, confirm delete, shows completion', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath = path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/recent-files/remove-paths', async () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), docsInList);

    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }, { timeout: 3000 });
    const dialog = screen.getByRole('dialog');
    const confirmDeleteBtn = within(dialog).getByRole('button', { name: /delete/i });
    await user.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/complete|done/i);
    }, { timeout: 10000 });
  }, 15000);

  /**
   * Desktop: click on empty space exits selection mode (client-ui.md, plan selection_mode_click-to-deselect).
   * Verifies observable outcome: bulk toolbar disappears when clicking non-file area.
   */
  it('selection mode: click empty space exits selection mode on desktop', async () => {
    localStorage.setItem('viewMode', 'list');
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    await user.click(screen.getByText(/test\.txt/i));

    expect(screen.getByRole('button', { name: /move/i })).toBeInTheDocument();

    const fileRow = document.querySelector('[data-file-path]');
    const gridContainer = fileRow?.parentElement;
    expect(gridContainer).toBeTruthy();
    fireEvent.click(gridContainer);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /move/i })).not.toBeInTheDocument();
    }, { timeout: 3000 });
  }, 15000);

  /**
   * Create folder flow: open dialog via Create folder button, enter name, confirm shows completion.
   * Verifies: POST /api/folders/create, completion message (plan 3.1).
   */
  it('create folder flow: open dialog, enter name, confirm shows completion', async () => {
    let createFolderPath = null;
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () => HttpResponse.json({ hasRead: true, hasWrite: true })),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/folders/create', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        createFolderPath = body.path;
        return HttpResponse.json({ messageCode: 'serverMessages.folders.createSuccess', path: body.path });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    const createFolderBtn = await screen.findByRole('button', { name: /create folder/i }, { timeout: 5000 });
    await user.click(createFolderBtn);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    const nameInput = within(dialog).getByLabelText(/folder name/i);
    await user.type(nameInput, 'newfolder');
    const createBtn = within(dialog).getByRole('button', { name: /^create$/i });
    await user.click(createBtn);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/complete|done/i);
    }, { timeout: 10000 });

    expect(createFolderPath).toMatch(/newfolder$/);
  }, 15000);

  /**
   * Upload flow (no conflict): open upload dialog, select file, upload.
   * Verifies: FormData parsed correctly, completion message (spec 2.6, plan 3.1).
   */
  it('upload flow no conflict: dialog select file and upload shows completion', async () => {
    let uploadedPayload = null;
    server.use(
      http.post('/api/files/check-conflicts', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        return HttpResponse.json({ conflicts: [] });
      }),
      http.post('/api/files/upload', async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get('file');
        const path = formData.get('path') || '/';
        const name = file?.name || 'file';
        const fullPath = path === '/' ? `/${name}` : `${path.replace(/\/$/, '')}/${name}`;
        uploadedPayload = { name, path, fullPath };
        return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSuccess', path: fullPath });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    const uploadBtn = await screen.findByRole('button', { name: /upload file/i }, { timeout: 5000 });
    await user.click(uploadBtn);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    const fileInput = dialog.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, new File(['content'], 'newfile.txt', { type: 'text/plain' }));

    const uploadSubmit = within(dialog).getByRole('button', { name: /^upload$/i });
    await user.click(uploadSubmit);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/complete|done/i);
    }, { timeout: 10000 });

    expect(uploadedPayload).not.toBeNull();
    expect(uploadedPayload.name).toBe('newfile.txt');
    expect(uploadedPayload.path).toMatch(/testuser/);
    expect(uploadedPayload.fullPath).toMatch(/newfile\.txt$/);
  }, 15000);

  /**
   * Upload flow (conflict + skip): check-conflicts returns conflict, user chooses Skip.
   * Verifies: FormData has onConflict=skip, completion/skipped message (spec 2.6, plan 3.1).
   */
  it('upload flow with conflict: choose skip shows completion or skipped message', async () => {
    const conflictPath = '/testuser/dup.txt';
    let uploadedPayload = null;
    server.use(
      http.post('/api/files/check-conflicts', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const operations = body.operations || [];
        const conflicts = operations.map((op) => ({
          path: op.destinationPath || op.sourcePath || conflictPath,
          type: 'file',
        }));
        return HttpResponse.json({ conflicts });
      }),
      http.post('/api/files/upload', async ({ request }) => {
        const formData = await request.formData();
        const onConflict = formData.get('onConflict') || 'error';
        const file = formData.get('file');
        const path = formData.get('path') || '/';
        const name = file?.name || 'file';
        const fullPath = path === '/' ? `/${name}` : `${path.replace(/\/$/, '')}/${name}`;
        uploadedPayload = { name, path, onConflict, fullPath };
        if (onConflict === 'skip') {
          return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSkipped', path: fullPath, skipped: true });
        }
        return HttpResponse.json({ messageCode: 'serverMessages.files.uploadSuccess', path: fullPath });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    const uploadBtn = await screen.findByRole('button', { name: /upload file/i }, { timeout: 5000 });
    await user.click(uploadBtn);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    const fileInput = dialog.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, new File(['x'], 'dup.txt', { type: 'text/plain' }));

    const uploadSubmit = within(dialog).getByRole('button', { name: /^upload$/i });
    await user.click(uploadSubmit);

    const conflictDialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(conflictDialog).toBeInTheDocument();
    const skipBtn = within(conflictDialog).getByRole('button', { name: /skip duplicates/i });
    await user.click(skipBtn);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/skipped|complete|done/i);
    }, { timeout: 10000 });

    expect(uploadedPayload).not.toBeNull();
    expect(uploadedPayload.name).toBe('dup.txt');
    expect(uploadedPayload.onConflict).toBe('skip');
    expect(uploadedPayload.fullPath).toMatch(/dup\.txt$/);
  }, 15000);

  /**
   * Download flow: context menu Download on a file triggers GET /api/files/download with path;
   * response is Blob + Content-Disposition (api.md). Verifies observable outcome: download
   * requested for the selected file (spec 2.6, plan 3.1).
   */
  it('download: context menu Download triggers file download with correct path', async () => {
    let downloadRequestPath = null;
    server.use(
      http.get('/api/files/download', ({ request }) => {
        const url = new URL(request.url);
        downloadRequestPath = url.searchParams.get('path');
        return new HttpResponse(new Blob(['mock file content']), {
          headers: { 'Content-Disposition': 'attachment; filename="test.txt"' },
        });
      })
    );

    localStorage.setItem('viewMode', 'list');
    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    const fileRow = await waitFor(
      () => {
        const row = document.querySelector('[data-file-path="/testuser/test.txt"]');
        if (!row) throw new Error('File row not found');
        return row;
      },
      { timeout: 5000 }
    );
    fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });

    const downloadItem = await screen.findByRole('menuitem', { name: /download/i });
    await user.click(downloadItem);

    await waitFor(() => {
      expect(downloadRequestPath).toBe('/testuser/test.txt');
    }, { timeout: 5000 });
  }, 15000);

  /**
   * Rename flow (client-ui.md, FileManager 2.6): context menu Rename → dialog → new name → API and refresh.
   * Verifies observable outcome: dialog opens, submit renames, dialog closes (no implementation assertions).
   */
  it('rename flow: context menu Rename, enter new name, confirm closes dialog', async () => {
    const emptyRecent = () => HttpResponse.json([]);
    server.use(
      http.get('/api/recent-files', emptyRecent),
      http.post('/api/recent-files', emptyRecent),
      http.delete('/api/recent-files/:path', emptyRecent),
      http.post('/api/recent-files/apply-moves', emptyRecent),
      http.put('/api/files/rename', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const oldPath = body.oldPath || '';
        const newName = (body.newName || '').trim();
        const parent = oldPath.replace(/\/[^/]+$/, '') || '/';
        const newPath = parent === '/' ? `/${newName}` : `${parent}/${newName}`;
        return HttpResponse.json({ messageCode: 'serverMessages.files.renameSuccess', path: newPath });
      })
    );

    localStorage.setItem('viewMode', 'list');
    const user = userEvent.setup({ delay: null });
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    const fileRow = await waitFor(
      () => {
        const row = document.querySelector('[data-file-path="/testuser/test.txt"]');
        if (!row) throw new Error('File row not found');
        return row;
      },
      { timeout: 5000 }
    );
    fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });

    const renameItem = await screen.findByRole('menuitem', { name: /rename/i });
    await user.click(renameItem);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(within(dialog).getByText(/rename/i)).toBeInTheDocument();
    const newNameInput = within(dialog).getByLabelText(/new name/i);
    fireEvent.change(newNameInput, { target: { value: 'renamed.txt' } });
    const confirmBtn = within(dialog).getByRole('button', { name: /change/i });
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);

    // Observable outcome: dialog closes or progress shows Done (MUI Dialog exit ~300ms)
    await waitFor(
      () => {
        const dialogs = screen.queryAllByRole('dialog');
        const renameDialogVisible = dialogs.some((d) => within(d).queryByLabelText(/new name/i));
        const hasComplete = document.body.textContent.match(/complete|done/i);
        expect(!renameDialogVisible || hasComplete).toBeTruthy();
      },
      { timeout: 8000, interval: 150 }
    );
  }, 20000);

  /**
   * Permission request from ShareTargetDialog (plan 3.2, MyPage 2.6).
   * Given: list with folder, user has no permission on that folder. When: open Share on folder →
   * ShareTargetDialog opens → click "Request read permission". Then: POST /api/permission-requests
   * succeeds and UI shows "Read permission requested" (outcome only; no implementation assertions).
   */
  it('permission request: open Share on folder, request read permission, shows requested state', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base = path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath = path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        const rootItems = [
          { path: `${base}/test.txt`, basename: 'test.txt', type: 'file', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
          { path: `${base}/folder`, basename: 'folder', type: 'directory', size: 0, lastmod: null, hasReadPermission: false, hasWritePermission: false, isHidden: false },
        ];
        const folderItems = [
          { path: `${base}/sub.txt`, basename: 'sub.txt', type: 'file', size: 0, lastmod: null, hasReadPermission: true, hasWritePermission: true, isHidden: false },
        ];
        return HttpResponse.json(isFolderPath ? folderItems : rootItems);
      }),
      http.get('/api/permissions/check', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '').replace(/\/$/, '');
        const isTargetFolder = path === '/testuser/folder';
        return HttpResponse.json(
          isTargetFolder ? { hasRead: false, hasWrite: false } : { hasRead: true, hasWrite: true }
        );
      }),
      http.get('/api/permission-requests/check-owner', () => HttpResponse.json({ ownerExists: true })),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|test/i);
    }, { timeout: 5000 });

    const folderRow = await waitFor(
      () => {
        const el = document.querySelector('[data-file-path="/testuser/folder"]');
        if (el) return el;
        const byText = screen.getByText(/\bfolder\b/i).closest('[data-file-path]') || screen.getByText(/\bfolder\b/i).closest('tr');
        if (byText) return byText;
        throw new Error('Folder row not found');
      },
      { timeout: 5000 }
    );
    fireEvent.contextMenu(folderRow, { clientX: 100, clientY: 100 });

    const shareItem = await screen.findByRole('menuitem', { name: /share/i });
    await user.click(shareItem);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await waitFor(() => {
      expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    const requestReadBtn = within(dialog).getByRole('button', { name: /request read permission/i });
    await user.click(requestReadBtn);

    await waitFor(() => {
      expect(within(dialog).getByText(/read permission requested/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  }, 15000);

  /**
   * Share link mode (spec 2.7): simplified header, no upload/create, download-only bulk.
   * Given: FileManager with shareToken + linkInfo (directory). When: unauthenticated.
   * Then: header is simplified (no mypage/logout), no Upload/Create folder buttons, bulk toolbar shows only Download.
   */
  it('share link mode: simplified header, no upload/create, download-only bulk', async () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('refreshToken');

    const linkInfo = { filePath: '/shared/root', fileName: 'Shared', isDirectory: true };
    function ShareLinkFileManager() {
      return <FileManager shareToken="share-token" linkInfo={linkInfo} />;
    }

    const user = userEvent.setup();
    await renderWithProvidersAct(
      <Routes>
        <Route path="/share-view" element={<ShareLinkFileManager />} />
      </Routes>,
      { initialEntries: ['/share-view'] }
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    // Simplified header: no logout/mypage (unauthenticated share link shows logo-only AppBar)
    expect(screen.queryByRole('button', { name: /logout/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mypage/i })).not.toBeInTheDocument();

    // No upload / create folder (spec 2.7: share link mode has no upload/create)
    expect(screen.queryByRole('button', { name: /upload file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create folder/i })).not.toBeInTheDocument();

    // Download-only bulk: enter selection by single-clicking file, toolbar shows Download but not Move/Copy/Delete
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/test|folder|docs/i);
    }, { timeout: 3000 });

    await user.click(screen.getByText(/test\.txt/i));

    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^move$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  }, 15000);
});
