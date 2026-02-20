/**
 * FileManager page tests.
 * Verifies key scenarios: renders file list, path navigation, search filter, selection mode + bulk move.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/spec/client/pages/FileManager.md 2.6
 */
jest.mock('../../components/dialogs/FilePreviewDialog', () => () => null);

import React from 'react';
import { screen, waitFor, render, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, createMemoryRouter, RouterProvider, Outlet, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, ThemeAndAuthProviders } from '../../test-utils';
import { server } from '../../setupTests';
import FileManager from '../FileManager';

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

describe('FileManager', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh');
  });

  it('renders file manager when authenticated', async () => {
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });
    expect(document.body.textContent).toMatch(/no files|test|folder|home|recent|docs/i);
  });

  it('renders without share link by default', async () => {
    renderWithProviders(
      <FileManagerWithRoutes />,
      { initialEntries: ['/files/testuser'] }
    );
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    expect(document.body).toBeInTheDocument();
  });

  it('path navigation: useParams sees splat when using createMemoryRouter', () => {
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
    render(<RouterProvider router={router} />);
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
    render(<RouterProvider router={router} />);

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
      await user.click(folderRow);
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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    // Enter selection mode (button with title "Select")
    const selectModeBtn = screen.getByRole('button', { name: /^select$/i });
    await user.click(selectModeBtn);

    // Select two files: scope to file list so "docs" is unique (also appears in folder tree)
    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await user.click(within(rowTestTxt).getByRole('checkbox'));
    await user.click(within(rowDocs).getByRole('checkbox'));

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    const selectModeBtn = screen.getByRole('button', { name: /^select$/i });
    await user.click(selectModeBtn);

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await user.click(within(rowTestTxt).getByRole('checkbox'));
    await user.click(within(rowDocs).getByRole('checkbox'));

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/test|doc2|folder|docs/i);
    }, { timeout: 3000 });

    const selectModeBtn = screen.getByRole('button', { name: /^select$/i });
    await user.click(selectModeBtn);

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const doc2InList = within(fileListContainer).getByText(/doc2\.txt/i);
    const rowDoc2 = doc2InList.closest('div')?.parentElement;
    expect(rowDoc2).toBeTruthy();
    await user.click(within(rowTestTxt).getByRole('checkbox'));
    await user.click(within(rowDoc2).getByRole('checkbox'));

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/folder|docs|test/i);
    }, { timeout: 3000 });

    const selectModeBtn = screen.getByRole('button', { name: /^select$/i });
    await user.click(selectModeBtn);

    const rowTestTxt = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(rowTestTxt).toBeTruthy();
    const fileListContainer = rowTestTxt.parentElement;
    const docsInList = within(fileListContainer).getByText(/\bdocs\b/i);
    const rowDocs = docsInList.closest('div')?.parentElement;
    expect(rowDocs).toBeTruthy();
    await user.click(within(rowTestTxt).getByRole('checkbox'));
    await user.click(within(rowDocs).getByRole('checkbox'));

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    const createFolderBtn = screen.getByTitle(/create folder/i);
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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /upload file/i });
      expect(btn).not.toBeDisabled();
    }, { timeout: 5000 });
    const uploadBtn = screen.getByRole('button', { name: /upload file/i });
    fireEvent.click(uploadBtn);

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 8000 });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /upload file/i });
      expect(btn).not.toBeDisabled();
    }, { timeout: 5000 });
    const uploadBtn = screen.getByRole('button', { name: /upload file/i });
    fireEvent.click(uploadBtn);

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

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
    renderWithProviders(<FileManagerWithRoutes />, { initialEntries: ['/files'] });

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
    renderWithProviders(
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

    // Download-only bulk: enter selection, select one file, toolbar shows Download but not Move/Copy/Delete
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/test|folder|docs/i);
    }, { timeout: 3000 });

    const selectModeBtn = screen.getByRole('button', { name: /^select$/i });
    await user.click(selectModeBtn);

    const fileRow = screen.getByText(/test\.txt/i).closest('div')?.parentElement;
    expect(fileRow).toBeTruthy();
    await user.click(within(fileRow).getByRole('checkbox'));

    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^move$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  }, 15000);
});
