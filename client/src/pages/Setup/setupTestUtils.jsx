/**
 * Shared Setup wizard test harness.
 *
 * The wizard tests are integration tests, but typing 40-character secrets and
 * then re-navigating the whole wizard for every assertion is not the behavior
 * under test. This harness keeps the observable flows (status load, connection
 * test, apply) while using change events for bulk form values so the tests do
 * not spend their 5 s budget on per-keystroke timer hops and full-tree renders.
 *
 * @see docs/TESTING_STRATEGY.md §Client (bulk input, MSW handler discipline)
 * @see docs/TESTING_STRATEGY.md §Test Performance & Run Guidance
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';

import { ThemeAndAuthProviders } from '../../test-utils';
import { server } from '../../setupTests';
import Setup from './Setup';
import '../../i18n';

// A bounded local budget for the wizard's readiness/result transitions. The
// Jest default remains 5 s; this prevents a 1 s Testing Library default from
// turning a loaded-but-progressing render into an assertion failure.
export const UI_WAIT_TIMEOUT_MS = 3000;

export function renderSetup(initialEntries = ['/setup']) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet />,
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

  return render(
    <ThemeAndAuthProviders>
      <RouterProvider
        router={router}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      />
    </ThemeAndAuthProviders>
  );
}

export async function waitForReady() {
  await waitFor(
    () => {
      if (screen.queryByRole('progressbar') !== null) {
        throw new Error('Setup status is still loading');
      }
    },
    { timeout: UI_WAIT_TIMEOUT_MS }
  );
}

function queriesFor(scope) {
  return typeof scope.getByLabelText === 'function' ? scope : within(scope);
}

export function setFieldValue(label, value, scope = screen) {
  fireEvent.change(queriesFor(scope).getByLabelText(label), {
    target: { value },
  });
}

export function clickButton(name, scope = screen) {
  fireEvent.click(queriesFor(scope).getByRole('button', { name }));
}

export function clickNext() {
  clickButton(/^next$/i);
}

export async function passTest() {
  clickButton(/test connection/i);
  await waitFor(
    () => {
      screen.getByText('Connection successful.');
    },
    { timeout: UI_WAIT_TIMEOUT_MS }
  );
}

export function fillS3Fields() {
  setFieldValue(/bucket/i, 'test-bucket');
  setFieldValue(/region/i, 'us-east-1');
  setFieldValue(/access key id/i, 'AKIAIOSFODNN7EXAMPLE');
  setFieldValue(/secret access key/i, 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
}

export const mockPresets = (presets) => {
  server.use(http.get('/api/setup/llm-presets', () => HttpResponse.json({ presets })));
};

// Intercept ONLY the llm probe target; other targets (the step-0 connection
// test) keep the default handler behavior.
export const mockLlmProbe = (handler) => {
  server.use(
    http.post('/api/setup/test', async ({ request }) => {
      const body = await request.json().catch(() => ({}));
      if (body.target !== 'llm') return HttpResponse.json({ ok: true });
      return handler({ request, body });
    })
  );
};

export async function navigateToAiStep() {
  fillS3Fields();
  await passTest();
  clickNext();
  setFieldValue(/admin password/i, 'admin123');
  clickNext();
  clickNext(); // optional → AI step
}
