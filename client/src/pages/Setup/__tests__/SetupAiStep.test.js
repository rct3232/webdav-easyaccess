/**
 * Setup wizard AI step integration tests (T1.1c).
 *
 * The pure view assertions (readiness card, preset picker, role rows) live in
 * SetupWizardView.test.js. This file keeps only the behaviors that need the
 * real hook + MSW round trip: probe results, skipping the AI block, and the
 * configured-role apply payload.
 *
 * @see docs/spec/client/pages/Setup.md 2.5 (step 5)
 * @see docs/spec/server/routes/setup.md 2.4a
 * @see docs/TESTING_STRATEGY.md §Client (bulk input, MSW handler discipline)
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../setupTests';
import {
  UI_WAIT_TIMEOUT_MS,
  clickButton,
  clickNext,
  mockLlmProbe,
  mockPresets,
  navigateToAiStep,
  renderSetup,
  setFieldValue,
  waitForReady,
} from '../setupTestUtils';

// Safety net for the hook + MSW probe/apply integration flow. The root fix is
// the reduced navigation/event cost; this per-suite budget is not a global
// timeout change.
jest.setTimeout(10000);

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

  it('surfaces a passing probe result inline in the wizard', async () => {
    mockLlmProbe(() => HttpResponse.json({ ok: true, role: 'chat', reason: null }));
    renderSetup();
    await waitForReady();

    await navigateToAiStep();
    const chatRow = screen.getByTestId('ai-role-row-chat');
    fireEvent.click(within(chatRow).getByRole('checkbox')); // enable the role
    setFieldValue(/base url/i, 'http://llm.local/v1', chatRow);
    setFieldValue(/model/i, 'gemma-4-12b-it', chatRow);
    clickButton(/test/i, chatRow);

    await waitFor(
      () => {
        expect(within(chatRow).getByText(/probe ok/i)).toBeInTheDocument();
      },
      { timeout: UI_WAIT_TIMEOUT_MS }
    );
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
    renderSetup();
    await waitForReady();

    await navigateToAiStep();
    const chatRow = screen.getByTestId('ai-role-row-chat');
    fireEvent.click(within(chatRow).getByRole('checkbox')); // enable the role
    setFieldValue(/base url/i, 'http://llm.local/v1', chatRow);
    setFieldValue(/model/i, 'gemma-4-12b-it', chatRow);
    clickButton(/test/i, chatRow);

    await waitFor(
      () => {
        // The primary text is the translated errorCode (docs/spec/client/pages/
        // Setup.md §2.5 error display); the raw reason is the muted detail line.
        expect(within(chatRow).getByText(/connection test failed/i)).toBeInTheDocument();
      },
      { timeout: UI_WAIT_TIMEOUT_MS }
    );
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
    renderSetup();
    await waitForReady();

    await navigateToAiStep();
    clickNext(); // AI step → apply
    clickButton(/apply & finish/i);

    await waitFor(
      () => {
        expect(applyBody).toBeTruthy();
      },
      { timeout: UI_WAIT_TIMEOUT_MS }
    );
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
    renderSetup();
    await waitForReady();

    await navigateToAiStep();
    const chatRow = screen.getByTestId('ai-role-row-chat');
    fireEvent.click(within(chatRow).getByRole('checkbox')); // enable the role
    setFieldValue(/base url/i, 'http://llm.local/v1', chatRow);
    setFieldValue(/api key/i, 'sk-test', chatRow);
    setFieldValue(/model/i, 'gemma-4-12b-it', chatRow);
    clickButton(/test/i, chatRow);
    await waitFor(
      () => {
        expect(within(chatRow).getByText(/probe ok/i)).toBeInTheDocument();
      },
      { timeout: UI_WAIT_TIMEOUT_MS }
    );

    clickNext(); // AI step → apply
    clickButton(/apply & finish/i);

    await waitFor(
      () => {
        expect(applyBody).toBeTruthy();
      },
      { timeout: UI_WAIT_TIMEOUT_MS }
    );
    expect(applyBody.llm).toEqual({
      chat: { baseUrl: 'http://llm.local/v1', apiKey: 'sk-test', model: 'gemma-4-12b-it' },
    });
  });
});
