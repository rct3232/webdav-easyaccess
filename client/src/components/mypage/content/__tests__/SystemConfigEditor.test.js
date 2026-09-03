/**
 * SystemConfigEditor tests.
 * Verifies the two-section split: Section A "Runtime settings" (editable
 * T1/T2 db/default keys in the four subgroups) and Section B "Deploy-time
 * configuration" (read-only flat list of T0 keys + env-sourced T1/T2 keys),
 * plus masked secrets with set-new-value, dirty-tracked save (only changed
 * Section A keys), applied vs restartRequired feedback, and blank-secret
 * skipping.
 * @see docs/spec/client/components/SystemConfigEditor.md
 * @see docs/spec/server/routes/config.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import SystemConfigEditor from '../SystemConfigEditor';

const makeConfig = (overrides = {}) => ({
  // T0 keys → Section B (deploy-time read-only).
  WEA_STORAGE_BACKEND: { value: 'sqlite', source: 'env', tier: 'T0', secret: false },
  WEA_PG_HOST: { value: '', source: 'env', tier: 'T0', secret: false },
  WEA_PG_PASSWORD: { value: '****', source: 'env', tier: 'T0', secret: true },
  JWT_SECRET: { value: '****', source: 'env', tier: 'T0', secret: true },
  // Editable Section A keys (db/default source, T1/T2).
  WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
  PORT: { value: '5001', source: 'default', tier: 'T1', secret: false },
  EMAIL_HOST: { value: 'smtp.gmail.com', source: 'db', tier: 'T2', secret: false },
  EMAIL_PORT: { value: '587', source: 'db', tier: 'T2', secret: false },
  EMAIL_PASSWORD: { value: '****', source: 'db', tier: 'T2', secret: true },
  // env-sourced T1/T2 key → Section B (not a disabled Section A input).
  S3_BUCKET: { value: 'my-bucket', source: 'env', tier: 'T1', secret: false },
  ...overrides,
});

const webdavConfig = (overrides = {}) =>
  makeConfig({
    WEA_FILE_STORAGE: { value: 'webdav', source: 'default', tier: 'T1', secret: false },
    WEBDAV_URL: { value: 'https://dav.example.com', source: 'db', tier: 'T1', secret: false },
    WEBDAV_USERNAME: { value: 'user', source: 'db', tier: 'T1', secret: false },
    WEBDAV_PASSWORD: { value: '****', source: 'db', tier: 'T1', secret: true },
    WEBDAV_AUTH_TYPE: { value: 'auto', source: 'db', tier: 'T1', secret: false },
    ...overrides,
  });

const mockGetConfig = (config) => {
  server.use(http.get('/api/admin/config', () => HttpResponse.json({ config })));
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
  it('renders Section A editable groups and Section B deploy-time rows', async () => {
    renderEditor();

    // Section A header + editable db/default T1/T2 inputs with the subgroup UI.
    expect(await screen.findByText(/runtime settings/i)).toBeInTheDocument();
    expect(screen.getByText(/server & security/i)).toBeInTheDocument();
    expect(screen.getAllByText(/file storage/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/email/i)).toBeInTheDocument();

    const port = screen.getByLabelText(/server port/i);
    expect(port).not.toBeDisabled();
    expect(screen.getByLabelText(/smtp host/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/file storage type/i)).not.toBeDisabled();

    // Section B header + intro note.
    expect(screen.getByText(/deploy-time configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/managed externally and cannot be edited here/i)).toBeInTheDocument();

    // T0 keys render as Section B rows.
    expect(screen.getByTestId('platform-config-row-WEA_STORAGE_BACKEND')).toBeInTheDocument();
    expect(screen.getByTestId('platform-config-row-JWT_SECRET')).toBeInTheDocument();

    // env-sourced T1/T2 keys live in Section B: no disabled Section A input.
    expect(screen.getByTestId('platform-config-row-S3_BUCKET')).toBeInTheDocument();
    expect(screen.queryByTestId('config-input-S3_BUCKET')).not.toBeInTheDocument();
  });

  it('renders Section B values read-only with masked secrets and unset placeholders', async () => {
    renderEditor();

    await screen.findByText(/deploy-time configuration/i);

    // Masked secret row: value '****', no reveal/set-new-value control.
    const secretRow = screen.getByTestId('platform-config-row-WEA_PG_PASSWORD');
    expect(within(secretRow).getByText('****')).toBeInTheDocument();
    expect(within(secretRow).getByText(/T0 · Set in .env \(env takes precedence\)/i)).toBeInTheDocument();
    expect(within(secretRow).queryByRole('button')).not.toBeInTheDocument();

    // Undefined/empty value row shows the "(unset)" placeholder.
    const unsetRow = screen.getByTestId('platform-config-row-WEA_PG_HOST');
    expect(within(unsetRow).getByText('(unset)')).toBeInTheDocument();

    // env-sourced T1 key shows its real (masked-on-server) value read-only.
    const envRow = screen.getByTestId('platform-config-row-S3_BUCKET');
    expect(within(envRow).getByText('my-bucket')).toBeInTheDocument();
    expect(within(envRow).getByText(/T1 · Set in .env \(env takes precedence\)/i)).toBeInTheDocument();
  });

  it('renders a Section A select and editable switch for db/default keys', async () => {
    renderEditor({
      config: makeConfig({
        EMAIL_SECURE: { value: false, source: 'db', tier: 'T2', secret: false },
        WEA_SKIP_GC_SCHEDULER: { value: false, source: 'db', tier: 'T2', secret: false },
      }),
    });

    expect(await screen.findByLabelText(/smtp host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/file storage type/i)).not.toBeDisabled();

    const emailSecureSwitch = screen.getByTestId('config-input-EMAIL_SECURE');
    expect(emailSecureSwitch).not.toBeDisabled();

    const skipGcSwitch = screen.getByTestId('config-input-WEA_SKIP_GC_SCHEDULER');
    expect(skipGcSwitch).not.toBeDisabled();
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

  it('sends only changed Section A keys on save and reports success via onSnackbar', async () => {
    let putBody;
    mockPutConfig((body) => {
      putBody = body;
      return HttpResponse.json({
        applied: ['EMAIL_HOST'],
        restartRequired: [],
        messageCode: 'serverMessages.admin.configSaved',
      });
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
      HttpResponse.json({
        applied: ['EMAIL_HOST'],
        restartRequired: ['PORT'],
        messageCode: 'serverMessages.admin.configSaved',
      })
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
      HttpResponse.json({
        applied: ['EMAIL_HOST'],
        restartRequired: [],
        messageCode: 'serverMessages.admin.configSaved',
      })
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

  it('renders a per-field tier badge on editable fields only', async () => {
    renderEditor();

    expect(await screen.findByTestId('config-tier-PORT')).toHaveTextContent('Restart required');
    expect(screen.getByTestId('config-tier-EMAIL_HOST')).toHaveTextContent('Applies immediately');
    // env-sourced / T0 keys are Section B rows — never a Section A tier badge.
    expect(screen.queryByTestId('config-tier-S3_BUCKET')).not.toBeInTheDocument();
    expect(screen.queryByTestId('config-tier-WEA_STORAGE_BACKEND')).not.toBeInTheDocument();
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

  it('disables Save when a connection key is dirty until the test passes', async () => {
    renderEditor({ config: webdavConfig() });

    const saveButton = await screen.findByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();

    const urlField = screen.getByLabelText(/webdav url/i);
    await userEvent.clear(urlField);
    await userEvent.type(urlField, 'https://dav.example.com/changed');

    expect(saveButton).toBeDisabled();
    expect(screen.getByTestId('config-test-connection')).toBeInTheDocument();
    expect(
      screen.getByText(/save is blocked until the connection test passes/i)
    ).toBeInTheDocument();
  });

  it('enables Save after a passing connection test', async () => {
    renderEditor({ config: webdavConfig() });

    const saveButton = await screen.findByRole('button', { name: /save changes/i });
    const urlField = screen.getByLabelText(/webdav url/i);
    await userEvent.clear(urlField);
    await userEvent.type(urlField, 'https://dav.example.com/changed');

    await userEvent.click(screen.getByTestId('config-test-connection'));

    expect(await screen.findByText(/connection successful/i)).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
  });

  it('keeps Save blocked when the connection test fails and shows the reason', async () => {
    renderEditor({ config: webdavConfig() });

    const saveButton = await screen.findByRole('button', { name: /save changes/i });
    const urlField = screen.getByLabelText(/webdav url/i);
    await userEvent.clear(urlField);
    await userEvent.type(urlField, 'https://dav.example.com/bad');

    await userEvent.click(screen.getByTestId('config-test-connection'));

    expect(await screen.findByText(/cannot reach the postgresql server/i)).toBeInTheDocument();
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });

  it('invalidates the test result when a connection key is edited again', async () => {
    renderEditor({ config: webdavConfig() });

    const saveButton = await screen.findByRole('button', { name: /save changes/i });
    const urlField = screen.getByLabelText(/webdav url/i);
    await userEvent.clear(urlField);
    await userEvent.type(urlField, 'https://dav.example.com/changed');
    await userEvent.click(screen.getByTestId('config-test-connection'));
    await screen.findByText(/connection successful/i);
    expect(saveButton).toBeEnabled();

    await userEvent.type(urlField, '2');
    expect(saveButton).toBeDisabled();
    expect(screen.queryByTestId('config-connection-test-status')).not.toBeInTheDocument();
  });

  it('saves a non-connection key without requiring a connection test', async () => {
    let putBody;
    mockPutConfig((body) => {
      putBody = body;
      return HttpResponse.json(defaultPutResponse());
    });
    renderEditor({
      config: makeConfig({
        MAX_THUMBNAIL_SIZE: { value: '100', source: 'db', tier: 'T1', secret: false },
      }),
    });

    const saveButton = await screen.findByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();

    const thumbSize = screen.getByLabelText(/max thumbnail size/i);
    await userEvent.clear(thumbSize);
    await userEvent.type(thumbSize, '200');

    expect(saveButton).toBeEnabled();
    expect(screen.queryByTestId('config-test-connection')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/save is blocked until the connection test passes/i)
    ).not.toBeInTheDocument();

    await userEvent.click(saveButton);
    await waitFor(() => {
      expect(putBody).toEqual({ values: { MAX_THUMBNAIL_SIZE: '200' } });
    });
  });
});
