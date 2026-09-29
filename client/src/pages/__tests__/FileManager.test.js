/**
 * FileManager page tests.
 * Verifies key scenarios: renders file list, path navigation, search filter, selection mode + bulk move.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/spec/client/pages/FileManager.md 2.6
 */
import React from 'react';
import { screen, waitFor, render, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Routes,
  Route,
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useParams,
} from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, ThemeAndAuthProviders } from '../../test-utils';
import { server } from '../../setupTests';
import FileManager from '../FileManager';
import { notifyRecentFilesChange } from '../../services/recentFilesNotifier';

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
        <button
          type="button"
          aria-label={label}
          onClick={isLoggedIn ? onAddToSharedClick : onLoginClick}
        >
          {label}
        </button>
      );
    }

    if (!hasWritePermission) {
      return null;
    }

    return (
      <div data-testid="mock-fab">
        <button type="button" aria-label="file actions">
          file actions
        </button>
        <button type="button" onClick={onCreateFolder}>
          create folder
        </button>
        <button type="button" onClick={onUpload}>
          upload file
        </button>
      </div>
    );
  };

  return {
    ...actual,
    FAB: MockFAB,
  };
});
jest.mock('../../components/folder-tree', () => {
  const React = require('react');

  function MockFolderTree() {
    return <div data-testid="mock-folder-tree" />;
  }

  return {
    __esModule: true,
    FolderTree: MockFolderTree,
    default: MockFolderTree,
  };
});
jest.mock('../FileManager/hooks/useExplorerNavigation', () => ({
  __esModule: true,
  useExplorerNavigation: ({
    getPreviousNodeId,
    setCurrentNodeId,
    onAfterNavigate,
    onTrackNodeHistory,
  } = {}) => {
    const navigateToNode = async (nextNodeId) => {
      if (nextNodeId == null) return;

      const previousNodeId = typeof getPreviousNodeId === 'function' ? getPreviousNodeId() : null;

      if (previousNodeId != null && previousNodeId === nextNodeId) return;

      if (typeof onTrackNodeHistory === 'function' && previousNodeId != null) {
        onTrackNodeHistory(nextNodeId, previousNodeId);
      }

      setCurrentNodeId(nextNodeId);
      if (typeof onAfterNavigate === 'function') {
        onAfterNavigate(nextNodeId);
      }
    };

    return {
      navigateToNode,
      handleFolderOpen: navigateToNode,
      isNavigating: false,
    };
  },
}));

function ParamsReporter() {
  const params = useParams();
  return <span data-testid="params">{JSON.stringify(params)}</span>;
}

// Path-prefixed so non-admin redirect to /testuser and folder click sets path to /testuser/folder (useFileManager path rules).
const rootFilesForUser = (base) => [
  {
    nodeId: 1,
    path: `${base}/test.txt`,
    basename: 'test.txt',
    type: 'file',
    size: 0,
    lastmod: null,
    hasReadPermission: true,
    hasWritePermission: true,
    isHidden: false,
  },
  {
    nodeId: 2,
    path: `${base}/docs`,
    basename: 'docs',
    type: 'directory',
    size: 0,
    lastmod: null,
    hasReadPermission: true,
    hasWritePermission: true,
    isHidden: false,
  },
  {
    nodeId: 3,
    path: `${base}/folder`,
    basename: 'folder',
    type: 'directory',
    size: 0,
    lastmod: null,
    hasReadPermission: true,
    hasWritePermission: true,
    isHidden: false,
  },
];

const folderFilesForPath = (base) => [
  {
    nodeId: 4,
    path: `${base}/sub.txt`,
    basename: 'sub.txt',
    type: 'file',
    size: 0,
    lastmod: null,
    hasReadPermission: true,
    hasWritePermission: true,
    isHidden: false,
  },
  {
    nodeId: 5,
    path: `${base}/nested`,
    basename: 'nested',
    type: 'directory',
    size: 0,
    lastmod: null,
    hasReadPermission: true,
    hasWritePermission: true,
    isHidden: false,
  },
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
    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(document.body.textContent).toMatch(/no files|test|folder|home|recent|docs/i);
  });

  it('renders without share link by default', async () => {
    await renderWithProvidersAct(<FileManagerWithRoutes />, {
      initialEntries: ['/files/testuser'],
    });
    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
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
        const nodeIds = body.nodeIds || [];
        return HttpResponse.json(
          nodeIds.map((nodeId) => ({ nodeId, size: 123, lastmod: null, mime: 'text/plain' }))
        );
      })
    );

    await renderWithProvidersAct(<FileManagerWithRoutes />, {
      initialEntries: ['/files/__recent__'],
    });

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
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
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
        const nodeIds = body.nodeIds || [];

        return HttpResponse.json(
          nodeIds.map((nodeId) => ({ nodeId, size: 123, lastmod: null, mime: 'text/plain' }))
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
      [{ path: '/', element: rootEl, children: [{ path: 'files/*', element: <FileManager /> }] }],
      {
        initialEntries: ['/files/__recent__'],
        initialIndex: 0,
        future: {
          v7_relativeSplatPath: true,
        },
      }
    );

    await renderAct(
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />
    );

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/no recent items|no files/i);
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
      future: {
        v7_relativeSplatPath: true,
      },
    });
    await renderAct(
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />
    );
    expect(screen.getByTestId('params').textContent).toBe('{"*":"testuser"}');
  });

  it('path navigation: clicking folder updates list', async () => {
    localStorage.setItem('viewMode', 'list');
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const nodeId = url.searchParams.get('nodeId');
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath =
          nodeId === '3' ||
          path.endsWith('/folder') ||
          path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    const rootEl = (
      <ThemeAndAuthProviders>
        <Outlet />
      </ThemeAndAuthProviders>
    );
    const router = createMemoryRouter(
      [{ path: '/', element: rootEl, children: [{ path: 'files/*', element: <FileManager /> }] }],
      {
        initialEntries: ['/files/testuser'],
        initialIndex: 0,
        future: {
          v7_relativeSplatPath: true,
        },
      }
    );
    await renderAct(
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />
    );

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|docs|test/i);
      },
      { timeout: 5000 }
    );

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
    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(await screen.findByText(/sub\.txt/i, { timeout: 15000 })).toBeInTheDocument();
  }, 25000);

  it('search filter: filters files by name', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|docs|test/i);
      },
      { timeout: 3000 }
    );

    // Desktop: search input is always visible; mobile: open search via button then input appears.
    const searchInput = screen.queryByPlaceholderText(/search files/i);
    if (searchInput) {
      await user.type(searchInput, 'test');
    } else {
      const searchBtn = screen.getByRole('button', { name: /search/i });
      await user.click(searchBtn);
      await user.type(screen.getByPlaceholderText(/search files/i), 'test');
    }

    await waitFor(
      () => {
        expect(screen.getByText(/test\.txt/)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
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
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath =
          path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|docs|test/i);
      },
      { timeout: 3000 }
    );

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
    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(
      () => {
        expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    const folderListButtons = within(dialog).getAllByRole('button', { name: /folder/i });
    const folderListItem =
      folderListButtons.length > 0
        ? folderListButtons[0]
        : within(dialog).getByRole('button', { name: /folder/i });
    await user.click(folderListItem);
    const confirmSelect = within(dialog).getByRole('button', { name: /select/i });
    await user.click(confirmSelect);

    // Observable outcome: progress appears then completion (FileOperationProgress shows "Done" or "complete")
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/preparing|complete|done/i);
      },
      { timeout: 5000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/complete|done/i);
      },
      { timeout: 8000 }
    );
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
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath =
          path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|docs|test/i);
      },
      { timeout: 3000 }
    );

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), docsInList);

    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    await user.click(copyBtn);

    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(
      () => {
        expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    const folderListButtons = within(dialog).getAllByRole('button', { name: /folder/i });
    const folderListItem =
      folderListButtons.length > 0
        ? folderListButtons[0]
        : within(dialog).getByRole('button', { name: /folder/i });
    await user.click(folderListItem);
    const confirmSelect = within(dialog).getByRole('button', { name: /select/i });
    await user.click(confirmSelect);

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/complete|done/i);
      },
      { timeout: 8000 }
    );
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
        const nodeId = url.searchParams.get('nodeId');
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base =
          (path === '' || path === '/') && !nodeId
            ? '/testuser'
            : path.startsWith('/')
              ? path
              : `/${path}`;
        const items = [
          ...rootFilesForUser(base),
          {
            nodeId: 9,
            path: `${base}/doc2.txt`,
            basename: 'doc2.txt',
            type: 'file',
            size: 0,
            lastmod: null,
            hasReadPermission: true,
            hasWritePermission: true,
            isHidden: false,
          },
        ];
        return HttpResponse.json(items);
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/files/download-multiple', async ({ request }) => {
        downloadMultipleCalled = true;
        const body = await request.json().catch(() => ({}));
        const nodeIds = body.nodeIds || [];
        if (!nodeIds || nodeIds.length === 0)
          return HttpResponse.json({ errorCode: 'bad' }, { status: 400 });
        const blob = new Blob(['mock zip'], { type: 'application/zip' });
        return new HttpResponse(blob, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="download.zip"',
          },
        });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/test|doc2|folder|docs/i);
      },
      { timeout: 3000 }
    );

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const doc2InList = within(fileListContainer).getByText(/doc2\.txt/i);
    const rowDoc2 = doc2InList.closest('div')?.parentElement;
    expect(rowDoc2).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), doc2InList);

    const downloadBtn = screen.getByRole('button', { name: /download/i });
    await user.click(downloadBtn);

    await waitFor(
      () => {
        expect(downloadMultipleCalled).toBe(true);
      },
      { timeout: 10000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/complete|done|downloading/i);
      },
      { timeout: 8000 }
    );
  }, 20000);

  /**
   * Delete flow (client-ui.md): select items → Delete → confirm → batch-delete → completion.
   * Verifies observable outcome: confirm dialog then completion/done (no implementation assertions).
   */
  it('delete flow: select items, confirm delete, shows completion', async () => {
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        const isFolderPath =
          path.endsWith('/folder') || path.split('/').filter(Boolean).pop() === 'folder';
        return HttpResponse.json(isFolderPath ? folderFilesForPath(base) : rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.delete('/api/recent-files/:fileNodeId', async () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|docs|test/i);
      },
      { timeout: 3000 }
    );

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await selectTwoItemsDesktop(user, screen.getByText(/test\.txt/i), docsInList);

    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    const dialog = screen.getByRole('dialog');
    const confirmDeleteBtn = within(dialog).getByRole('button', { name: /delete/i });
    await user.click(confirmDeleteBtn);

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/complete|done/i);
      },
      { timeout: 10000 }
    );
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
        const base =
          path === '' || path === '/' ? '/testuser' : path.startsWith('/') ? path : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|docs|test/i);
      },
      { timeout: 3000 }
    );

    await user.click(screen.getByText(/test\.txt/i));

    expect(screen.getByRole('button', { name: /move/i })).toBeInTheDocument();

    const fileRow = document.querySelector('[data-file-path]');
    const gridContainer = fileRow?.parentElement;
    expect(gridContainer).toBeTruthy();
    fireEvent.click(gridContainer);

    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: /move/i })).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  }, 15000);

  /**
   * Create folder flow: open dialog via Create folder button, enter name, confirm shows completion.
   * Verifies: POST /api/folders/create, completion message (plan 3.1).
   */
  it('create folder flow: open dialog, enter name, confirm shows completion', async () => {
    let createFolderName = null;
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const nodeId = url.searchParams.get('nodeId');
        const base =
          (path === '' || path === '/') && !nodeId
            ? '/testuser'
            : path.startsWith('/')
              ? path
              : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/folders/create', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        createFolderName = body.name;
        return HttpResponse.json({
          messageCode: 'serverMessages.folders.createSuccess',
          parentNodeId: body.parentNodeId,
          basename: body.name,
        });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );

    const createFolderBtn = await screen.findByRole(
      'button',
      { name: /create folder/i },
      { timeout: 5000 }
    );
    await user.click(createFolderBtn);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    const nameInput = within(dialog).getByLabelText(/folder name/i);
    await user.type(nameInput, 'newfolder');
    const createBtn = within(dialog).getByRole('button', { name: /^create$/i });
    await user.click(createBtn);

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/complete|done/i);
      },
      { timeout: 10000 }
    );

    expect(createFolderName).toBe('newfolder');
  }, 15000);

  /**
   * Upload flow (no conflict): open upload dialog, select file, upload.
   * Verifies: FormData parsed correctly, completion message (spec 2.6, plan 3.1).
   */
  it('upload flow no conflict: dialog select file and upload shows completion', async () => {
    let uploadedPayload = null;
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const nodeId = url.searchParams.get('nodeId');
        const base =
          (path === '' || path === '/') && !nodeId
            ? '/testuser'
            : path.startsWith('/')
              ? path
              : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/files/check-conflicts', async ({ request }) => {
        await request.json().catch(() => ({}));
        return HttpResponse.json({ conflicts: [] });
      }),
      http.post('/api/files/upload', async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get('file');
        const parentNodeId = formData.get('parentNodeId') || '1';
        const name = file?.name || 'file';
        uploadedPayload = { name, parentNodeId };
        return HttpResponse.json({
          messageCode: 'serverMessages.files.uploadSuccess',
          nodeId: Date.now(),
          parentNodeId,
          basename: name,
        });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, {
      initialEntries: ['/files/testuser'],
    });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );

    const uploadBtn = await screen.findByRole(
      'button',
      { name: /upload file/i },
      { timeout: 5000 }
    );
    await user.click(uploadBtn);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    const fileInput = dialog.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, new File(['content'], 'newfile.txt', { type: 'text/plain' }));

    const uploadSubmit = within(dialog).getByRole('button', { name: /^upload$/i });
    await user.click(uploadSubmit);

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/complete|done/i);
      },
      { timeout: 10000 }
    );

    expect(uploadedPayload).not.toBeNull();
    expect(uploadedPayload.name).toBe('newfile.txt');
    expect(uploadedPayload.parentNodeId).toBeTruthy();
  }, 15000);

  /**
   * Upload flow (conflict + skip): check-conflicts returns conflict, user chooses Skip.
   * Verifies: FormData has onConflict=skip, completion/skipped message (spec 2.6, plan 3.1).
   */
  it('upload flow with conflict: choose skip shows completion or skipped message', async () => {
    const conflictPath = '/testuser/dup.txt';
    let uploadedPayload = null;
    server.use(
      http.get('/api/files/list', ({ request }) => {
        const url = new URL(request.url);
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const nodeId = url.searchParams.get('nodeId');
        const base =
          (path === '' || path === '/') && !nodeId
            ? '/testuser'
            : path.startsWith('/')
              ? path
              : `/${path}`;
        return HttpResponse.json(rootFilesForUser(base));
      }),
      http.get('/api/permissions/check', () =>
        HttpResponse.json({ hasRead: true, hasWrite: true })
      ),
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([])),
      http.post('/api/files/check-conflicts', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const operations = body.operations || [];
        // Return conflicts to trigger the conflict dialog
        if (operations.length > 0) {
          return HttpResponse.json({
            conflicts: [{ nodeId: 99, path: conflictPath, type: 'file' }],
          });
        }
        return HttpResponse.json({ conflicts: [] });
      }),
      http.post('/api/files/upload', async ({ request }) => {
        const formData = await request.formData();
        const onConflict = formData.get('onConflict') || 'error';
        const file = formData.get('file');
        const parentNodeId = formData.get('parentNodeId') || '1';
        const name = file?.name || 'file';
        uploadedPayload = { name, parentNodeId, onConflict };
        if (onConflict === 'skip') {
          return HttpResponse.json({
            messageCode: 'serverMessages.files.uploadSkipped',
            parentNodeId,
            skipped: true,
          });
        }
        return HttpResponse.json({
          messageCode: 'serverMessages.files.uploadSuccess',
          nodeId: Date.now(),
          parentNodeId,
          basename: name,
        });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, {
      initialEntries: ['/files/testuser'],
    });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );

    const uploadBtn = await screen.findByRole(
      'button',
      { name: /upload file/i },
      { timeout: 5000 }
    );
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

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/skipped|complete|done/i);
      },
      { timeout: 10000 }
    );

    expect(uploadedPayload).not.toBeNull();
    expect(uploadedPayload.name).toBe('dup.txt');
    expect(uploadedPayload.onConflict).toBe('skip');
  }, 15000);

  /**
   * Download flow: context menu Download on a file triggers GET /api/files/download with path;
   * response is Blob + Content-Disposition (api.md). Verifies observable outcome: download
   * requested for the selected file (spec 2.6, plan 3.1).
   */
  it('download: context menu Download triggers file download with correct path', async () => {
    let downloadRequestParam = null;
    server.use(
      http.get('/api/files/download', ({ request }) => {
        const url = new URL(request.url);
        downloadRequestParam = url.searchParams.get('nodeId');
        return new HttpResponse(new Blob(['mock file content']), {
          headers: { 'Content-Disposition': 'attachment; filename="test.txt"' },
        });
      })
    );

    localStorage.setItem('viewMode', 'list');
    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
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

    await waitFor(
      () => {
        expect(downloadRequestParam).not.toBeNull();
      },
      { timeout: 5000 }
    );
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
      http.delete('/api/recent-files/:fileNodeId', emptyRecent),
      http.put('/api/files/rename', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const newName = (body.newName || '').trim();
        return HttpResponse.json({
          messageCode: 'serverMessages.files.renameSuccess',
          nodeId: body.nodeId,
          newName,
        });
      })
    );

    localStorage.setItem('viewMode', 'list');
    const user = userEvent.setup({ delay: null });
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
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
        const nodeId = url.searchParams.get('nodeId');
        const path = (url.searchParams.get('path') || '/').replace(/\/$/, '') || '/';
        const base =
          (path === '' || path === '/') && !nodeId
            ? '/testuser'
            : path.startsWith('/')
              ? path
              : `/${path}`;
        const isFolderPath =
          nodeId === '3' ||
          path.endsWith('/folder') ||
          path.split('/').filter(Boolean).pop() === 'folder';
        const rootItems = [
          {
            nodeId: 1,
            path: `${base}/test.txt`,
            basename: 'test.txt',
            type: 'file',
            size: 0,
            lastmod: null,
            hasReadPermission: true,
            hasWritePermission: true,
            isHidden: false,
          },
          {
            nodeId: 3,
            path: `${base}/folder`,
            basename: 'folder',
            type: 'directory',
            size: 0,
            lastmod: null,
            hasReadPermission: false,
            hasWritePermission: false,
            isHidden: false,
          },
        ];
        const folderItems = [
          {
            nodeId: 4,
            path: `${base}/sub.txt`,
            basename: 'sub.txt',
            type: 'file',
            size: 0,
            lastmod: null,
            hasReadPermission: true,
            hasWritePermission: true,
            isHidden: false,
          },
        ];
        return HttpResponse.json(isFolderPath ? folderItems : rootItems);
      }),
      http.get('/api/permissions/check', ({ request }) => {
        const url = new URL(request.url);
        const nodeId = url.searchParams.get('nodeId');
        const path = (url.searchParams.get('path') || '').replace(/\/$/, '');
        const isTargetFolder = nodeId === '3' || path === '/testuser/folder';
        return HttpResponse.json(
          isTargetFolder ? { hasRead: false, hasWrite: false } : { hasRead: true, hasWrite: true }
        );
      }),
      http.get('/api/permission-requests/check-owner', () =>
        HttpResponse.json({ ownerExists: true })
      ),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
      http.get('/api/permissions/user/:userId', () =>
        HttpResponse.json([{ nodeId: 2, permission: 'admin' }])
      ),
      http.post('/api/permission-requests', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        return HttpResponse.json({
          id: `pr_${Date.now()}`,
          nodeId: body.nodeId,
          permission: body.permission || 'read',
          status: 'pending',
        });
      })
    );

    const user = userEvent.setup();
    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/folder|test/i);
      },
      { timeout: 5000 }
    );

    const folderRow = await waitFor(
      () => {
        const el = document.querySelector('[data-file-path="/testuser/folder"]');
        if (el) return el;
        const byText =
          screen.getByText(/\bfolder\b/i).closest('[data-file-path]') ||
          screen.getByText(/\bfolder\b/i).closest('tr');
        if (byText) return byText;
        throw new Error('Folder row not found');
      },
      { timeout: 5000 }
    );
    fireEvent.contextMenu(folderRow, { clientX: 100, clientY: 100 });

    const shareItem = await screen.findByRole('menuitem', { name: /share/i });
    await user.click(shareItem);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await waitFor(
      () => {
        expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    const requestReadBtn = await waitFor(
      () => within(dialog).getByRole('button', { name: /request read permission/i }),
      { timeout: 5000 }
    );
    await user.click(requestReadBtn);

    await waitFor(
      () => {
        expect(within(dialog).getByText(/read permission requested/i)).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
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

    await waitFor(
      () => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      },
      { timeout: 8000 }
    );

    // Simplified header: no logout/mypage (unauthenticated share link shows logo-only AppBar)
    expect(screen.queryByRole('button', { name: /logout/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mypage/i })).not.toBeInTheDocument();

    // No upload / create folder (spec 2.7: share link mode has no upload/create)
    expect(screen.queryByRole('button', { name: /upload file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create folder/i })).not.toBeInTheDocument();

    // Download-only bulk: enter selection by single-clicking file, toolbar shows Download but not Move/Copy/Delete
    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/test|folder|docs/i);
      },
      { timeout: 3000 }
    );

    await user.click(screen.getByText(/test\.txt/i));

    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^move$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  }, 15000);

  /**
   * AI-platform shell wiring (§7): collections virtual routes.
   */
  describe('collections overlay (§7)', () => {
    const ownCard = {
      collection_id: 1,
      name: 'Roadtrip',
      item_count: 4,
      origin: 'user',
      status: 'active',
      granted_role: null,
      pinned: false,
      pinned_by: null,
      created_at: '2026-09-01T00:00:00Z',
    };
    const archivedCard = { ...ownCard, collection_id: 2, name: 'Old', status: 'archived' };

    const collectionsHandlers = ({ onList } = {}) => [
      http.get('/api/collections', ({ request }) => {
        const include = new URL(request.url).searchParams.get('include');
        if (onList) onList(include);
        return HttpResponse.json({
          collections: include === 'mine,archived' ? [archivedCard] : [ownCard],
        });
      }),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
    ];

    it('entering /files/__collections__ swaps the list region without touching route-param ownership', async () => {
      server.use(...collectionsHandlers());
      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__'],
      });

      expect(await screen.findByTestId('collections-list-view')).toBeInTheDocument();
      expect(screen.getByText('Roadtrip')).toBeInTheDocument();
      // §1.1: the swap happens under the /files/* splat — no second route owner.
      expect(screen.queryByTestId('explorer-container')).toBeInTheDocument();
    }, 15000);

    it('the archive route drives include=mine,archived for the overlay list', async () => {
      const seen = [];
      server.use(...collectionsHandlers({ onList: (include) => seen.push(include) }));
      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/__archive__'],
      });

      expect(await screen.findByTestId('collections-list-view')).toBeInTheDocument();
      expect(screen.getByText('Old')).toBeInTheDocument();
      await waitFor(() => {
        expect(seen).toContain('mine,archived');
      });
    }, 15000);

    it('member route lists items cursor-paged with client-side node_id de-dup', async () => {
      let itemsCalls = 0;
      server.use(
        ...collectionsHandlers(),
        http.get('/api/collections/5/items', ({ request }) => {
          itemsCalls += 1;
          const cursor = new URL(request.url).searchParams.get('cursor');
          if (!cursor) {
            return HttpResponse.json({
              items: [
                {
                  node_id: 90210,
                  name: 'poster.pdf',
                  type: 'file',
                  size: 2048,
                  lastmod: '2026-09-01T00:00:00Z',
                  membership: 'derived',
                  published: true,
                  state: 'normal',
                  shared_excluded: false,
                  reason: 'tag:poster',
                },
              ],
              next_cursor: 'cur-2',
              publish_pending_count: 2,
              digest: { added_since: 1, removed_since: 0 },
            });
          }
          // Page 2 repeats 90210 (§2.9: de-dup by node_id client-side).
          return HttpResponse.json({
            items: [
              {
                node_id: 90210,
                name: 'poster.pdf',
                type: 'file',
                size: 2048,
                lastmod: '2026-09-01T00:00:00Z',
                membership: 'derived',
                published: true,
                state: 'normal',
                shared_excluded: false,
              },
              {
                node_id: 90211,
                name: 'map.jpg',
                type: 'file',
                size: 1024,
                lastmod: '2026-09-02T00:00:00Z',
                membership: 'stored',
                published: true,
                state: 'normal',
                shared_excluded: false,
              },
            ],
            next_cursor: null,
          });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      expect(await screen.findByTestId('collections-list-view')).toBeInTheDocument();
      expect(await screen.findByTestId('member-row-90210')).toBeInTheDocument();
      // The shell supplied `since` (client-side last-visit copy) → digest banner renders.
      expect(screen.getByTestId('digest-banner')).toBeInTheDocument();
      expect(screen.getByTestId('publish-pending-banner')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('member-load-more'));
      expect(await screen.findByTestId('member-row-90211')).toBeInTheDocument();
      expect(screen.getAllByTestId('member-row-90210')).toHaveLength(1);
      expect(screen.queryByTestId('member-load-more')).not.toBeInTheDocument();
      expect(itemsCalls).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('card pin dispatches the CRUD, shows the undo toast, and Undo executes through the gateway', async () => {
      server.use(
        ...collectionsHandlers(),
        http.put('/api/collections/1', () =>
          HttpResponse.json({
            collection: { ...ownCard, pinned: true, pinned_by: 'user' },
            undo: { action_id: 99 },
          })
        ),
        http.post('/api/actions/99/undo', () =>
          HttpResponse.json({ action_id: 99, status: 'undone', items_undone: 1, items_skipped: 0 })
        )
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__'],
      });

      fireEvent.click(await screen.findByTestId('card-menu-button-1'));
      fireEvent.click(screen.getByTestId('card-menu-option-pin'));

      expect(await screen.findByText('Collection pinned')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('undo-toast-action'));

      expect(await screen.findByText('1 undone')).toBeInTheDocument();
    }, 15000);

    it('viewer card Revoke permission DELETEs /grants/me instantly and the refetch drops the card', async () => {
      const viewerCard = {
        ...ownCard,
        collection_id: 3,
        name: 'Given',
        granted_role: 'viewer',
      };
      let revoked = false;
      const deleteCalls = [];
      server.use(
        http.get('/api/collections', () =>
          HttpResponse.json({ collections: revoked ? [] : [viewerCard] })
        ),
        http.get('/api/collections/merge-suggestions', () =>
          HttpResponse.json({ suggestions: [] })
        ),
        http.delete('/api/collections/3/grants/me', () => {
          revoked = true;
          deleteCalls.push('/api/collections/3/grants/me');
          return HttpResponse.json({ grantee_id: 2, revoked: true, undo: { action_id: 55 } });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__'],
      });

      fireEvent.click(await screen.findByTestId('card-menu-button-3'));
      fireEvent.click(screen.getByTestId('card-menu-option-revoke-permission'));

      // instant: one click fires the mutation — no confirm step in between
      await waitFor(() => expect(deleteCalls).toHaveLength(1));
      // rows are fetch-driven (hiddenIds removed): the card vanishes only via
      // the post-mutation refresh, which now omits the revoked collection
      expect(await screen.findByText('No collections yet')).toBeInTheDocument();
      expect(screen.queryByTestId('collection-card-3')).not.toBeInTheDocument();
    }, 15000);
  });

  /**
   * AI-platform shell wiring (wave-2): search results mode, like state,
   * member-row menu.
   */
  describe('search results shell (T0.11 wiring)', () => {
    const searchResultsPayload = (rows, resultRef = 'sr1.abc') => ({
      name_matches: rows.map((r) => ({ node_id: r.node_id, name: r.name })),
      counts: { name: rows.length, semantic: 0, total: rows.length, name_truncated: false },
      result_ref: resultRef,
      semantic_available: false,
      semantic_unavailable_reason: 'serverErrors.ai.notConfigured',
    });

    it('typing never submits; Enter swaps the breadcrumb row for the results surface', async () => {
      const searchBodies = [];
      server.use(
        http.post('/api/search', async ({ request }) => {
          searchBodies.push(await request.json());
          return HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.pdf' }]));
        }),
        http.post('/api/files/metadata', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json(
            (body.nodeIds || []).map((nodeId) => ({
              nodeId,
              name: 'movie.pdf',
              type: 'file',
              size: 5,
              lastmod: null,
              mime: 'application/pdf',
            }))
          );
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      const searchbox = screen.getByRole('searchbox');
      fireEvent.change(searchbox, { target: { value: 'movie' } });
      expect(searchBodies).toHaveLength(0); // two-stage rule: typing never hits POST /api/search

      fireEvent.keyDown(searchbox, { key: 'Enter' });
      expect(await screen.findByTestId('search-results-mode')).toBeInTheDocument();
      expect(searchBodies).toEqual([{ query: 'movie' }]);
      expect(screen.queryByTestId('breadcrumb')).not.toBeInTheDocument();
      expect(screen.getByTestId('search-result-row')).toBeInTheDocument();
      // the normal listing region is suppressed while results are on screen
      expect(screen.queryByText(/test\.txt/)).not.toBeInTheDocument();
    }, 15000);

    it('result-row open fires recordEntryClick(node_id) and opens the enriched entry (file → preview)', async () => {
      const clickBodies = [];
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.pdf' }]))
        ),
        http.post('/api/search/click', async ({ request }) => {
          clickBodies.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        }),
        http.post('/api/files/metadata', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json(
            (body.nodeIds || []).map((nodeId) => ({
              nodeId,
              name: 'movie.pdf',
              type: 'file',
              size: 5,
              lastmod: null,
              mime: 'application/pdf',
            }))
          );
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      const searchbox = screen.getByRole('searchbox');
      fireEvent.change(searchbox, { target: { value: 'movie' } });
      fireEvent.keyDown(searchbox, { key: 'Enter' });
      const row = await screen.findByTestId('search-result-row');
      fireEvent.click(row);

      await waitFor(() => expect(clickBodies).toEqual([{ node_id: 11 }]));
      expect(await screen.findByRole('dialog', { name: /file preview/i })).toBeInTheDocument();
      // file open keeps results on screen (preview overlays the results surface)
      expect(screen.getByTestId('search-results-mode')).toBeInTheDocument();
    }, 15000);

    it('directory result-row open navigates to the folder and exits results mode', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 2, name: 'docs' }]))
        ),
        http.post('/api/search/click', () => new HttpResponse(null, { status: 204 })),
        http.post('/api/files/metadata', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json(
            (body.nodeIds || []).map((nodeId) => ({
              nodeId,
              name: 'docs',
              type: 'directory',
              size: null,
              lastmod: null,
              mime: null,
            }))
          );
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      const searchbox = screen.getByRole('searchbox');
      fireEvent.change(searchbox, { target: { value: 'docs' } });
      fireEvent.keyDown(searchbox, { key: 'Enter' });
      fireEvent.click(await screen.findByTestId('search-result-row'));

      await waitFor(() =>
        expect(screen.queryByTestId('search-results-mode')).not.toBeInTheDocument()
      );
      expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
    }, 15000);

    it('clearing the shared search text exits results mode (one ✕ clears both surfaces)', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.pdf' }]))
        )
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      const searchbox = screen.getByRole('searchbox');
      fireEvent.change(searchbox, { target: { value: 'movie' } });
      fireEvent.keyDown(searchbox, { key: 'Enter' });
      expect(await screen.findByTestId('search-results-mode')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Close search'));
      await waitFor(() =>
        expect(screen.queryByTestId('search-results-mode')).not.toBeInTheDocument()
      );
      expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
    }, 15000);
  });

  describe('like state shell (T0.5 wiring)', () => {
    it('context-menu like row calls the set seam with the flipped state and reflects it optimistically', async () => {
      let likedNow = true;
      let putBody = null;
      server.use(
        http.get('/api/file-likes', () => HttpResponse.json({ liked: likedNow ? [1] : [] })),
        http.put('/api/file-likes/:nodeId', async ({ request, params }) => {
          putBody = await request.json();
          likedNow = putBody.liked;
          return HttpResponse.json({ node_id: Number(params.nodeId), liked: putBody.liked });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      const row = await screen.findByText(/test\.txt/i);
      fireEvent.contextMenu(row, { clientX: 60, clientY: 60 });

      const toggle = await screen.findByTestId('like-toggle');
      expect(within(toggle).getByText('Unlike')).toBeInTheDocument();

      fireEvent.click(toggle);
      await waitFor(() => expect(putBody).toEqual({ liked: false }));

      // reopen — the optimistic row flip is what the next menu reads
      fireEvent.contextMenu(await screen.findByText(/test\.txt/i), { clientX: 60, clientY: 60 });
      const reopened = await screen.findByTestId('like-toggle');
      expect(within(reopened).getByText('Like')).toBeInTheDocument();
    }, 15000);

    it('an absorbed like failure reverts the optimistic flip', async () => {
      server.use(
        http.get('/api/file-likes', () => HttpResponse.json({ liked: [] })),
        http.put('/api/file-likes/:nodeId', () =>
          HttpResponse.json({ errorCode: 'serverErrors.files.notFound' }, { status: 404 })
        )
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      fireEvent.contextMenu(await screen.findByText(/test\.txt/i), { clientX: 60, clientY: 60 });
      const toggle = await screen.findByTestId('like-toggle');
      expect(within(toggle).getByText('Like')).toBeInTheDocument();
      fireEvent.click(toggle);

      // absorbed failure ⇒ mapped error surfaces and the optimistic flip reverts
      expect(await screen.findByText(/not found/i)).toBeInTheDocument();
      fireEvent.contextMenu(await screen.findByText(/test\.txt/i), { clientX: 60, clientY: 60 });
      const again = await screen.findByTestId('like-toggle');
      expect(within(again).getByText('Like')).toBeInTheDocument();
    }, 15000);
  });

  describe('collections member-row menu (T0.4/T0.5 host)', () => {
    const memberCollection = {
      collection_id: 5,
      name: 'Roadtrip',
      item_count: 1,
      origin: 'user',
      status: 'active',
      publish_mode: 'ask',
      granted_role: null,
      pinned: false,
      pinned_by: null,
      created_at: '2026-09-01T00:00:00Z',
    };
    const memberItem = (liked) => ({
      node_id: 90210,
      name: 'poster.pdf',
      type: 'file',
      size: 2048,
      lastmod: '2026-09-01T00:00:00Z',
      membership: 'stored',
      published: false,
      state: 'normal',
      liked,
      reason: null,
      shared_excluded: false,
    });

    const memberHandlers = ({ liked = () => false, onItems } = {}) => [
      http.get('/api/collections', () => HttpResponse.json({ collections: [memberCollection] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.get('/api/collections/5/items', () => {
        if (onItems) onItems();
        return HttpResponse.json({ items: [memberItem(liked())], next_cursor: null });
      }),
    ];

    it('row More opens the shell-hosted MemberRowControls with the exact §3.2 set', async () => {
      server.use(...memberHandlers());
      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      fireEvent.click(await screen.findByTestId('member-menu-button'));
      expect(await screen.findByTestId('member-exclude')).toBeInTheDocument();
      expect(screen.getByTestId('member-download')).toBeInTheDocument();
      expect(screen.getByTestId('member-show-original')).toBeInTheDocument();
      expect(screen.getByTestId('member-properties')).toBeInTheDocument();
      expect(screen.getByTestId('like-toggle')).toBeInTheDocument();
      // invariant 1: no file-mutating entries ever
      expect(screen.queryByText(/move/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/rename/i)).not.toBeInTheDocument();
    }, 15000);

    it('exclude dispatches DELETE /:id/items for the row and reports through the undo toast', async () => {
      let delBody = null;
      server.use(
        ...memberHandlers(),
        http.delete('/api/collections/5/items', async ({ request }) => {
          delBody = await request.json();
          return HttpResponse.json({
            removed: [90210],
            excluded: [],
            ignored: [],
            undo: { action_id: 88 },
          });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      fireEvent.click(await screen.findByTestId('member-menu-button'));
      fireEvent.click(await screen.findByTestId('member-exclude'));

      await waitFor(() => expect(delBody).toEqual({ nodeIds: [90210] }));
      expect(await screen.findByText('Removed from collection')).toBeInTheDocument();
    }, 15000);

    it('like dispatches PUT /api/file-likes/:nodeId and the refetched row carries the settled state', async () => {
      let likedNow = false;
      let putBody = null;
      let itemsCalls = 0;
      server.use(
        ...memberHandlers({
          liked: () => likedNow,
          onItems: () => {
            itemsCalls += 1;
          },
        }),
        http.put('/api/file-likes/:nodeId', async ({ request, params }) => {
          putBody = await request.json();
          likedNow = putBody.liked;
          return HttpResponse.json({ node_id: Number(params.nodeId), liked: putBody.liked });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      fireEvent.click(await screen.findByTestId('member-menu-button'));
      fireEvent.click(await screen.findByTestId('like-toggle'));
      await waitFor(() => expect(putBody).toEqual({ liked: true }));

      // notifier refresh: member rows re-read and the reopened menu reflects it
      await waitFor(() => expect(itemsCalls).toBeGreaterThan(1));
      fireEvent.click(await screen.findByTestId('member-menu-button'));
      const reopened = await screen.findByTestId('like-toggle');
      expect(within(reopened).getByText('Unlike')).toBeInTheDocument();
    }, 15000);

    it('reveal original resolves the ancestor chain and navigates to the real parent', async () => {
      let ancestorsRequested = null;
      server.use(
        ...memberHandlers(),
        http.get('/api/files/ancestors', ({ request }) => {
          ancestorsRequested = new URL(request.url).searchParams.get('nodeId');
          return HttpResponse.json({
            ancestors: [
              { nodeId: 1, name: 'home' },
              { nodeId: 42, name: 'docs' },
              { nodeId: 90210, name: 'poster.pdf' },
            ],
          });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      fireEvent.click(await screen.findByTestId('member-menu-button'));
      fireEvent.click(await screen.findByTestId('member-show-original'));

      await waitFor(() => expect(ancestorsRequested).toBe('90210'));
    }, 15000);
  });
});
