/**
 * AdminReportsContent tests.
 * Covers the rendering contract, payload detail mining, the repair visibility
 * matrix, busy scoping, snackbar + re-fetch feedback and the inline error
 * paths per spec.
 * @see docs/spec/client/components/mypage/content/AdminReportsContent.md
 * @see docs/spec/server/routes/admin.md §2.2.6
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import AdminReportsContent from '../AdminReportsContent';

const CHECKED_AT = '2026-09-03T01:00:00.000Z';

function failsafeRow(overrides = {}) {
  return {
    id: 1,
    kind: 'failsafe',
    status: 'partial',
    created_at: '2026-09-03T01:00:00.000Z',
    payload: {
      scanned: 3,
      resolved: 0,
      manualReview: [
        { nodeId: 7, path: '/alice/ghost.txt' },
        { nodeId: null, path: '/ghost-nodeless' },
      ],
      pendingUpload: {
        scanned: 1,
        nodes: [
          {
            nodeId: 8,
            name: 'doc.pdf',
            type: 'file',
            path: '/bob/doc.pdf',
            createdAt: CHECKED_AT,
            updatedAt: CHECKED_AT,
            classification: 'new-file',
            pendingS3Key: '.wea-pending/8',
            blobPresent: true,
          },
        ],
      },
      contentHashCompleteness: { nullCount: 5, checkedAt: CHECKED_AT },
    },
    ...overrides,
  };
}

function gcRow(overrides = {}) {
  return {
    id: 11,
    kind: 'gc',
    status: 'ok',
    created_at: '2026-09-04T02:00:00.000Z',
    payload: {
      tier1: {
        orphanedRows: 1,
        guardedRows: 0,
        deletedBlobs: 2,
        deletedRows: 3,
        pendingDeletedRows: 0,
        errors: [],
      },
      tier2: { scannedKeys: 4, untrackedKeys: 1, deletedKeys: 1, skipped: false, errors: [] },
      tier3: { purgedNodes: 0, deletedBlobs: 0, deletedRows: 0, skipped: true, errors: [] },
    },
    ...overrides,
  };
}

function cleanupRow(overrides = {}) {
  return {
    id: 21,
    kind: 'cleanup',
    status: 'partial',
    created_at: '2026-09-05T03:00:00.000Z',
    payload: {
      errors: ['Failed to scan pending_upload nodes: boom'],
      gc: {
        tier1: {
          orphanedRows: 0,
          guardedRows: 0,
          deletedBlobs: 0,
          deletedRows: 0,
          pendingDeletedRows: 0,
          errors: [],
        },
        tier2: { scannedKeys: 0, untrackedKeys: 0, deletedKeys: 0, skipped: false, errors: [] },
        tier3: { purgedNodes: 1, deletedBlobs: 1, deletedRows: 2, skipped: false, errors: [] },
      },
      orphanedNodes: [{ nodeId: 31, path: '/orphan/a' }],
      pendingUploadNodes: [
        {
          nodeId: 32,
          name: 'stuck.bin',
          type: 'file',
          path: '/orphan/stuck.bin',
          createdAt: CHECKED_AT,
          updatedAt: CHECKED_AT,
          classification: 'overwrite',
          pendingS3Key: '.wea-pending/32',
          blobPresent: false,
        },
      ],
    },
    ...overrides,
  };
}

function renderContent(onSnackbar = jest.fn()) {
  renderWithProviders(<AdminReportsContent onSnackbar={onSnackbar} />);
  return onSnackbar;
}

async function renderWithList(rows) {
  const listCalls = { n: 0 };
  server.use(
    http.get('/api/admin/reports', () => {
      listCalls.n += 1;
      return HttpResponse.json({ reports: rows });
    })
  );
  renderContent();
  await userEvent.click(screen.getByTestId('admin-reports-refresh'));
  await waitFor(() => expect(listCalls.n).toBeGreaterThan(0));
  return listCalls;
}

describe('AdminReportsContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches nothing on mount and loads the list only on refresh', async () => {
    let listCalls = 0;
    server.use(
      http.get('/api/admin/reports', () => {
        listCalls += 1;
        return HttpResponse.json({ reports: [gcRow()] });
      })
    );

    renderContent();

    expect(await screen.findByTestId('admin-reports-section')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reports-refresh')).toBeInTheDocument();
    expect(listCalls).toBe(0);

    await userEvent.click(screen.getByTestId('admin-reports-refresh'));

    expect(await screen.findByTestId('admin-reports-row-11')).toBeInTheDocument();
    expect(listCalls).toBe(1);
  });

  it('renders rows with localized created_at, kind/status chips and per-kind summaries in list order', async () => {
    await renderWithList([failsafeRow(), gcRow(), cleanupRow()]);

    const rowFailsafe = await screen.findByTestId('admin-reports-row-1');
    const rowGc = screen.getByTestId('admin-reports-row-11');
    const rowCleanup = screen.getByTestId('admin-reports-row-21');

    // Server order preserved (newest first as returned).
    expect(
      rowFailsafe.compareDocumentPosition(rowGc) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      rowGc.compareDocumentPosition(rowCleanup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // created_at localized.
    expect(rowFailsafe).toHaveTextContent(new Date('2026-09-03T01:00:00.000Z').toLocaleString());

    // kind label chips.
    expect(within(rowFailsafe).getByText('Fail-safe')).toBeInTheDocument();
    expect(within(rowGc).getByText('GC')).toBeInTheDocument();
    expect(within(rowCleanup).getByText('Cleanup')).toBeInTheDocument();

    // status tone chips.
    expect(within(rowFailsafe).getByText('Partial').closest('.MuiChip-root')).toHaveClass(
      'MuiChip-colorWarning'
    );
    expect(within(rowGc).getByText('OK').closest('.MuiChip-root')).toHaveClass(
      'MuiChip-colorSuccess'
    );

    // one-line summaries mined per kind.
    expect(rowFailsafe).toHaveTextContent(
      'Scanned 3, resolved 0, manual review 2, pending upload 1, missing content hashes 5.'
    );
    expect(rowGc).toHaveTextContent(
      'GC removed 2 blob(s) / 3 row(s) / 1 key(s); 0 node(s) purged.'
    );
    expect(rowCleanup).toHaveTextContent(
      'Cleanup: 1 orphaned, 1 pending-upload node(s) reported, 1 error(s).'
    );
  });

  it('renders a migration row label-only: no summary, no detail toggle', async () => {
    await renderWithList([
      { id: 41, kind: 'migration', status: 'ok', payload: null, created_at: CHECKED_AT },
    ]);

    const row = await screen.findByTestId('admin-reports-row-41');
    expect(within(row).getByText('Migration')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-expand-41')).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent(/Scanned|GC removed|Cleanup:/);
  });

  it('expands the payload detail with tier counts, node lists and the content-hash section', async () => {
    const user = userEvent.setup();
    await renderWithList([failsafeRow(), gcRow()]);
    await screen.findByTestId('admin-reports-row-1');

    // Detail is unmounted until expanded.
    expect(screen.queryByText('/alice/ghost.txt')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('admin-reports-expand-1'));
    expect(screen.getByText('/alice/ghost.txt')).toBeInTheDocument();
    expect(screen.getByText('/ghost-nodeless')).toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('admin-reports-row-1')).getByText(/^Missing content hashes/)
    ).toHaveTextContent(/5/);
    expect(screen.getByText(/^Checked at/)).toBeInTheDocument();

    await user.click(screen.getByTestId('admin-reports-expand-1'));
    expect(screen.queryByText('/alice/ghost.txt')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('admin-reports-expand-11'));
    expect(screen.getByText(/Tier 1/)).toBeInTheDocument();
    expect(
      screen.getByText('orphaned 1, guarded 0, deleted 2 blob(s) / 3 row(s), pending 0')
    ).toBeInTheDocument();
    expect(screen.getByText('scanned 4, untracked 1, deleted 1 key(s)')).toBeInTheDocument();
  });

  it('shows the backfill button iff kind=failsafe with a contentHashCompleteness section and a finite nullCount > 0', async () => {
    await renderWithList([
      failsafeRow({ id: 101 }),
      failsafeRow({
        id: 102,
        payload: {
          ...failsafeRow().payload,
          contentHashCompleteness: { nullCount: 0, checkedAt: CHECKED_AT },
        },
        status: 'ok',
      }),
      failsafeRow({
        id: 103,
        payload: {
          ...failsafeRow().payload,
          contentHashCompleteness: {
            nullCount: null,
            checkedAt: CHECKED_AT,
            error: 'count failed',
          },
        },
      }),
      cleanupRow({
        id: 104,
        payload: { ...cleanupRow().payload, contentHashCompleteness: { nullCount: 9 } },
      }),
      gcRow({ id: 105 }),
    ]);

    expect(await screen.findByTestId('admin-reports-backfill-101')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-backfill-102')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-backfill-103')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-backfill-104')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-backfill-105')).not.toBeInTheDocument();
    // A failed count renders the unknown marker, not a number.
    expect(screen.getByTestId('admin-reports-row-103')).toHaveTextContent(/n\/a/);
  });

  it('renders per-node repair actions only for entries with a finite nodeId', async () => {
    const user = userEvent.setup();
    await renderWithList([failsafeRow(), cleanupRow()]);
    await screen.findByTestId('admin-reports-row-1');

    await user.click(screen.getByTestId('admin-reports-expand-1'));
    await user.click(screen.getByTestId('admin-reports-expand-21'));

    // failsafe: nodeId 7 (manualReview) + nodeId 8 (pendingUpload.nodes); the null-nodeId entry gets none.
    expect(screen.getByTestId('admin-reports-node-repair-7')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reports-node-purge-7')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reports-node-repair-8')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reports-node-purge-8')).toBeInTheDocument();
    // cleanup: orphanedNodes 31 + pendingUploadNodes 32.
    expect(screen.getByTestId('admin-reports-node-repair-31')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reports-node-purge-32')).toBeInTheDocument();

    expect(screen.queryByTestId('admin-reports-node-repair-null')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-node-purge-null')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^admin-reports-node-repair-/)).toHaveLength(4);
    expect(screen.queryAllByTestId(/^admin-reports-node-purge-/)).toHaveLength(4);
  });

  it('content_hash success: re-renders the expanded row, notifies and re-fetches the list', async () => {
    const user = userEvent.setup();
    const onSnackbar = jest.fn();
    let rows = [failsafeRow()];
    let listCalls = 0;
    server.use(
      http.get('/api/admin/reports', () => {
        listCalls += 1;
        return HttpResponse.json({ reports: rows });
      }),
      http.post('/api/admin/reports/:id/repair', () => {
        const report = {
          ...rows[0],
          status: 'ok',
          payload: {
            ...rows[0].payload,
            contentHashCompleteness: {
              nullCount: 0,
              checkedAt: '2026-09-06T00:00:00.000Z',
              backfilled: 5,
              backfilledAt: '2026-09-06T00:00:00.000Z',
            },
          },
        };
        rows = [report];
        return HttpResponse.json({
          messageCode: 'serverMessages.admin.reportRepaired',
          report,
          result: {
            backfilled: 5,
            nullCount: 0,
            errors: [],
            checkedAt: '2026-09-06T00:00:00.000Z',
          },
        });
      })
    );

    renderContent(onSnackbar);
    await user.click(await screen.findByTestId('admin-reports-refresh'));
    await screen.findByTestId('admin-reports-row-1');
    await user.click(screen.getByTestId('admin-reports-expand-1'));
    expect(
      within(screen.getByTestId('admin-reports-row-1')).getByText(/^Missing content hashes/)
    ).toHaveTextContent(/5/);

    await user.click(screen.getByTestId('admin-reports-backfill-1'));

    await waitFor(() =>
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: 'Report repair completed.' })
      )
    );
    expect(listCalls).toBe(2);
    // The expanded row keeps its state and shows the re-rendered section.
    expect(
      within(screen.getByTestId('admin-reports-row-1')).getByText(/^Missing content hashes/)
    ).toHaveTextContent(/0/);
    expect(screen.getByText(/^Backfilled/)).toHaveTextContent(/5/);
    expect(within(screen.getByTestId('admin-reports-row-1')).getByText('OK')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-reports-backfill-1')).not.toBeInTheDocument();
  });

  it('repair-sync sends { action, nodeId, repairAction: auto }, notifies and re-fetches with the row unchanged', async () => {
    const user = userEvent.setup();
    const onSnackbar = jest.fn();
    let postedBody;
    let listCalls = 0;
    const row = cleanupRow();
    server.use(
      http.get('/api/admin/reports', () => {
        listCalls += 1;
        return HttpResponse.json({ reports: [row] });
      }),
      http.post('/api/admin/reports/:id/repair', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          messageCode: 'serverMessages.admin.repairSyncDone',
          report: row,
          result: {
            nodeId: 31,
            action: 'auto',
            status: 'resolved',
            path: '/orphan/a',
            detail: 'ok',
          },
        });
      })
    );

    renderContent(onSnackbar);
    await user.click(await screen.findByTestId('admin-reports-refresh'));
    await user.click(await screen.findByTestId('admin-reports-expand-21'));
    await user.click(screen.getByTestId('admin-reports-node-repair-31'));

    expect(postedBody).toEqual({ action: 'repair-sync', nodeId: 31, repairAction: 'auto' });
    await waitFor(() =>
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: 'Repair action completed.' })
      )
    );
    expect(listCalls).toBe(2);
    // Row returned unchanged: same summary still rendered.
    expect(screen.getByTestId('admin-reports-row-21')).toHaveTextContent(
      'Cleanup: 1 orphaned, 1 pending-upload node(s) reported, 1 error(s).'
    );
  });

  it('perm-delete runs behind the shared confirm dialog; cancel dispatches nothing, confirm notifies and re-fetches', async () => {
    const user = userEvent.setup();
    const onSnackbar = jest.fn();
    let postedBody;
    let postCalls = 0;
    let listCalls = 0;
    const row = cleanupRow();
    server.use(
      http.get('/api/admin/reports', () => {
        listCalls += 1;
        return HttpResponse.json({ reports: [row] });
      }),
      http.post('/api/admin/reports/:id/repair', async ({ request }) => {
        postCalls += 1;
        postedBody = await request.json();
        return HttpResponse.json({
          messageCode: 'serverMessages.admin.permDeleteDone',
          report: row,
          result: { nodeId: 31, deletedCount: 3 },
        });
      })
    );

    renderContent(onSnackbar);
    await user.click(await screen.findByTestId('admin-reports-refresh'));
    await user.click(await screen.findByTestId('admin-reports-expand-21'));
    await user.click(screen.getByTestId('admin-reports-node-purge-31'));

    const dialog = await screen.findByRole('dialog', { name: /delete permanently/i });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText('Permanently delete /orphan/a? This cannot be undone.')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /delete permanently/i })).not.toBeInTheDocument()
    );
    expect(postCalls).toBe(0);

    await user.click(screen.getByTestId('admin-reports-node-purge-31'));
    await screen.findByRole('dialog', { name: /delete permanently/i });
    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(postedBody).toEqual({ action: 'perm-delete', nodeId: 31, repairAction: undefined });
    await waitFor(() =>
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: 'Item permanently deleted' })
      )
    );
    expect(listCalls).toBe(2);
  });

  it('renders the translated 400 repairNotAvailable inline error and skips the re-fetch', async () => {
    const user = userEvent.setup();
    const onSnackbar = jest.fn();
    let listCalls = 0;
    server.use(
      http.get('/api/admin/reports', () => {
        listCalls += 1;
        return HttpResponse.json({ reports: [failsafeRow()] });
      }),
      http.post('/api/admin/reports/:id/repair', () =>
        HttpResponse.json(
          { errorCode: 'serverErrors.admin.repairNotAvailable', params: {} },
          { status: 400 }
        )
      )
    );

    renderContent(onSnackbar);
    await user.click(await screen.findByTestId('admin-reports-refresh'));
    await user.click(await screen.findByTestId('admin-reports-backfill-1'));

    const alert = await screen.findByTestId('admin-reports-repair-error');
    expect(alert).toHaveTextContent('No repair action is available for this report.');
    expect(listCalls).toBe(1);
    expect(onSnackbar).not.toHaveBeenCalled();
  });

  it('scopes the busy affordance to the dispatched control only', async () => {
    const user = userEvent.setup();
    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    const rows = [failsafeRow({ id: 1 }), failsafeRow({ id: 2 })];
    server.use(
      http.get('/api/admin/reports', () => HttpResponse.json({ reports: rows })),
      http.post('/api/admin/reports/:id/repair', async () => {
        await hold;
        return HttpResponse.json({
          messageCode: 'serverMessages.admin.reportRepaired',
          report: rows[0],
          result: {},
        });
      })
    );

    renderContent();
    await user.click(await screen.findByTestId('admin-reports-refresh'));
    await screen.findByTestId('admin-reports-row-1');
    await screen.findByTestId('admin-reports-row-2');

    await user.click(screen.getByTestId('admin-reports-backfill-1'));

    const busyButton = screen.getByTestId('admin-reports-backfill-1');
    expect(busyButton).toBeDisabled();
    expect(busyButton.querySelector('.MuiCircularProgress-root')).not.toBeNull();
    expect(screen.getByTestId('admin-reports-backfill-2')).toBeEnabled();

    release();
    await waitFor(() => expect(screen.getByTestId('admin-reports-backfill-1')).toBeEnabled());
    expect(screen.getByTestId('admin-reports-backfill-2')).toBeEnabled();
  });

  it('renders the empty state after a successful refresh with no rows', async () => {
    await renderWithList([]);
    expect(await screen.findByText('No admin reports yet.')).toBeInTheDocument();
  });

  it('renders a translated inline alert when the list request fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/admin/reports', () =>
        HttpResponse.json({ error: 'Reports unavailable' }, { status: 500 })
      )
    );

    renderContent();
    await user.click(await screen.findByTestId('admin-reports-refresh'));

    const alert = await screen.findByTestId('admin-reports-error');
    expect(alert).toHaveTextContent('Reports unavailable');
  });

  it('routes repair success text through the page snackbar callback', async () => {
    const user = userEvent.setup();
    const onSnackbar = jest.fn();
    const row = cleanupRow();
    server.use(
      http.get('/api/admin/reports', () => HttpResponse.json({ reports: [row] })),
      http.post('/api/admin/reports/:id/repair', () =>
        HttpResponse.json({
          messageCode: 'serverMessages.admin.repairSyncDone',
          report: row,
          result: { nodeId: 31 },
        })
      )
    );

    renderContent(onSnackbar);
    await user.click(await screen.findByTestId('admin-reports-refresh'));
    await user.click(await screen.findByTestId('admin-reports-expand-21'));
    await user.click(screen.getByTestId('admin-reports-node-repair-31'));

    await waitFor(() => expect(onSnackbar).toHaveBeenCalled());
    expect(onSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: 'Repair action completed.' })
    );
  });
});
