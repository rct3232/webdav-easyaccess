/**
 * MetadataMigrationDialog tests.
 * Verifies the target-scan → wipe-alert → explicit confirm → start flow per
 * docs/features/migration-mode.md (D5) and docs/spec/server/tools/
 * metadata-migration.md: connection fields per target backend, scan results,
 * wipe alert gating Start until confirmed, and start → close → /migration.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MetadataMigrationDialog from '../MetadataMigrationDialog';

let currentPath = null;
function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname;
  return null;
}

function renderDialog(options = {}) {
  const { open = true, onClose = jest.fn(), onMessage = jest.fn() } = options;
  return {
    onClose,
    onMessage,
    ...renderWithProviders(
      <>
        <MetadataMigrationDialog open={open} onClose={onClose} onMessage={onMessage} />
        <LocationProbe />
      </>
    ),
  };
}

async function fillPgFields(user) {
  await user.type(await screen.findByLabelText(/host \*/i), 'db.local');
  await user.type(screen.getByLabelText(/database \*/i), 'webdav');
  await user.type(screen.getByLabelText(/user \*/i), 'admin');
  await user.type(screen.getByLabelText(/password \*/i), 'secret');
}

const emptyTargetScan = {
  backend: 'postgresql',
  connected: true,
  schemaExists: true,
  tables: [
    { name: 'users', rows: 0 },
    { name: 'file_nodes', rows: 0 },
  ],
  totalRows: 0,
};

const populatedTargetScan = {
  backend: 'postgresql',
  connected: true,
  schemaExists: true,
  tables: [
    { name: 'users', rows: 3 },
    { name: 'file_nodes', rows: 10 },
  ],
  totalRows: 13,
};

describe('MetadataMigrationDialog', () => {
  beforeEach(() => {
    currentPath = null;
  });

  it('renders PostgreSQL connection fields by default', async () => {
    renderDialog();

    expect(await screen.findByLabelText(/host \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/port/i)).toHaveValue(5432);
    expect(screen.getByLabelText(/database \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/user \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password \*/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/sqlite path \*/i)).not.toBeInTheDocument();
  });

  it('switches to the SQLite path field when the sqlite target is selected', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByLabelText(/host \*/i);
    await user.click(screen.getByRole('radio', { name: /sqlite/i }));

    expect(screen.getByLabelText(/sqlite path \*/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/host \*/i)).not.toBeInTheDocument();
  });

  it('blocks scan until the required target fields are filled', async () => {
    let scanCalled = false;
    server.use(
      http.get('/api/admin/migration/target-scan', () => {
        scanCalled = true;
        return HttpResponse.json(emptyTargetScan);
      })
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByLabelText(/host \*/i);
    await user.click(screen.getByRole('button', { name: /scan target/i }));

    expect(await screen.findByText(/please fill in all required fields/i)).toBeInTheDocument();
    expect(scanCalled).toBe(false);
  });

  it('scans the target and reports an empty schema', async () => {
    server.use(http.get('/api/admin/migration/target-scan', () => HttpResponse.json(emptyTargetScan)));

    const user = userEvent.setup();
    renderDialog();
    await screen.findByLabelText(/host \*/i);
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /scan target/i }));

    expect(await screen.findByText(/schema exists but contains no data/i)).toBeInTheDocument();
    expect(screen.queryByTestId('metadata-wipe-alert')).not.toBeInTheDocument();
  });

  it('reports that a target without a schema will be created during the migration', async () => {
    server.use(
      http.get('/api/admin/migration/target-scan', () =>
        HttpResponse.json({
          backend: 'postgresql',
          connected: true,
          schemaExists: false,
          tables: [],
          totalRows: 0,
        })
      )
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByLabelText(/host \*/i);
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /scan target/i }));

    expect(await screen.findByText(/has no schema — it will be created during the migration/i)).toBeInTheDocument();
    expect(screen.queryByTestId('metadata-wipe-alert')).not.toBeInTheDocument();
  });

  it('shows a wipe alert and requires explicit confirmation before start when the target holds data', async () => {
    let scanParams = null;
    let startBody = null;
    server.use(
      http.get('/api/admin/migration/target-scan', ({ request }) => {
        const url = new URL(request.url);
        scanParams = {
          targetBackend: url.searchParams.get('targetBackend'),
          host: url.searchParams.get('host'),
          port: url.searchParams.get('port'),
          database: url.searchParams.get('database'),
        };
        return HttpResponse.json(populatedTargetScan);
      }),
      http.post('/api/admin/migration/metadata', async ({ request }) => {
        startBody = await request.json();
        return HttpResponse.json({ jobId: 'meta-1' }, { status: 202 });
      })
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByLabelText(/host \*/i);
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /scan target/i }));

    const alert = await screen.findByTestId('metadata-wipe-alert');
    expect(within(alert).getByText(/users: 3/i)).toBeInTheDocument();
    expect(within(alert).getByText(/file_nodes: 10/i)).toBeInTheDocument();
    expect(scanParams).toEqual({ targetBackend: 'postgresql', host: 'db.local', port: '5432', database: 'webdav' });

    // Start stays disabled until the wipe is confirmed.
    const startButton = screen.getByRole('button', { name: /^start migration$/i });
    expect(startButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /existing target data will be deleted/i }));
    expect(startButton).toBeEnabled();

    await user.click(startButton);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(currentPath).toBe('/migration');
    });
    expect(startBody).toEqual({
      targetBackend: 'postgresql',
      pg: {
        host: 'db.local',
        port: 5432,
        database: 'webdav',
        user: 'admin',
        password: 'secret',
        ssl: false,
      },
      wipeTarget: true,
    });
  });

  it('shows an inline error when start is rejected because wipeTarget is missing', async () => {
    server.use(
      http.get('/api/admin/migration/target-scan', () => HttpResponse.json(populatedTargetScan)),
      http.post('/api/admin/migration/metadata', () =>
        HttpResponse.json({ errorCode: 'serverErrors.admin.migrationMissingRequired' }, { status: 400 })
      )
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByLabelText(/host \*/i);
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /scan target/i }));
    await screen.findByTestId('metadata-wipe-alert');
    await user.click(screen.getByRole('checkbox', { name: /existing target data will be deleted/i }));
    await user.click(screen.getByRole('button', { name: /^start migration$/i }));

    expect(await screen.findByText(/missing required destination fields/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(currentPath).not.toBe('/migration');
  });
});
