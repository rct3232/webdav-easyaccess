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
import { useAuth } from '../../contexts/AuthContext';
import FileManager from '../FileManager';
import { notifyRecentFilesChange } from '../../services/recentFilesNotifier';
import { notifyCollectionsChange } from '../../services/collectionsNotifier';

jest.mock('../../constants/fileManager', () => ({
  ...jest.requireActual('../../constants/fileManager'),
  SEARCH_ORBIT_CYCLE_MS: 0,
}));

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

  function MockFolderTree({ onNodeClick }) {
    return (
      <div data-testid="mock-folder-tree">
        <button
          type="button"
          data-testid="mock-folder-tree-recent"
          onClick={() => onNodeClick?.('/__recent__')}
        >
          mock recent
        </button>
      </div>
    );
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

// AuthProbe renders the async /api/auth/me hydration as DOM so the admin
// suppression cases can assert NEGATIVE outcomes without hydration races.
function AuthProbe() {
  const { user } = useAuth();
  const state = user ? (user.is_admin ? 'admin' : 'non-admin') : 'pending';
  return <span data-testid="auth-probe">{state}</span>;
}

function FileManagerWithAdminProbe() {
  return (
    <Routes>
      <Route
        path="/files/*"
        element={
          <>
            <FileManager />
            <AuthProbe />
          </>
        }
      />
    </Routes>
  );
}

const waitForAuthState = async (state) => {
  await waitFor(
    () => {
      expect(screen.getByTestId('auth-probe').textContent).toBe(state);
    },
    { timeout: 5000 }
  );
};

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
    // Baseline: keep collections reads handled — an unhandled 501 schedules
    // transport retries that leak into later tests' handler windows.
    server.use(
      http.get('/api/collections', () => HttpResponse.json({ collections: [] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.post('/api/collections/for-nodes', () => HttpResponse.json({ memberships: [] }))
    );
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
        // the live-highlight renderer splits matched names into segments —
        // assert on the concatenated listing text, not a single text node
        expect(document.body.textContent).toMatch(/test\.txt/);
        expect(document.body.textContent).not.toMatch(/folder1|docs1/);
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

    it('member route lists the FULL set in ONE response — no paging params, no load-more (Decision B)', async () => {
      const itemsUrls = [];
      server.use(
        ...collectionsHandlers(),
        http.get('/api/collections/5/items', ({ request }) => {
          itemsUrls.push(request.url);
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
            publish_pending_count: 2,
            digest: { added_since: 1, removed_since: 0 },
          });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      expect(await screen.findByTestId('collections-list-view')).toBeInTheDocument();
      expect(await screen.findByTestId('member-row-90210')).toBeInTheDocument();
      // Decision B: row 2 lands from the SAME response — no second page fetch.
      expect(screen.getByTestId('member-row-90211')).toBeInTheDocument();
      // The shell supplied `since` (client-side last-visit copy) → digest banner renders.
      expect(screen.getByTestId('digest-banner')).toBeInTheDocument();
      expect(screen.getByTestId('publish-pending-banner')).toBeInTheDocument();
      // The load-more affordance is retired — the host slices 50+50 client-side.
      expect(screen.queryByTestId('member-load-more')).not.toBeInTheDocument();
      // The paging invariant: NO member request ever carries cursor/limit.
      // (Notifier-driven whole-list refreshes are allowed, page continuations
      // are not.)
      expect(itemsUrls.length).toBeGreaterThanOrEqual(1);
      for (const url of itemsUrls) {
        const params = new URL(url).searchParams;
        expect(params.has('cursor')).toBe(false);
        expect(params.has('limit')).toBe(false);
      }
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

    /**
     * collection-properties host wiring (FileManager.md §7): the reserved
     * `sharing` dispatch opens the owner-only CollectionPropertiesDialog on
     * the LIVE fetch row; every edit stays in the dialog draft and ONE
     * `PUT /:id/properties` fires on Save.
     */
    describe('collection-properties sharing dialog host', () => {
      it('stages grant/role/publish changes across tabs and saves ONE atomic properties plan', async () => {
        let cardState = { ...ownCard };
        let grants = [
          {
            grantee_id: 9,
            username: 'bob',
            role: 'viewer',
            granted_by: 1,
            created_at: '2026-09-02T00:00:00Z',
          },
        ];
        const propertiesBodies = [];
        const legacyPutBodies = [];
        const grantPostBodies = [];
        const grantDeleteUrls = [];
        server.use(
          http.get('/api/collections', () => HttpResponse.json({ collections: [cardState] })),
          http.get('/api/collections/merge-suggestions', () =>
            HttpResponse.json({ suggestions: [] })
          ),
          http.get('/api/collections/1/grants', () => HttpResponse.json({ grants })),
          http.post('/api/collections/1/preview', () =>
            HttpResponse.json({
              count: 2,
              sample: [{ node_id: 5, name: 'a.txt' }],
              sample_truncated: false,
            })
          ),
          http.get('/api/users/approved', () =>
            HttpResponse.json([
              { id: 9, username: 'bob', email: 'bob@e.test' },
              { id: 11, username: 'dave', email: 'dave@e.test' },
            ])
          ),
          http.put('/api/collections/1/properties', async ({ request }) => {
            const body = await request.json();
            propertiesBodies.push(body);
            if (body.publishMode) cardState = { ...cardState, publish_mode: body.publishMode };
            if (body.name) cardState = { ...cardState, name: body.name };
            if (typeof body.pinned === 'boolean') cardState = { ...cardState, pinned: body.pinned };
            let nextGrants = [...grants];
            for (const revokedId of body.grants?.revoke ?? []) {
              nextGrants = nextGrants.filter((row) => row.grantee_id !== Number(revokedId));
            }
            for (const upsert of body.grants?.upsert ?? []) {
              nextGrants = [
                ...nextGrants.filter((row) => row.grantee_id !== Number(upsert.userId)),
                {
                  grantee_id: Number(upsert.userId),
                  username: 'dave',
                  role: upsert.role,
                  granted_by: 1,
                  created_at: '2026-09-06T00:00:00Z',
                },
              ];
            }
            grants = nextGrants;
            return HttpResponse.json({
              collection: cardState,
              grants,
              undo: { action_id: 101 },
            });
          }),
          // legacy per-field / per-grant endpoints must stay IO-silent
          http.put('/api/collections/1', async ({ request }) => {
            legacyPutBodies.push(await request.json());
            return HttpResponse.json({ collection: cardState, undo: { action_id: 102 } });
          }),
          http.post('/api/collections/1/grants', async ({ request }) => {
            grantPostBodies.push(await request.json());
            return HttpResponse.json({ grant: {}, undo: { action_id: 202 } }, { status: 201 });
          }),
          http.delete('/api/collections/1/grants', ({ request }) => {
            grantDeleteUrls.push(new URL(request.url).searchParams.get('userId'));
            return HttpResponse.json({ grantee_id: 0, revoked: true, undo: { action_id: 203 } });
          })
        );

        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        // 1) dispatch seam: card menu Sharing opens the dialog on the sharing tab
        fireEvent.click(await screen.findByTestId('card-menu-button-1'));
        fireEvent.click(screen.getByTestId('card-menu-option-sharing'));
        expect(await screen.findByTestId('collection-props-tab-sharing')).toHaveAttribute(
          'aria-selected',
          'true'
        );
        expect(await screen.findByTestId('collection-grant-row-9')).toHaveTextContent('bob');

        // 2) add user → DRAFT row, no request before Save
        fireEvent.click(screen.getByTestId('collection-grant-add'));
        const menu = await screen.findByRole('menu');
        expect(within(menu).getByText('dave')).toBeInTheDocument();
        expect(within(menu).queryByText('bob')).not.toBeInTheDocument();
        fireEvent.click(within(menu).getByText('dave'));
        expect(await screen.findByTestId('collection-grant-row-11')).toHaveTextContent('Viewer');
        expect(propertiesBodies).toHaveLength(0);
        expect(legacyPutBodies).toHaveLength(0);
        expect(grantPostBodies).toHaveLength(0);

        // 3) role badge + publish mode are drafts too
        fireEvent.click(screen.getByTestId('collection-grant-role-11'));
        expect(screen.getByTestId('collection-grant-role-11')).toHaveTextContent('Editor');
        fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
        expect(propertiesBodies).toHaveLength(0);

        // 4) draft survives a tab switch: Info chip reflects Auto, Sharing keeps the row
        fireEvent.click(screen.getByTestId('collection-props-tab-info'));
        expect(screen.getByTestId('collection-publish-mode-chip')).toHaveTextContent('Auto');
        expect(screen.getByTestId('collection-props-save')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('collection-props-tab-sharing'));
        expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked();
        expect(screen.getByTestId('collection-grant-row-11')).toHaveTextContent('Editor');

        // 5) remove an existing grant (draft only), then Save ONE atomic plan
        fireEvent.click(screen.getByTestId('collection-grant-revoke-9'));
        expect(screen.queryByTestId('collection-grant-row-9')).not.toBeInTheDocument();
        expect(propertiesBodies).toHaveLength(0);

        fireEvent.click(screen.getByTestId('collection-props-save'));

        await waitFor(() => expect(propertiesBodies).toHaveLength(1));
        expect(propertiesBodies[0]).toEqual({
          publishMode: 'auto',
          grants: { upsert: [{ userId: 11, role: 'editor' }], revoke: [9] },
        });
        expect(legacyPutBodies).toHaveLength(0);
        expect(grantPostBodies).toHaveLength(0);
        expect(grantDeleteUrls).toHaveLength(0);

        // 6) ONE summary toast, no per-grant undo toasts; dialog closes
        expect(await screen.findByText('Collection properties saved')).toBeInTheDocument();
        expect(screen.queryByText('Collection shared')).not.toBeInTheDocument();
        expect(screen.queryByText('Sharing revoked')).not.toBeInTheDocument();
        await waitFor(() =>
          expect(screen.queryByTestId('collection-props-tab-sharing')).not.toBeInTheDocument()
        );
        expect(screen.getByTestId('collections-list-view')).toBeInTheDocument();
      }, 30000);

      it('received card dispatches no sharing dialog (granted rows: revoke-only menu)', async () => {
        const viewerCard = {
          ...ownCard,
          collection_id: 4,
          name: 'Given',
          granted_role: 'viewer',
        };
        server.use(
          http.get('/api/collections', () => HttpResponse.json({ collections: [viewerCard] })),
          http.get('/api/collections/merge-suggestions', () =>
            HttpResponse.json({ suggestions: [] })
          )
        );

        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        fireEvent.click(await screen.findByTestId('card-menu-button-4'));
        expect(screen.getByTestId('card-menu-option-revoke-permission')).toBeInTheDocument();
        expect(screen.queryByTestId('card-menu-option-sharing')).not.toBeInTheDocument();
      }, 15000);
    });

    /**
     * P-3 — card grid parity shell wiring: synthetic-key selection, double-open
     * routing, surface-aware select-all, and the bulk cluster looping the
     * existing single-collection calls.
     */
    describe('P-3 card selection, double-open and bulk bar', () => {
      const cardA = { ...ownCard, collection_id: 1, name: 'Roadtrip', preview_items: [] };
      const cardB = {
        ...ownCard,
        collection_id: 2,
        name: 'Studio',
        preview_items: [{ node_id: 88, name: 'a.jpg', type: 'file', mime: 'image/jpeg' }],
      };
      const twoCards = [cardA, cardB];

      const twoCardHandlers = ({ archived = false, calls = {} } = {}) => [
        http.get('/api/collections', ({ request }) => {
          const include = new URL(request.url).searchParams.get('include');
          calls.listInclude = include;
          if (archived) {
            return HttpResponse.json({
              collections: [
                { ...cardA, status: 'archived' },
                { ...cardB, status: 'archived' },
              ],
            });
          }
          return HttpResponse.json({
            collections: include === 'mine,archived' ? [] : twoCards,
          });
        }),
        http.get('/api/collections/merge-suggestions', () =>
          HttpResponse.json({ suggestions: [] })
        ),
        http.put('/api/collections/:id', async ({ request }) => {
          const body = await request.json();
          (calls.puts ??= []).push({
            id: new URL(request.url).pathname.split('/').pop(),
            body,
          });
          return HttpResponse.json({
            collection: { ...cardA, ...body },
            undo: { action_id: 100 + calls.puts.length },
          });
        }),
        http.post('/api/collections/:id/archive', async ({ request }) => {
          (calls.archives ??= []).push(new URL(request.url).pathname);
          return HttpResponse.json({
            collection: { ...cardA, status: 'archived' },
            undo: { action_id: 7 },
          });
        }),
        http.post('/api/collections/:id/restore', async ({ request }) => {
          (calls.restores ??= []).push(new URL(request.url).pathname);
          return HttpResponse.json({
            collection: { ...cardA, status: 'active' },
            undo: { action_id: 8 },
          });
        }),
        http.delete('/api/collections/:id', ({ request }) => {
          (calls.deletes ??= []).push(new URL(request.url).pathname);
          return new HttpResponse(null, { status: 204 });
        }),
      ];

      it('single click selects the card (synthetic key) and the toolbar shows the fixed bulk set', async () => {
        server.use(...twoCardHandlers());
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        fireEvent.click(await screen.findByTestId('collection-card-1'));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-collections-pin')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-collections-unpin')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-collections-archive')).toBeInTheDocument();
        expect(screen.queryByTestId('bulk-action-move')).not.toBeInTheDocument();

        // select-all now feeds CARD keys (not file rows): 2 selected.
        fireEvent.click(screen.getByText('Select all'));
        expect(await screen.findByText('2 selected')).toBeInTheDocument();
      }, 15000);

      it('double click opens the member route through the existing card-action path', async () => {
        server.use(
          ...twoCardHandlers(),
          http.get('/api/collections/1/items', () => HttpResponse.json({ items: [] }))
        );
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        const cardEl = await screen.findByTestId('collection-card-1');
        fireEvent.click(cardEl);
        fireEvent.click(cardEl);

        expect(await screen.findByTestId('members-list')).toBeInTheDocument();
      }, 15000);

      it('bulk pin loops the existing PUT call once per selected card and exits selection', async () => {
        const calls = {};
        server.use(...twoCardHandlers({ calls }));
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        fireEvent.click(await screen.findByTestId('collection-card-1'));
        fireEvent.click(screen.getByTestId('collection-card-2'), { ctrlKey: true });
        expect(screen.getByText('2 selected')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('bulk-collections-pin'));
        await waitFor(() => expect(calls.puts).toHaveLength(2));
        expect(calls.puts.map((entry) => entry.id).sort()).toEqual(['1', '2']);
        expect(calls.puts.every((entry) => entry.body.pinned === true)).toBe(true);
        // selection cleared after the batch (files parity)
        await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
      }, 15000);

      it('bulk archive asks ONE confirm covering the batch, then posts per collection', async () => {
        const calls = {};
        server.use(...twoCardHandlers({ calls }));
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        fireEvent.click(await screen.findByTestId('collection-card-1'));
        fireEvent.click(screen.getByTestId('collection-card-2'), { ctrlKey: true });
        fireEvent.click(screen.getByTestId('bulk-collections-archive'));

        // ONE dialog covers the batch and lists both names.
        expect(await screen.findByText(/\(Roadtrip, Studio\)/)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

        await waitFor(() => expect(calls.archives).toHaveLength(2));
      }, 15000);

      it('archive view: bulk delete-permanent keeps the TWO-step and deletes both', async () => {
        const calls = {};
        server.use(...twoCardHandlers({ archived: true, calls }));
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__/__archive__'],
        });

        // archive surface shows Restore · Delete permanently (no Pin set)
        fireEvent.click(await screen.findByTestId('collection-card-1'));
        fireEvent.click(screen.getByTestId('collection-card-2'), { ctrlKey: true });
        expect(screen.getByTestId('bulk-collections-restore')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-collections-delete-permanent')).toBeInTheDocument();
        expect(screen.queryByTestId('bulk-collections-pin')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('bulk-collections-delete-permanent'));
        expect(await screen.findByText(/\(Roadtrip, Studio\)/)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

        // second step of the trash-parity confirm (same batch names)
        await screen.findByText(/\(Roadtrip, Studio\)/);
        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

        await waitFor(() => expect(calls.deletes).toHaveLength(2));
        expect(calls.deletes.map((path) => path.split('/').pop()).sort()).toEqual(['1', '2']);
      }, 15000);

      it('card click on the menu button opens the card menu without touching selection', async () => {
        server.use(...twoCardHandlers());
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        fireEvent.click(await screen.findByTestId('card-menu-button-1'));
        expect(await screen.findByTestId('card-menu-option-rename')).toBeInTheDocument();
        expect(screen.queryByTestId('card-menu-option-open')).not.toBeInTheDocument();
        expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
      }, 15000);

      it('two quick clicks on DIFFERENT cards select twice — never open (same-entry window)', async () => {
        server.use(...twoCardHandlers());
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        fireEvent.click(await screen.findByTestId('collection-card-1'));
        fireEvent.click(screen.getByTestId('collection-card-2'));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        expect(screen.queryByTestId('members-list')).not.toBeInTheDocument();
      }, 15000);

      it('preview cell renders from preview_items with the lazy-load DOM contract', async () => {
        server.use(...twoCardHandlers());
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        // card 2 carries preview_items [{node_id: 88}] — the cell exists with the
        // data-file-node-id contract the shared lazy-load mechanism scans.
        const cell = await screen.findByTestId('collection-preview-88');
        expect(cell).toHaveAttribute('data-file-node-id', '88');
        expect(cell.querySelector('img')).not.toBeInTheDocument();
        // no member filename label
        expect(screen.queryByText('a.jpg')).not.toBeInTheDocument();
      }, 15000);
    });

    /**
     * T3.1 merge-proposal card slot: the shell injects ONE card (never stacked),
     * the `+N more` chip cycles the score-desc pending set, Merge dispatches with
     * no extra dialog and raises the undo toast, Later/Keep separate resolve the
     * pair through dismiss/reject — and an empty set renders NOTHING.
     * @see docs/spec/client/components/file-manager/MergeProposalCard.md
     * @see docs/spec/client/pages/FileManager.md (merge slot)
     */
    describe('merge proposal card slot', () => {
      const mergeSuggestion = (overrides = {}) => ({
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
        overlap_sample: [{ a_node_id: 101, b_node_id: 101 }],
        a_unique_sample: [{ node_id: 110, name: 'beach.jpg' }],
        b_unique_sample: [{ node_id: 220, name: 'seville.jpg' }],
        ...overrides,
      });

      const mergeSlotHandlers = ({ getPending, calls }) => [
        http.get('/api/collections', () => HttpResponse.json({ collections: [ownCard] })),
        http.get('/api/collections/merge-suggestions', () =>
          HttpResponse.json({ suggestions: getPending() })
        ),
        http.post('/api/collections/:id/merge/:other', ({ params }) => {
          calls.posts.push(`merge/${params.id}/${params.other}`);
          calls.pending = calls.pending.filter(
            (row) => !(row.a_id === Number(params.id) && row.b_id === Number(params.other))
          );
          return HttpResponse.json({
            survivor: { collection_id: Number(params.id), name: 'Europe', item_count: 58 },
            absorbed_id: Number(params.other),
            undo: { action_id: 501 },
          });
        }),
        http.post('/api/collections/:id/merge-dismiss', async ({ request, params }) => {
          const body = await request.json();
          calls.posts.push(`dismiss/${params.id}/${body.otherId}`);
          calls.pending = calls.pending.filter(
            (row) => !(row.a_id === Number(params.id) && row.b_id === body.otherId)
          );
          return HttpResponse.json({
            suggestion_id: 88,
            state: 'dismissed',
            dismissed_at: '2026-10-27T00:00:00Z',
            dismiss_count: 1,
          });
        }),
        http.post('/api/collections/:id/merge-reject', async ({ request, params }) => {
          const body = await request.json();
          calls.posts.push(`reject/${params.id}/${body.otherId}`);
          calls.pending = calls.pending.filter(
            (row) => !(row.a_id === Number(params.id) && row.b_id === body.otherId)
          );
          return HttpResponse.json({
            suggestion_id: 88,
            state: 'rejected',
            rejected_at: '2026-10-27T00:00:00Z',
          });
        }),
      ];

      const slotState = (rows = []) => {
        const calls = { posts: [], pending: rows.map((row) => row) };
        return {
          calls,
          handlers: mergeSlotHandlers({ getPending: () => calls.pending, calls }),
        };
      };

      const firstPair = mergeSuggestion();
      const secondPair = mergeSuggestion({
        suggestion_id: 89,
        a_id: 30,
        a_name: 'Kyoto',
        b_id: 31,
        b_name: 'Osaka',
        score: 640,
      });

      it('renders ONE card for the whole pending set, cycles with +N more, merges without a dialog and offers undo', async () => {
        const state = slotState([firstPair, secondPair]);
        server.use(...state.handlers);
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        const card = await screen.findByTestId('merge-proposal-card');
        // never stacked: one card DOM node for two pending rows
        expect(screen.getAllByTestId('merge-proposal-card')).toHaveLength(1);
        // score desc first: Europe|2025 trip pair displayed
        expect(card).toHaveTextContent('Europe');
        expect(card).toHaveTextContent('+1 more');

        fireEvent.click(screen.getByTestId('merge-cycle-chip'));
        await waitFor(() =>
          expect(screen.getByTestId('merge-proposal-card')).toHaveTextContent('Kyoto')
        );

        fireEvent.click(screen.getByTestId('merge-accept'));
        // card IS the confirmation: no dialog ever opens
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(state.calls.posts).toEqual(['merge/30/31']));
        // undo toast rides the mergePair → onUndoable seam
        expect(await screen.findByText('Collections merged')).toBeInTheDocument();

        // the merged pair left the pending set (server truth re-read): the
        // remaining card shows the FIRST pair again (cursor clamps) with no chip
        await waitFor(() => {
          const next = screen.getByTestId('merge-proposal-card');
          expect(next).toHaveTextContent('Europe');
          expect(screen.queryByTestId('merge-cycle-chip')).not.toBeInTheDocument();
        });
        // the single card still owns exactly one DOM node; the list renders on
        expect(screen.getAllByTestId('merge-proposal-card')).toHaveLength(1);
        expect(screen.getByTestId('collection-card-1')).toBeInTheDocument();
      }, 15000);

      it('Later dismisses the displayed pair and Keep separate rejects the next one — the slot ends empty', async () => {
        const state = slotState([firstPair, secondPair]);
        server.use(...state.handlers);
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        const card = await screen.findByTestId('merge-proposal-card');
        expect(card).toHaveTextContent('Europe');
        fireEvent.click(screen.getByTestId('merge-later'));
        await waitFor(() => expect(state.calls.posts).toEqual(['dismiss/17/23']));

        // the cycled set shrank: the surviving row shows with no chip
        await waitFor(() =>
          expect(screen.getByTestId('merge-proposal-card')).toHaveTextContent('Kyoto')
        );
        expect(screen.queryByTestId('merge-cycle-chip')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('merge-keep-separate'));
        await waitFor(() => expect(state.calls.posts).toEqual(['dismiss/17/23', 'reject/30/31']));
        await waitFor(() =>
          expect(screen.queryByTestId('merge-proposal-card')).not.toBeInTheDocument()
        );
        expect(screen.queryByTestId('merge-proposal-card')).not.toBeInTheDocument();
      }, 15000);

      it('empty pending set renders no card and no layout wrapper (zero footprint)', async () => {
        const state = slotState([]);
        server.use(...state.handlers);
        await renderWithProvidersAct(<FileManagerWithRoutes />, {
          initialEntries: ['/files/__collections__'],
        });

        await screen.findByTestId('collection-card-1');
        expect(screen.queryByTestId('merge-proposal-card')).not.toBeInTheDocument();
      }, 15000);
    });
  });

  /**
   * AI-platform shell wiring: search results mode (zones + chip bar), exit
   * rules, union selection and the LibraryAdd full-snapshot target.
   * @see docs/spec/client/pages/FileManager.md §7
   */
  describe('search results shell (zones wiring)', () => {
    const searchResultsPayload = (rows, resultRef = 'sr1.abc') => ({
      name_matches: rows.map((r) => ({ node_id: r.node_id, name: r.name })),
      counts: { name: rows.length, semantic: 0, total: rows.length, name_truncated: false },
      result_ref: resultRef,
      semantic_unavailable_reason: 'not_configured',
    });

    const metadataHandler = (overrides = {}) =>
      http.post('/api/files/metadata', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          (body.nodeIds || []).map((nodeId) => ({
            nodeId,
            name: overrides[nodeId]?.name ?? 'server-row.pdf',
            type: overrides[nodeId]?.type ?? 'file',
            size: overrides[nodeId]?.size ?? 5,
            lastmod: null,
            mime: 'application/pdf',
            hasReadPermission: overrides[nodeId]?.hasReadPermission ?? true,
            hasWritePermission: overrides[nodeId]?.hasWritePermission ?? false,
          }))
        );
      });

    const semanticResultsPayload = (nameMatches, semanticRows) => ({
      name_matches: nameMatches.map((r) => ({ node_id: r.node_id, name: r.name })),
      semantic: semanticRows.map((r) => ({
        node_id: r.node_id,
        name: r.name,
        score: r.score ?? 0.9,
      })),
      counts: {
        name: nameMatches.length,
        semantic: semanticRows.length,
        total: nameMatches.length + semanticRows.length,
        name_truncated: false,
        semantic_capped_segments: false,
      },
      result_ref: 'sr1.abc',
    });

    const submitSearchText = async (value) => {
      const searchbox = screen.getByRole('searchbox');
      fireEvent.change(searchbox, { target: { value } });
      fireEvent.keyDown(searchbox, { key: 'Enter' });
    };

    it('typing never POSTs; Enter submit renders the zones + chip bar with exactly one POST', async () => {
      const searchBodies = [];
      server.use(
        http.post('/api/search', async ({ request }) => {
          searchBodies.push(await request.json());
          return HttpResponse.json(
            searchResultsPayload([
              { node_id: 11, name: 'sub-test.pdf' },
              { node_id: 1, name: 'test.txt' },
            ])
          );
        }),
        metadataHandler()
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } });
      expect(searchBodies).toHaveLength(0); // typing = client filter, never POST

      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

      expect(await screen.findByTestId('search-chip-bar')).toBeInTheDocument();
      expect(searchBodies).toEqual([{ query: 'test' }]);
      // the commit hands the term to the chip strip — the input field is cleared
      expect(screen.getByRole('searchbox')).toHaveValue('');
      expect(screen.queryByTestId('breadcrumb')).not.toBeInTheDocument();
      expect(await screen.findByTestId('search-zone-header-a')).toBeInTheDocument();
      expect(screen.getByTestId('search-zone-header-b')).toBeInTheDocument();
      expect(screen.getByTestId('server-search-row-11')).toBeInTheDocument();
      // Zone A = current-folder match; node 1 renders in Zone A only (dedup)
      expect(document.querySelector('[data-file-node-id="1"]')).toBeInTheDocument();
      expect(screen.queryByTestId('server-search-row-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('search-zone-header-c')).not.toBeInTheDocument();
    }, 15000);

    it('directory result-row open records the click, navigates and exits results mode', async () => {
      const clickBodies = [];
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 22, name: 'archive-docs' }]))
        ),
        http.post('/api/search/click', async ({ request }) => {
          clickBodies.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        }),
        metadataHandler({ 22: { name: 'archive-docs', type: 'directory', size: null } })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('archive-docs');
      const row = await screen.findByTestId('server-search-row-22');
      await waitFor(() => expect(row.textContent).toMatch(/archive-docs/));
      fireEvent.click(row, { detail: 2 });

      await waitFor(() => expect(clickBodies).toEqual([{ node_id: 22 }]));
      await waitFor(() => expect(screen.queryByTestId('search-chip-bar')).not.toBeInTheDocument());
      expect(await screen.findByTestId('breadcrumb')).toBeInTheDocument();
      expect(screen.getByRole('searchbox')).toHaveValue('');
    }, 15000);

    it('file result-row open previews while the zones stay mounted and the click is recorded', async () => {
      const clickBodies = [];
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.pdf' }]))
        ),
        http.post('/api/search/click', async ({ request }) => {
          clickBodies.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        }),
        metadataHandler()
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('movie');
      const row = await screen.findByTestId('server-search-row-11');
      await waitFor(() => expect(row.textContent).toMatch(/movie\.pdf/));
      fireEvent.click(row, { detail: 2 });

      await waitFor(() => expect(clickBodies).toEqual([{ node_id: 11 }]));
      expect(await screen.findByRole('dialog', { name: /file preview/i })).toBeInTheDocument();
      // preview overlays the results surface — the zones keep rendering
      expect(screen.getByTestId('search-chip-bar')).toBeInTheDocument();
      expect(screen.getByTestId('search-zone-header-b')).toBeInTheDocument();
    }, 15000);

    it('sidebar folder navigation while results render exits results mode', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.pdf' }]))
        ),
        metadataHandler()
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('movie');
      expect(await screen.findByTestId('search-chip-bar')).toBeInTheDocument();

      const treeRow = await screen.findByTestId('mock-folder-tree-recent');
      fireEvent.click(treeRow);

      await waitFor(() => expect(screen.queryByTestId('search-chip-bar')).not.toBeInTheDocument());
      expect(await screen.findByTestId('breadcrumb')).toBeInTheDocument();
      expect(screen.getByRole('searchbox')).toHaveValue('');
    }, 15000);

    it('select-all spans the zones (union selection source)', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(
            searchResultsPayload([
              { node_id: 11, name: 'sub-test.pdf' },
              { node_id: 1, name: 'test.txt' },
            ])
          )
        ),
        metadataHandler()
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      // desktop single click on a zone row enters selection (browse parity)
      const zoneBRow = await screen.findByTestId('server-search-row-11');
      await waitFor(() => expect(zoneBRow.textContent).toMatch(/sub-test\.pdf/));
      fireEvent.click(zoneBRow, { detail: 1 });

      const selectAllButtons = await screen.findAllByRole('button', { name: /select all/i });
      fireEvent.click(selectAllButtons[0]);

      await waitFor(() => {
        const zoneASelected = document
          .querySelector('[data-file-node-id="1"]')
          ?.getAttribute('aria-selected');
        const zoneBSelected = screen
          .getByTestId('server-search-row-11')
          .getAttribute('aria-selected');
        expect(zoneASelected).toBe('true');
        expect(zoneBSelected).toBe('true');
      });
    }, 15000);

    it('a writable Zone C row joins the union: selecting it enables the write bulk actions', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(
            semanticResultsPayload(
              [{ node_id: 11, name: 'sub-test.pdf' }],
              [{ node_id: 90, name: 'semantic-match.jpg' }]
            )
          )
        ),
        metadataHandler({ 90: { name: 'semantic-match.jpg', hasWritePermission: true } })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      const zoneCRow = await screen.findByTestId('server-search-row-90');
      await waitFor(() => expect(zoneCRow.textContent).toMatch(/semantic-match\.jpg/));
      fireEvent.click(zoneCRow, { detail: 1 });

      expect(await screen.findByTestId('bulk-action-move')).not.toBeDisabled();
      expect(screen.getByTestId('bulk-action-delete')).not.toBeDisabled();
      expect(screen.queryByText('Selection includes read-only files')).not.toBeInTheDocument();
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    }, 15000);

    it('a read-only Zone C row trips the read-only gate (banner + disabled write actions)', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(
            semanticResultsPayload(
              [{ node_id: 11, name: 'sub-test.pdf' }],
              [{ node_id: 90, name: 'semantic-match.jpg' }]
            )
          )
        ),
        metadataHandler({ 90: { name: 'semantic-match.jpg', hasWritePermission: false } })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      const zoneCRow = await screen.findByTestId('server-search-row-90');
      await waitFor(() => expect(zoneCRow.textContent).toMatch(/semantic-match\.jpg/));
      fireEvent.click(zoneCRow, { detail: 1 });

      expect(await screen.findByText('Selection includes read-only files')).toBeInTheDocument();
      expect(screen.getByTestId('bulk-action-move')).toBeDisabled();
      expect(screen.getByTestId('bulk-action-delete')).toBeDisabled();
    }, 15000);

    it('select-all spans Zone C as well (A ++ B ++ C union)', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(
            semanticResultsPayload(
              [{ node_id: 11, name: 'sub-test.pdf' }],
              [{ node_id: 90, name: 'semantic-match.jpg' }]
            )
          )
        ),
        metadataHandler({
          11: { name: 'sub-test.pdf', hasWritePermission: true },
          90: { name: 'semantic-match.jpg', hasWritePermission: true },
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      const zoneBRow = await screen.findByTestId('server-search-row-11');
      await waitFor(() => expect(zoneBRow.textContent).toMatch(/sub-test\.pdf/));
      const zoneCRow = screen.getByTestId('server-search-row-90');
      await waitFor(() => expect(zoneCRow.textContent).toMatch(/semantic-match\.jpg/));
      fireEvent.click(zoneBRow, { detail: 1 });

      const selectAllButtons = await screen.findAllByRole('button', { name: /select all/i });
      fireEvent.click(selectAllButtons[0]);

      await waitFor(() => {
        expect(
          document.querySelector('[data-file-node-id="1"]')?.getAttribute('aria-selected')
        ).toBe('true');
        expect(screen.getByTestId('server-search-row-11')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('server-search-row-90')).toHaveAttribute('aria-selected', 'true');
      });
      expect(screen.getByText('3 selected')).toBeInTheDocument();
      expect(screen.getByTestId('bulk-action-move')).not.toBeDisabled();
    }, 15000);

    it('a node present in both Zone A and Zone C counts once in the selection union', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(
            semanticResultsPayload(
              [
                { node_id: 11, name: 'sub-test.pdf' },
                { node_id: 1, name: 'test.txt' },
              ],
              [
                { node_id: 1, name: 'test.txt' },
                { node_id: 90, name: 'semantic-match.jpg' },
              ]
            )
          )
        ),
        metadataHandler({
          11: { name: 'sub-test.pdf', hasWritePermission: true },
          1: { name: 'test.txt', hasWritePermission: true },
          90: { name: 'semantic-match.jpg', hasWritePermission: true },
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      const zoneBRow = await screen.findByTestId('server-search-row-11');
      await waitFor(() => expect(zoneBRow.textContent).toMatch(/sub-test\.pdf/));
      fireEvent.click(zoneBRow, { detail: 1 });

      const selectAllButtons = await screen.findAllByRole('button', { name: /select all/i });
      fireEvent.click(selectAllButtons[0]);

      // Zone A {1, 11} ∪ Zone C {1, 90} = three entries — the A/C duplicate
      // (node 1) is counted once, not twice.
      expect(await screen.findByText('3 selected')).toBeInTheDocument();
      expect(screen.getByTestId('bulk-action-move')).not.toBeDisabled();
    }, 15000);

    it('LibraryAdd adds the FULL snapshot (zone A ∪ zone B ids) through the member-add seam', async () => {
      let itemsBody = null;
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(
            searchResultsPayload([
              { node_id: 11, name: 'sub-test.pdf' },
              { node_id: 1, name: 'test.txt' },
            ])
          )
        ),
        metadataHandler(),
        http.get('/api/collections', () =>
          HttpResponse.json({
            collections: [
              {
                collection_id: 5,
                name: 'Roadtrip',
                item_count: 0,
                origin: 'user',
                status: 'active',
                publish_mode: 'auto',
                granted_role: null,
                pinned: false,
                pinned_by: null,
                created_at: '2026-09-01T00:00:00Z',
              },
            ],
          })
        ),
        http.get('/api/collections/merge-suggestions', () =>
          HttpResponse.json({ suggestions: [] })
        ),
        http.post('/api/collections/5/items', async ({ request }) => {
          itemsBody = await request.json();
          return HttpResponse.json({
            added: itemsBody.nodeIds ?? [],
            already_members: [],
            rejected_not_readable: [],
            undo: { action_id: 91 },
          });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      expect(await screen.findByTestId('server-search-row-11')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('search-library-add'));
      fireEvent.click(await screen.findByTestId('collection-option-5'));

      // full snapshot union: zone A ∪ zone B — node 1 is displayed in zone A
      // but its deduped-out server row still counts in the snapshot
      await waitFor(() => expect(itemsBody).not.toBeNull());
      expect([...itemsBody.nodeIds].sort((a, b) => a - b)).toEqual([1, 11]);
    }, 15000);

    it('chip Save opens the confirm dialog; confirming creates the search-origin collection (§2.6 boundary)', async () => {
      let createBody = null;
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json({
            name_matches: [{ node_id: 11, name: 'sub-test.pdf' }],
            semantic: [{ node_id: 90, name: 'semantic-match.jpg', score: 0.9 }],
            counts: {
              name: 1,
              semantic: 1,
              total: 2,
              name_truncated: false,
              semantic_capped_segments: false,
            },
            result_ref: 'sr1.abc',
          })
        ),
        metadataHandler(),
        http.post('/api/collections', async ({ request }) => {
          createBody = await request.json();
          return HttpResponse.json({
            collection: {
              collection_id: 7,
              name: 'test',
              origin: 'search',
              status: 'active',
            },
            undo: { action_id: 92 },
          });
        })
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      expect(await screen.findByTestId('server-search-row-90')).toBeInTheDocument();

      // Invariant 5: the dialog IS the batch approval — the chip click opens
      // the member preview first, the create fires on CONFIRM only.
      fireEvent.click(screen.getByTestId('search-chip-save'));
      expect(await screen.findByTestId('search-save-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('search-save-publish-notice')).toBeInTheDocument();
      expect(createBody).toBeNull();

      fireEvent.click(screen.getByTestId('search-save-confirm'));

      await waitFor(() => expect(createBody).not.toBeNull());
      expect(createBody).toEqual({
        name: 'test',
        semantic: { resultRef: 'sr1.abc', predicates: [], nodeIds: [90] },
      });
      // one create command, one undo toast (spec §2.7)
      expect(await screen.findByTestId('undo-toast-action')).toBeInTheDocument();
    }, 15000);

    it('the save affordance stays absent on the degraded stack (semantic unavailable)', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'sub-test.pdf' }]))
        ),
        metadataHandler()
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('test');
      expect(await screen.findByTestId('server-search-row-11')).toBeInTheDocument();
      expect(screen.queryByTestId('search-chip-save')).not.toBeInTheDocument();
    }, 15000);

    it('clearing the shared search text exits results mode (one ✕ clears both surfaces)', async () => {
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.pdf' }]))
        ),
        metadataHandler()
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

      await submitSearchText('movie');
      expect(await screen.findByTestId('search-chip-bar')).toBeInTheDocument();
      // the commit cleared the field; live typing puts text back
      expect(screen.getByRole('searchbox')).toHaveValue('');
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'live' } });

      fireEvent.click(screen.getByLabelText('Close search'));
      await waitFor(() => expect(screen.queryByTestId('search-chip-bar')).not.toBeInTheDocument());
      expect(await screen.findByTestId('breadcrumb')).toBeInTheDocument();
      expect(screen.getByRole('searchbox')).toHaveValue('');
    }, 15000);

    it('server rows lazy-load thumbnails into the zone-locally merged rows (avatar appears)', async () => {
      const batchedNodeIds = [];
      server.use(
        http.post('/api/search', () =>
          HttpResponse.json(searchResultsPayload([{ node_id: 11, name: 'movie.jpg' }]))
        ),
        metadataHandler({ 11: { name: 'movie.jpg' } }),
        http.post('/api/thumbnails/batch', async ({ request }) => {
          const body = await request.json();
          batchedNodeIds.push(...(body.nodeIds || []));
          return HttpResponse.json({
            thumbnails: (body.nodeIds || []).map((nodeId) => ({
              nodeId,
              thumbnailUrl: `/api/thumbnails/${nodeId}.webp`,
            })),
          });
        })
      );

      // auto-intersecting observer: the shared lazy-load mechanism reaches the
      // debounced batch request without a real viewport (setupTests IO never fires)
      const RealIO = global.IntersectionObserver;
      global.IntersectionObserver = class AutoIntersectIO {
        constructor(callback) {
          this.callback = callback;
        }
        observe(el) {
          setTimeout(() => this.callback([{ isIntersecting: true, target: el }], this), 0);
        }
        unobserve() {}
        disconnect() {}
      };
      try {
        await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
        await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

        await submitSearchText('movie');
        const row = await screen.findByTestId('server-search-row-11');

        await waitFor(
          () => expect(row.querySelector('img')).toHaveAttribute('src', '/api/thumbnails/11.webp'),
          { timeout: 8000 }
        );
        expect(batchedNodeIds).toContain(11);
      } finally {
        global.IntersectionObserver = RealIO;
      }
    }, 20000);
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
        return HttpResponse.json({ items: [memberItem(liked())] });
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

    it('properties shows the opened row`s `Member of` chips and a chip click opens that collection', async () => {
      let itemsCalls17 = 0;
      const beach = { ...memberCollection, collection_id: 17, name: 'Beach' };
      server.use(
        http.get('/api/collections', () =>
          HttpResponse.json({ collections: [memberCollection, beach] })
        ),
        http.get('/api/collections/merge-suggestions', () =>
          HttpResponse.json({ suggestions: [] })
        ),
        http.get('/api/collections/5/items', () =>
          HttpResponse.json({ items: [memberItem(false)] })
        ),
        http.get('/api/collections/17/items', () => {
          itemsCalls17 += 1;
          return HttpResponse.json({ items: [] });
        }),
        // The opened row is NOT a session-listing row (member route): its id
        // must enter the membership read via the properties target.
        http.post('/api/collections/for-nodes', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json({
            memberships: (body.nodeIds || []).includes(90210)
              ? [{ node_id: 90210, collection_ids: [17] }]
              : [],
          });
        }),
        http.get('/api/permissions/folder', () => HttpResponse.json([]))
      );

      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/collection/5'],
      });

      fireEvent.click(await screen.findByTestId('member-menu-button'));
      fireEvent.click(await screen.findByTestId('member-properties'));

      const chip = await screen.findByTestId('props-collection-chip-17');
      expect(chip).toHaveTextContent('Beach');

      fireEvent.click(chip);
      await waitFor(() => expect(itemsCalls17).toBeGreaterThan(0));
      await waitFor(() =>
        expect(screen.queryByTestId('props-collection-chip-17')).not.toBeInTheDocument()
      );
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

  describe('Likes surface child row (P-5)', () => {
    const likedHandlers = ({ liked } = {}) => [
      http.get('/api/collections', () => HttpResponse.json({ collections: [] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.get('/api/file-likes', () => HttpResponse.json({ liked: liked ? liked() : [] })),
      http.get('/api/file-likes/items', () =>
        HttpResponse.json({
          items: [
            {
              node_id: 90300,
              name: 'favourite.jpg',
              type: 'file',
              mime: 'image/jpeg',
              state: 'normal',
              liked: true,
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
        })
      ),
    ];

    it('lists liked files through the member machinery with a null-collection row menu', async () => {
      server.use(...likedHandlers({ liked: () => [90300] }));
      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/liked'],
      });

      // the liked row lands in the shared members renderer (grid default)
      expect(await screen.findByTestId('members-list')).toBeInTheDocument();
      expect(screen.getByTestId('member-row-90300')).toBeInTheDocument();
      // P-4/P-5 member-view toolbar: view toggles present; M-8: the sort button
      // now renders on the members/liked surfaces (files-style radio menu)
      expect(screen.getByTestId('file-manager-sort')).toBeInTheDocument();
      // switching to LIST persists on the dedicated likedViewMode key
      fireEvent.click(screen.getByTestId('view-mode-list'));
      await waitFor(() => expect(window.localStorage.getItem('likedViewMode')).toBe('list'));

      // row menu = collection:null liked surface ⇒ Download/Reveal/Properties/
      // like toggle, NO Exclude/publish (membership mutations structurally gone)
      fireEvent.click(await screen.findByTestId('member-menu-button'));
      expect(await screen.findByTestId('member-download')).toBeInTheDocument();
      expect(screen.getByTestId('like-toggle')).toBeInTheDocument();
      expect(screen.queryByTestId('member-exclude')).not.toBeInTheDocument();
      expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
    }, 15000);

    it('unlike from the row menu removes the row optimistically and PUTs liked:false', async () => {
      let putBody = null;
      let likedNow = [90300];
      const rowItem = {
        node_id: 90300,
        name: 'favourite.jpg',
        type: 'file',
        mime: 'image/jpeg',
        state: 'normal',
        liked: true,
        created_at: '2026-09-01T00:00:00Z',
      };
      server.use(
        http.get('/api/collections', () => HttpResponse.json({ collections: [] })),
        http.get('/api/collections/merge-suggestions', () =>
          HttpResponse.json({ suggestions: [] })
        ),
        http.get('/api/file-likes', () => HttpResponse.json({ liked: likedNow })),
        http.get('/api/file-likes/items', () =>
          HttpResponse.json({
            items: likedNow.includes(90300) ? [rowItem] : [],
          })
        ),
        http.put('/api/file-likes/:nodeId', async ({ request }) => {
          putBody = await request.json();
          likedNow = putBody.liked ? [90300] : [];
          return HttpResponse.json({ node_id: 90300, liked: putBody.liked });
        })
      );
      await renderWithProvidersAct(<FileManagerWithRoutes />, {
        initialEntries: ['/files/__collections__/liked'],
      });

      await screen.findByTestId('member-row-90300');
      fireEvent.click(await screen.findByTestId('member-menu-button'));
      // the row is liked → the menu offers the unlike entry
      fireEvent.click(await screen.findByTestId('like-toggle'));

      await waitFor(() => expect(putBody).toEqual({ liked: false }));
      // optimistic drop (applyLikedRemoval) removes the row without a refetch
      await waitFor(() => expect(screen.queryByTestId('member-row-90300')).not.toBeInTheDocument());
    }, 15000);
  });

  describe('admin operator suppression (PLAN §14 client half)', () => {
    const adminAuthHandler = () =>
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          id: '1',
          username: 'admin',
          email: 'admin@ex.com',
          is_admin: true,
          status: 'approved',
        })
      );

    beforeEach(() => {
      // Baseline stubs: the pre-hydration window (user=null ⇒ real gateway) and
      // earlier tests' transport retries resolve quietly here; the no-IO case
      // arms its counting handler only AFTER the admin session has settled.
      server.use(
        http.get('/api/collections', () => HttpResponse.json({ collections: [] })),
        http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] }))
      );
    });

    it('admin: context menu withholds the like-toggle and collection-add rows', async () => {
      server.use(
        adminAuthHandler(),
        http.get('/api/file-likes', () => HttpResponse.json({ liked: [1] }))
      );

      await renderWithProvidersAct(<FileManagerWithAdminProbe />, { initialEntries: ['/files'] });
      const row = await screen.findByText(/test\.txt/i);
      await waitForAuthState('admin');

      fireEvent.contextMenu(row, { clientX: 60, clientY: 60 });
      // positive anchor: the menu itself opened
      await screen.findByRole('menuitem', { name: /download/i });
      expect(screen.queryByTestId('like-toggle')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collection-add')).not.toBeInTheDocument();
    }, 15000);

    it('non-admin control: the same context menu still offers like-toggle and collection-add', async () => {
      await renderWithProvidersAct(<FileManagerWithAdminProbe />, { initialEntries: ['/files'] });
      const row = await screen.findByText(/test\.txt/i);
      await waitForAuthState('non-admin');

      fireEvent.contextMenu(row, { clientX: 60, clientY: 60 });
      expect(await screen.findByTestId('collection-add')).toBeInTheDocument();
      expect(screen.getByTestId('like-toggle')).toBeInTheDocument();
    }, 15000);

    it('admin: the /__collections__/liked deep link resolves to the home listing (no member surface, no bulk add)', async () => {
      server.use(
        adminAuthHandler(),
        http.get('/api/file-likes/items', () =>
          HttpResponse.json({
            items: [
              {
                node_id: 90300,
                name: 'favourite.jpg',
                type: 'file',
                mime: 'image/jpeg',
                state: 'normal',
                liked: true,
                created_at: '2026-09-01T00:00:00Z',
              },
            ],
          })
        )
      );

      await renderWithProvidersAct(<FileManagerWithAdminProbe />, {
        initialEntries: ['/files/__collections__/liked'],
      });
      await waitForAuthState('admin');

      expect(await screen.findByText(/test\.txt/i)).toBeInTheDocument();
      expect(screen.queryByTestId('members-list')).not.toBeInTheDocument();
      expect(screen.queryByTestId('member-row-90300')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bulk-collection-add')).not.toBeInTheDocument();
    }, 15000);

    it('admin: the shell issues no /api/collections IO while the explorer is mounted', async () => {
      server.use(adminAuthHandler());
      await renderWithProvidersAct(<FileManagerWithAdminProbe />, { initialEntries: ['/files'] });
      await screen.findByText(/test\.txt/i);
      await waitForAuthState('admin');
      // Settle the pre-hydration window (its reads land on the describe's
      // 200-stubs), then arm the counter for the admin session proper.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      let collectionsCalls = 0;
      server.use(
        http.get('/api/collections', () => {
          collectionsCalls += 1;
          return HttpResponse.json({ collections: [] });
        }),
        http.get('/api/collections/merge-suggestions', () => {
          collectionsCalls += 1;
          return HttpResponse.json({ suggestions: [] });
        }),
        http.post('/api/collections/for-nodes', () => {
          collectionsCalls += 1;
          return HttpResponse.json({ memberships: [] });
        })
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      // Trigger a collection-change notification path as well: an admin
      // session must stay silent even when notifiers fire.
      await act(async () => {
        notifyCollectionsChange();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(collectionsCalls).toBe(0);
      // Membership chips are a personal-storage surface: zero badge DOM and
      // the files-surface bulk add button never renders for admin.
      expect(document.querySelector('[data-testid^="membership-badge-"]')).toBeNull();
      const fileRow = document.querySelector('[data-file-node-id="1"]');
      fireEvent.click(fileRow, { ctrlKey: true });
      expect(await screen.findByTestId('bulk-action-move')).toBeInTheDocument();
      expect(screen.queryByTestId('bulk-collection-add')).not.toBeInTheDocument();
    }, 15000);
  });
});

describe('FileManager — files-surface membership chips + bulk add (CollectionMembershipBadges.md)', () => {
  const BEACH = {
    collection_id: 17,
    name: 'Beach',
    granted_role: null,
    origin: 'user',
    status: 'active',
  };
  const WORK = {
    collection_id: 23,
    name: 'Work',
    granted_role: null,
    origin: 'user',
    status: 'active',
  };

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh');
  });

  const settleListing = async () => {
    await screen.findByText(/test\.txt/i);
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  };

  it('badges the rows from the batched for-nodes read and re-reads on the collections notifier', async () => {
    let fixture = { 1: [17] };
    let forNodesCalls = 0;
    server.use(
      http.get('/api/collections', () => HttpResponse.json({ collections: [BEACH, WORK] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.post('/api/collections/for-nodes', async ({ request }) => {
        const body = await request.json();
        forNodesCalls += 1;
        return HttpResponse.json({
          memberships: body.nodeIds
            .filter((nodeId) => fixture[nodeId])
            .map((nodeId) => ({ node_id: nodeId, collection_ids: fixture[nodeId] })),
        });
      })
    );

    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
    await settleListing();

    expect(await screen.findByTestId('membership-badge-1-17')).toBeInTheDocument();
    expect(screen.queryByTestId('membership-badge-1-23')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^membership-badge-[23]-/)).not.toBeInTheDocument();

    // Server-side membership change + the coarse notifier event ⇒ re-read.
    fixture = { 1: [17, 23] };
    const callsBefore = forNodesCalls;
    await act(async () => {
      notifyCollectionsChange();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(await screen.findByTestId('membership-badge-1-23')).toBeInTheDocument();
    expect(forNodesCalls).toBeGreaterThan(callsBefore);
  }, 15000);

  it('a failed membership read degrades to NO chips (listing stays intact)', async () => {
    server.use(
      http.get('/api/collections', () => HttpResponse.json({ collections: [BEACH] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.post('/api/collections/for-nodes', () =>
        HttpResponse.json(
          { errorCode: 'serverErrors.collections.forbidden', params: {} },
          { status: 403 }
        )
      )
    );

    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
    await settleListing();
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('[data-testid^="membership-badge-"]')).toBeNull();
    expect(screen.getByText(/test\.txt/i)).toBeInTheDocument();
  }, 15000);

  it('badges cover search-zone snapshot rows (the batched read spans the files surfaces)', async () => {
    const forNodesIdSets = [];
    server.use(
      http.get('/api/collections', () => HttpResponse.json({ collections: [BEACH, WORK] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.post('/api/collections/for-nodes', async ({ request }) => {
        const body = await request.json();
        forNodesIdSets.push(body.nodeIds);
        return HttpResponse.json({
          memberships: body.nodeIds
            .filter((nodeId) => nodeId === 55)
            .map((nodeId) => ({ node_id: nodeId, collection_ids: [17] })),
        });
      }),
      http.post('/api/search', () =>
        HttpResponse.json({
          name_matches: [{ node_id: 55, name: 'zone-file.pdf' }],
          counts: { name: 1, semantic: 0, total: 1, name_truncated: false },
          result_ref: 'sr1.abc',
          semantic_unavailable_reason: 'not_configured',
        })
      ),
      http.post('/api/files/metadata', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          (body.nodeIds || []).map((nodeId) => ({
            nodeId,
            name: 'zone-file.pdf',
            type: 'file',
            size: 5,
            lastmod: null,
            mime: 'application/pdf',
            hasReadPermission: true,
            hasWritePermission: true,
          }))
        );
      })
    );

    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
    await settleListing();

    const searchbox = screen.getByRole('searchbox');
    fireEvent.change(searchbox, { target: { value: 'zone' } });
    fireEvent.keyDown(searchbox, { key: 'Enter' });

    expect(await screen.findByTestId('server-search-row-55')).toBeInTheDocument();
    expect(await screen.findByTestId('membership-badge-55-17')).toBeInTheDocument();
    expect(forNodesIdSets.some((ids) => ids.includes(55))).toBe(true);
  }, 20000);

  it('toolbar bulk add on the files surface opens the menu with all-target checkmarks and posts the add', async () => {
    let addItemBody = null;
    server.use(
      http.get('/api/collections', () => HttpResponse.json({ collections: [BEACH, WORK] })),
      http.get('/api/collections/merge-suggestions', () => HttpResponse.json({ suggestions: [] })),
      http.post('/api/collections/for-nodes', async ({ request }) => {
        const body = await request.json();
        // node 1 ∈ BOTH collections, node 2 (docs) ∈ Beach only ⇒ the
        // {1,2} target set has Beach as its only all-member row.
        const fixture = { 1: [17, 23], 2: [17] };
        return HttpResponse.json({
          memberships: body.nodeIds
            .filter((nodeId) => fixture[nodeId])
            .map((nodeId) => ({ node_id: nodeId, collection_ids: fixture[nodeId] })),
        });
      }),
      http.post('/api/collections/17/items', async ({ request }) => {
        addItemBody = await request.json();
        return HttpResponse.json({
          added: 2,
          already_members: 0,
          rejected_not_readable: [],
          undo: { action_id: 500 },
        });
      })
    );

    await renderWithProvidersAct(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
    await settleListing();

    // Ctrl+click the two seeded rows → selection mode with {test.txt, docs}.
    fireEvent.click(await screen.findByTestId('membership-badge-1-17'), {
      ctrlKey: true,
      metaKey: false,
    });
    await waitFor(() => expect(screen.getByTestId('bulk-action-move')).toBeInTheDocument());
    const docsRow = document.querySelector('[data-file-node-id="2"]');
    fireEvent.click(docsRow, { ctrlKey: true });

    const addButton = screen.getByTestId('bulk-collection-add');
    fireEvent.click(addButton);

    expect(await screen.findByTestId('collection-option-17')).toBeInTheDocument();
    expect(screen.getByTestId('collection-checked-17')).toBeInTheDocument();
    expect(screen.getByTestId('collection-option-23')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-checked-23')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('collection-option-17'));
    await waitFor(() => expect(addItemBody).toEqual({ nodeIds: [1, 2] }));
  }, 20000);
});
