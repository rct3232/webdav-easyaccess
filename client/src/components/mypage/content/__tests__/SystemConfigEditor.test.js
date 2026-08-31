/**
 * SystemConfigEditor tests.
 * Verifies grouping + read-only env/T0 rows, masked secrets with set-new-value
 * toggle, dirty-tracked save (only changed keys), applied vs restartRequired
 * feedback, and blank-secret skipping.
 * @see docs/spec/client/components/SystemConfigEditor.md
 * @see docs/spec/server/routes/config.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import SystemConfigEditor from '../SystemConfigEditor';

const makeConfig = (overrides = {}) => ({
  WEA_PG_HOST: { value: 'db.internal', source: 'env', tier: 'T0', secret: false },
  WEA_PG_PORT: { value: '5432', source: 'default', tier: 'T0', secret: false },
  WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
  PORT: { value: '5001', source: 'default', tier: 'T1', secret: false },
  EMAIL_HOST: { value: 'smtp.gmail.com', source: 'db', tier: 'T2', secret: false },
  EMAIL_PORT: { value: '587', source: 'db', tier: 'T2', secret: false },
  EMAIL_PASSWORD: { value: '****', source: 'db', tier: 'T2', secret: true },
  ...overrides,
});

const mockGetConfig = (config) => {
  server.use(
    http.get('/api/admin/config', () => HttpResponse.json({ config }))
  );
};

const mockPutConfig = (responder) => {
  server.use(
    http.put('/api/admin/config', async ({ request }) => {
      const body = await request.json();
      return responder(body);
    })
  );
};

const defaultPutResponse = () => ({
  applied: [],
  restartRequired: [],
  messageCode: 'serverMessages.admin.configSaved',
});

function renderEditor({ config = makeConfig(), onSnackbar } = {}) {
  mockGetConfig(config);
  const snackbar = onSnackbar || jest.fn();
  renderWithProviders(<SystemConfigEditor active onSnackbar={snackbar} />);
  return snackbar;
}

describe('SystemConfigEditor', () => {
  it('renders groups and disables env/T0 read-only rows', async () => {
    renderEditor();

    expect(await screen.findByText(/metadata/i)).toBeInTheDocument();
    expect(screen.getAllByText(/file storage/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/server & security/i)).toBeInTheDocument();
    expect(screen.getByText(/email/i)).toBeInTheDocument();
    // No runtime keys in the config → group skipped.
    expect(screen.queryByText(/^runtime$/i)).not.toBeInTheDocument();

    const pgHost = screen.getByLabelText(/postgresql host/i);
    expect(pgHost).toBeDisabled();
    expect(screen.getAllByText(/set in .env/i).length).toBeGreaterThan(0);

    const port = screen.getByLabelText(/server port/i);
    expect(port).not.toBeDisabled();
  });

  it('masks secrets and reveals a set-new-value field on toggle', async () => {
    renderEditor();

    expect(await screen.findByDisplayValue('****')).toBeInTheDocument();

    const setNewValueButton = screen.getByRole('button', { name: /set new value/i });
    await userEvent.click(setNewValueButton);

    const secretField = screen.getByLabelText(/set new value/i);
    expect(secretField).toBeInTheDocument();
    await userEvent.type(secretField, 'new-pass');
    expect(secretField).toHaveValue('new-pass');
  });

  it('sends only changed keys on save and reports success via onSnackbar', async () => {
    let putBody;
    mockPutConfig((body) => {
      putBody = body;
      return HttpResponse.json({ applied: ['EMAIL_HOST'], restartRequired: [], messageCode: 'serverMessages.admin.configSaved' });
    });
    const onSnackbar = renderEditor();

    const saveButton = await screen.findByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();

    const host = screen.getByLabelText(/smtp host/i);
    await userEvent.clear(host);
    await userEvent.type(host, 'smtp.example.com');
    expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(putBody).toEqual({ values: { EMAIL_HOST: 'smtp.example.com' } });
    });
    expect(onSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('shows a restart-required banner listing T1 keys after save', async () => {
    mockPutConfig(() =>
      HttpResponse.json({ applied: ['EMAIL_HOST'], restartRequired: ['PORT'], messageCode: 'serverMessages.admin.configSaved' })
    );
    renderEditor();

    const port = await screen.findByLabelText(/server port/i);
    await userEvent.clear(port);
    await userEvent.type(port, '6000');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByTestId('config-restart-banner')).toBeInTheDocument();
    expect(screen.getByText(/PORT/)).toBeInTheDocument();
  });

  it('shows an applied-immediately banner listing T2 keys after save', async () => {
    mockPutConfig(() =>
      HttpResponse.json({ applied: ['EMAIL_HOST'], restartRequired: [], messageCode: 'serverMessages.admin.configSaved' })
    );
    renderEditor();

    const host = await screen.findByLabelText(/smtp host/i);
    await userEvent.clear(host);
    await userEvent.type(host, 'smtp.example.com');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByTestId('config-applied-banner')).toBeInTheDocument();
    expect(screen.getByText(/EMAIL_HOST/)).toBeInTheDocument();
    expect(screen.queryByTestId('config-restart-banner')).not.toBeInTheDocument();
  });

  it('renders a per-field tier badge on editable fields', async () => {
    renderEditor();

    expect(await screen.findByTestId('config-tier-PORT')).toHaveTextContent('Restart required');
    expect(screen.getByTestId('config-tier-EMAIL_HOST')).toHaveTextContent('Applies immediately');
    // Read-only T0/env rows get no tier badge.
    expect(screen.queryByTestId('config-tier-WEA_PG_HOST')).not.toBeInTheDocument();
  });

  it('skips blank secret new values on save but sends typed ones', async () => {
    const putBodies = [];
    mockPutConfig((body) => {
      putBodies.push(body);
      return HttpResponse.json(defaultPutResponse());
    });
    renderEditor();

    await screen.findByLabelText(/smtp host/i);
    await userEvent.click(screen.getByRole('button', { name: /set new value/i }));
    const secretField = screen.getByLabelText(/set new value/i);
    expect(secretField).toHaveValue('');

    const host = screen.getByLabelText(/smtp host/i);
    await userEvent.clear(host);
    await userEvent.type(host, 'smtp.example.com');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(putBodies[0].values).toEqual({ EMAIL_HOST: 'smtp.example.com' });
    expect(putBodies[0].values.EMAIL_PASSWORD).toBeUndefined();

    // Type a new secret value → included on the next save.
    await userEvent.click(screen.getByRole('button', { name: /set new value/i }));
    await userEvent.type(screen.getByLabelText(/set new value/i), 'new-pass');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(putBodies).toHaveLength(2);
    });
    expect(putBodies[1].values.EMAIL_PASSWORD).toBe('new-pass');
  });
});
