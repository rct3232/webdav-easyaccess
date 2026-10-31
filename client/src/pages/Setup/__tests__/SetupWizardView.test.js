/**
 * Setup wizard AI step view tests.
 *
 * These are pure view assertions: no status fetch, no wizard navigation, no
 * real-time user events. The hook + MSW behavior stays in SetupAiStep.test.js;
 * this split keeps the presentation coverage without paying the full four-step
 * navigation cost for every label/row assertion.
 *
 * @see docs/spec/client/pages/Setup.md 2.5 (step 5)
 * @see docs/TESTING_STRATEGY.md §Client (setup wizard layering)
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ThemeAndAuthProviders } from '../../../test-utils';
import i18n from '../../../i18n';
import SetupWizardView from '../SetupWizardView';

const t = i18n.t.bind(i18n);

const PRESETS = [
  {
    id: 'gemma-4-12b-it',
    family: 'llama.cpp',
    roles: ['chat', 'vision', 'asr'],
    expected: { chat: true, vision_chat: true, asr: true },
  },
];

const createForm = () => ({
  fileBackend: 's3',
  s3: { bucket: '', region: '', accessKeyId: '', secretAccessKey: '', endpoint: '' },
  webdav: { url: '', username: '', password: '' },
  admin: { password: '' },
  jwt: { secret: '', expiresIn: '30m' },
  server: { port: '', corsOrigins: '' },
  email: { host: '', port: '587', user: '', password: '', secure: false, fromName: '' },
  llm: {
    chat: { enabled: false, baseUrl: '', apiKey: '', model: '' },
    vision: { enabled: false, baseUrl: '', apiKey: '', model: '' },
    asr: { enabled: false, baseUrl: '', apiKey: '', model: '' },
  },
});

const createViewModel = () => ({
  title: t('setup.title'),
  subtitle: t('setup.subtitle'),
  stepLabels: [
    t('setup.steps.fileStorage'),
    t('setup.steps.adminJwt'),
    t('setup.steps.optional'),
    t('setup.steps.ai'),
    t('setup.steps.apply'),
  ],
  stepCounter: t('setup.stepOf', { current: 4, total: 5 }),
  back: t('setup.back'),
  next: t('setup.next'),
  aiTitle: t('setup.ai.title'),
  aiStatusCardTitle: t('setup.ai.statusCard.title'),
  aiStatusPreparing: t('setup.ai.statusCard.preparing'),
  aiPresetTitle: t('setup.ai.presetTitle'),
  aiNoPresets: t('setup.ai.noPresets'),
  aiRoleLabels: {
    chat: t('setup.ai.role.chat'),
    vision: t('setup.ai.role.vision'),
    asr: t('setup.ai.role.asr'),
  },
  aiBaseUrl: t('setup.ai.baseUrl'),
  aiApiKey: t('setup.ai.apiKey'),
  aiModel: t('setup.ai.model'),
  aiTest: t('setup.ai.test'),
  aiTesting: t('setup.ai.testing'),
  aiProbeOk: t('setup.ai.probeOk'),
  aiProbeFail: t('setup.ai.probeFail'),
});

const renderView = (overrides = {}) =>
  render(
    <ThemeAndAuthProviders>
      <SetupWizardView
        statusLoading={false}
        loadError={null}
        restartRequired={false}
        activeStep={3}
        stepCount={5}
        form={createForm()}
        errors={{}}
        testStates={{}}
        llmPresets={PRESETS}
        llmPresetId=""
        llmTestStates={{
          chat: { status: 'idle', message: '', reason: '' },
          vision: { status: 'idle', message: '', reason: '' },
          asr: { status: 'idle', message: '', reason: '' },
        }}
        applyState={{ status: 'idle', message: '' }}
        viewModel={createViewModel()}
        onBack={jest.fn()}
        onNext={jest.fn()}
        onFileBackendChange={jest.fn()}
        onFieldChange={jest.fn()}
        onCheckboxChange={jest.fn()}
        onTestConnection={jest.fn()}
        onRegenerateSecret={jest.fn()}
        onPresetSelect={jest.fn()}
        onLlmRoleToggle={jest.fn()}
        onLlmFieldChange={jest.fn()}
        onTestLlm={jest.fn()}
        onApply={jest.fn()}
        {...overrides}
      />
    </ThemeAndAuthProviders>
  );

describe('Setup wizard AI step view', () => {
  it('renders the embedded-engine readiness card in its waiting state', () => {
    renderView();

    expect(screen.getByText('AI configuration (optional)')).toBeInTheDocument();
    expect(screen.getByText('Embedded model status')).toBeInTheDocument();
    expect(screen.getByText('Provisioning is scheduled for the next restart')).toBeInTheDocument();
  });

  it('lists available presets from the manifest', () => {
    renderView();

    expect(screen.getByTestId('ai-preset-picker')).toBeInTheDocument();
    expect(screen.getByText(/gemma-4-12b-it/i)).toBeInTheDocument();
    expect(screen.getByText(/llama\.cpp/i)).toBeInTheDocument();
  });

  it('lists role rows and renders an admin test button per role', () => {
    renderView();

    for (const role of ['chat', 'vision', 'asr']) {
      const row = screen.getByTestId(`ai-role-row-${role}`);
      expect(within(row).getByText(new RegExp(role, 'i'))).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: /test/i })).toBeInTheDocument();
    }
  });
});
