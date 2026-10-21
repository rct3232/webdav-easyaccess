/**
 * Setup wizard AI step tests (T1.1c).
 * The AI step is optional and skippable: preset picker (manifest served by
 * GET /api/setup/llm-presets — chat/vision/asr rows only; embed is NOT a
 * wizard surface), per-role base-url/key/model inputs with a per-role test
 * button (POST /api/setup/test target 'llm'), and an embedded-engine
 * readiness card shown in its waiting state (preparing never starts while
 * setup mode is up — zero bytes fetched). Skipping sends no `llm` apply block.
 * @see docs/spec/client/pages/Setup.md 2.5 (step 5)
 * @see docs/spec/server/routes/setup.md 2.4a
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { server } from '../../../setupTests';
import { AuthProvider } from '../../../contexts/AuthContext';
import Setup from '../Setup';
import '../../../i18n';

const theme = createTheme({ palette: { primary: { main: '#4167ba' } } });

function renderSetup(initialEntries = ['/setup']) {
  const rootEl = (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </ThemeProvider>
  );

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: rootEl,
        children: [
          { path: 'setup', element: <Setup /> },
          { path: 'login', element: <div data-testid="login-page">Login page</div> },
        ],
      },
    ],
    {
      initialEntries,
      future: { v7_relativeSplatPath: true },
    }
  );

  return (
    <RouterProvider
      router={router}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    />
  );
}

const waitForReady = async () => {
  await waitFor(() => {
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
};

const clickNext = async (user) => {
  await user.click(screen.getByRole('button', { name: /^next$/i }));
};

// Click "Test connection" and wait for the success feedback; required before
// Next is enabled on steps that offer a connection test (UI UX change).
async function passTest(user) {
  await user.click(screen.getByRole('button', { name: /test connection/i }));
  await waitFor(() => {
    expect(screen.getByText('Connection successful.')).toBeInTheDocument();
  });
}

async function fillS3Fields(user) {
  await user.type(screen.getByLabelText(/bucket/i), 'test-bucket');
  await user.type(screen.getByLabelText(/region/i), 'us-east-1');
  await user.type(screen.getByLabelText(/access key id/i), 'AKIAIOSFODNN7EXAMPLE');
  await user.type(
    screen.getByLabelText(/secret access key/i),
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  );
}

const mockPresets = (presets) => {
  server.use(http.get('/api/setup/llm-presets', () => HttpResponse.json({ presets })));
};

const mockLlmProbe = (handler) => {
  server.use(http.post('/api/setup/test', handler));
};

const navigateToAiStep = async (user) => {
  await fillS3Fields(user);
  await passTest(user);
  await clickNext(user);
  await user.type(screen.getByLabelText(/admin password/i), 'admin123');
  await clickNext(user);
  await clickNext(user); // optional
  await clickNext(user); // AI step
};

describe('Setup wizard AI step (T1.1c)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Wizard-surface projection of the shipped manifest (chat/vision/asr rows
    // only — the embed rows never reach the picker, §2.4a).
    mockPresets([
      {
        id: 'gemma-4-12b-it',
        family: 'llama.cpp',
        roles: ['chat', 'vision', 'asr'],
        expected: { chat: true, vision_chat: true, asr: true },
      },
    ]);
  });

  it('renders the AI step with the embedded-engine readiness card in its waiting state', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    expect(screen.getByText('AI configuration (optional)')).toBeInTheDocument();
    expect(screen.getByText('Embedded model status')).toBeInTheDocument();
    expect(screen.getByText('Provisioning is scheduled for the next restart')).toBeInTheDocument();
  });

  it('lists available presets from the manifest', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    expect(screen.getByText(/gemma-4-12b-it/i)).toBeInTheDocument();
    expect(screen.getByText(/llama\.cpp/i)).toBeInTheDocument();
  });

  it('lists role rows and renders an admin test button per role', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    expect(screen.getByText(/chat/i)).toBeInTheDocument();
    expect(screen.getByText(/vision/i)).toBeInTheDocument();
    expect(screen.getByText(/asr/i)).toBeInTheDocument();

    const chatRow = screen.getByTestId('ai-role-row-chat');
    const visionRow = screen.getByTestId('ai-role-row-vision');
    const asrRow = screen.getByTestId('ai-role-row-asr');

    expect(within(chatRow).getByRole('button', { name: /test/i })).toBeInTheDocument();
    expect(within(visionRow).getByRole('button', { name: /test/i })).toBeInTheDocument();
    expect(within(asrRow).getByRole('button', { name: /test/i })).toBeInTheDocument();
  });

  it('surfaces a passing probe result inline in the wizard', async () => {
    mockLlmProbe(() => HttpResponse.json({ ok: true, role: 'chat', reason: null }));
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    const chatRow = screen.getByTestId('ai-role-row-chat');
    await user.click(within(chatRow).getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(within(chatRow).getByText(/probe ok/i)).toBeInTheDocument();
    });
  });

  it('surfaces a failing probe result and reason inline in the wizard', async () => {
    mockLlmProbe(() =>
      HttpResponse.json(
        {
          ok: false,
          errorCode: 'serverErrors.setup.test.failed',
          message: 'Connection test failed',
          reason: 'model unreachable',
        },
        { status: 400 }
      )
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    const chatRow = screen.getByTestId('ai-role-row-chat');
    await user.click(within(chatRow).getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(within(chatRow).getByText(/probe failed/i)).toBeInTheDocument();
    });
    expect(within(chatRow).getByText(/model unreachable/i)).toBeInTheDocument();
  });

  it('skipping the AI step sends no llm block in the apply payload', async () => {
    let applyBody;
    server.use(
      http.post('/api/setup/apply', async ({ request }) => {
        applyBody = await request.json();
        return HttpResponse.json({ restart_required: true });
      })
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    await clickNext(user); // AI step → apply
    await user.click(screen.getByRole('button', { name: /apply & finish/i }));

    await waitFor(() => {
      expect(applyBody).toBeTruthy();
    });
    expect(applyBody.llm).toBeUndefined();
  });

  it('a configured role sends its triple in the apply llm block', async () => {
    mockLlmProbe(() => HttpResponse.json({ ok: true, role: 'chat', reason: null }));
    let applyBody;
    server.use(
      http.post('/api/setup/apply', async ({ request }) => {
        applyBody = await request.json();
        return HttpResponse.json({ restart_required: true });
      })
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await navigateToAiStep(user);
    const chatRow = screen.getByTestId('ai-role-row-chat');
    await within(chatRow).getByRole('checkbox');
    await user.type(within(chatRow).getByLabelText(/base url/i), 'http://llm.local/v1');
    await user.type(within(chatRow).getByLabelText(/api key/i), 'sk-test');
    await user.type(within(chatRow).getByLabelText(/model/i), 'gemma-4-12b-it');
    await user.click(within(chatRow).getByRole('button', { name: /test/i }));
    await waitFor(() => {
      expect(within(chatRow).getByText(/probe ok/i)).toBeInTheDocument();
    });

    await clickNext(user); // AI step → apply
    await user.click(screen.getByRole('button', { name: /apply & finish/i }));

    await waitFor(() => {
      expect(applyBody).toBeTruthy();
    });
    expect(applyBody.llm).toEqual({
      chat: { baseUrl: 'http://llm.local/v1', apiKey: 'sk-test', model: 'gemma-4-12b-it' },
    });
  });
});
