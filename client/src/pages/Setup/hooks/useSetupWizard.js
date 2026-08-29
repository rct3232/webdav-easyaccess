import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { validateRequired, validatePassword } from '@webdav-easyaccess/shared/validation';

import { getValidationMessage } from '../../../utils/validationMessage';
import { applySetup, getSetupStatus, prefillSetup, testSetup } from '../../../services/setupService';

const SECRET_MASK = '****';
const STEP_COUNT = 5;
const DEFAULT_EXPIRES_IN = '30m';

const FIELD_LABEL_KEYS = {
  host: 'setup.host',
  port: 'setup.port',
  database: 'setup.database',
  user: 'setup.user',
  password: 'setup.password',
  bucket: 'setup.bucket',
  region: 'setup.region',
  accessKeyId: 'setup.accessKeyId',
  secretAccessKey: 'setup.secretAccessKey',
  url: 'setup.url',
  username: 'setup.username',
};

const STEP_REQUIRED_FIELDS = {
  postgresql: ['host', 'port', 'database', 'user', 'password'],
  s3: ['bucket', 'region', 'accessKeyId', 'secretAccessKey'],
  webdav: ['url', 'username', 'password'],
};

const TEST_TARGET_SCOPE = {
  postgresql: 'pg',
  s3: 's3',
  webdav: 'webdav',
};

function generateJwtSecret() {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSecret(value) {
  if (value == null || value === '') return '';
  return SECRET_MASK;
}

function parseBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return value === 'true' || value === '1';
}

function createInitialForm() {
  return {
    metadataBackend: 'sqlite',
    pg: { host: '', port: '5432', database: '', user: '', password: '', ssl: false },
    fileBackend: 's3',
    s3: { bucket: '', region: '', accessKeyId: '', secretAccessKey: '', endpoint: '' },
    webdav: { url: '', username: '', password: '' },
    admin: { password: '' },
    jwt: { secret: '', expiresIn: DEFAULT_EXPIRES_IN },
    server: { port: '', corsOrigins: '' },
    email: { host: '', port: '587', user: '', password: '', secure: false, fromName: '' },
  };
}

function createInitialTestStates() {
  return {
    postgresql: { status: 'idle', message: '', reason: '' },
    s3: { status: 'idle', message: '', reason: '' },
    webdav: { status: 'idle', message: '', reason: '' },
  };
}

function prefillForm(prev, current) {
  const next = { ...prev };

  if (current.WEA_STORAGE_BACKEND === 'sqlite' || current.WEA_STORAGE_BACKEND === 'postgresql') {
    next.metadataBackend = current.WEA_STORAGE_BACKEND;
  }
  next.pg = {
    ...next.pg,
    host: current.WEA_PG_HOST != null ? current.WEA_PG_HOST : next.pg.host,
    port: current.WEA_PG_PORT != null ? current.WEA_PG_PORT : next.pg.port,
    database: current.WEA_PG_DATABASE != null ? current.WEA_PG_DATABASE : next.pg.database,
    user: current.WEA_PG_USER != null ? current.WEA_PG_USER : next.pg.user,
    // A missing secret in the merge source (e.g. the target-DB prefill, which
    // never contains T0 keys) must NOT wipe an already-masked/typed value.
    password:
      current.WEA_PG_PASSWORD != null
        ? normalizeSecret(current.WEA_PG_PASSWORD)
        : next.pg.password,
    ssl: parseBool(current.WEA_PG_SSL, next.pg.ssl),
  };

  if (current.WEA_FILE_STORAGE === 's3' || current.WEA_FILE_STORAGE === 'webdav') {
    next.fileBackend = current.WEA_FILE_STORAGE;
  }
  next.s3 = {
    ...next.s3,
    bucket: current.S3_BUCKET != null ? current.S3_BUCKET : next.s3.bucket,
    region:
      current.AWS_REGION != null
        ? current.AWS_REGION
        : current.S3_REGION != null
          ? current.S3_REGION
          : next.s3.region,
    accessKeyId:
      current.AWS_ACCESS_KEY_ID != null ? current.AWS_ACCESS_KEY_ID : next.s3.accessKeyId,
    secretAccessKey:
      current.AWS_SECRET_ACCESS_KEY != null
        ? normalizeSecret(current.AWS_SECRET_ACCESS_KEY)
        : next.s3.secretAccessKey,
    endpoint: current.S3_ENDPOINT != null ? current.S3_ENDPOINT : next.s3.endpoint,
  };
  next.webdav = {
    ...next.webdav,
    url: current.WEBDAV_URL != null ? current.WEBDAV_URL : next.webdav.url,
    username: current.WEBDAV_USERNAME != null ? current.WEBDAV_USERNAME : next.webdav.username,
    password:
      current.WEBDAV_PASSWORD != null
        ? normalizeSecret(current.WEBDAV_PASSWORD)
        : next.webdav.password,
  };

  next.jwt = {
    ...next.jwt,
    secret: current.JWT_SECRET ? SECRET_MASK : next.jwt.secret || generateJwtSecret(),
    expiresIn: current.JWT_EXPIRES_IN != null ? current.JWT_EXPIRES_IN : next.jwt.expiresIn,
  };
  next.server = {
    ...next.server,
    port: current.PORT != null ? current.PORT : next.server.port,
    corsOrigins: current.CORS_ORIGINS != null ? current.CORS_ORIGINS : next.server.corsOrigins,
  };
  next.email = {
    ...next.email,
    host: current.EMAIL_HOST != null ? current.EMAIL_HOST : next.email.host,
    // Truthy guard: an unset EMAIL_PORT surfaces as '' in status.current, and
    // applying an empty port is rejected as invalid. Keep the documented '587'
    // default when SMTP is not configured.
    port: current.EMAIL_PORT ? current.EMAIL_PORT : next.email.port,
    user: current.EMAIL_USER != null ? current.EMAIL_USER : next.email.user,
    password:
      current.EMAIL_PASSWORD != null
        ? normalizeSecret(current.EMAIL_PASSWORD)
        : next.email.password,
    secure: parseBool(current.EMAIL_SECURE, next.email.secure),
    fromName: current.EMAIL_FROM_NAME != null ? current.EMAIL_FROM_NAME : next.email.fromName,
  };

  return next;
}

function validateRequiredFields(values, fields, t) {
  for (const field of fields) {
    const error = validateRequired(values[field], t(FIELD_LABEL_KEYS[field]));
    if (error) return getValidationMessage(error, t);
  }
  return null;
}

function resolveErrorMessage(err, t, fallbackKey) {
  if (err?.errorCode) {
    const translated = t(err.errorCode, { reason: err?.reason });
    if (translated && translated !== err.errorCode) return translated;
  }
  return err?.message || t(fallbackKey);
}

export function useSetupWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [statusLoading, setStatusLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState(createInitialForm);
  const [errors, setErrors] = useState({});
  const [testStates, setTestStates] = useState(createInitialTestStates);
  const [applyState, setApplyState] = useState({ status: 'idle', message: '' });
  const [prefilling, setPrefilling] = useState(false);

  // Editing a field invalidates the connection-test result for that backend so
  // the operator must re-test before advancing (a stale 'ok' would be wrong).
  const resetTest = useCallback((target) => {
    setTestStates((prev) => ({ ...prev, [target]: { status: 'idle', message: '', reason: '' } }));
  }, []);

  const resetTestsForScope = useCallback(
    (scope) => {
      if (scope === 'pg') resetTest('postgresql');
      else if (scope === 's3') resetTest('s3');
      else if (scope === 'webdav') resetTest('webdav');
    },
    [resetTest]
  );

  const loadStatus = useCallback(async () => {
    try {
      const status = await getSetupStatus();
      if (status?.setup_complete) {
        navigate('/login', { replace: true });
        return;
      }
      setForm((prev) => prefillForm(prev, status?.current || {}));
    } catch {
      setLoadError(t('setup.loadError'));
    } finally {
      setStatusLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleMetadataBackendChange = useCallback((value) => {
    setForm((prev) => ({ ...prev, metadataBackend: value }));
    setErrors((prev) => ({ ...prev, 0: null }));
    resetTest('postgresql');
  }, [resetTest]);

  const handleFileBackendChange = useCallback((value) => {
    setForm((prev) => ({ ...prev, fileBackend: value }));
    setErrors((prev) => ({ ...prev, 1: null }));
    resetTest('s3');
    resetTest('webdav');
  }, [resetTest]);

  const handleFieldChange = useCallback(
    (scope, field) => (event) => {
      const value = event?.target?.value;
      setForm((prev) => ({ ...prev, [scope]: { ...prev[scope], [field]: value } }));
      setErrors((prev) => ({ ...prev, [activeStep]: null }));
      resetTestsForScope(scope);
    },
    [activeStep, resetTestsForScope]
  );

  const handleCheckboxChange = useCallback(
    (scope, field) => (event) => {
      setForm((prev) => ({ ...prev, [scope]: { ...prev[scope], [field]: event.target.checked } }));
      setErrors((prev) => ({ ...prev, [activeStep]: null }));
      resetTestsForScope(scope);
    },
    [activeStep, resetTestsForScope]
  );

  const handleRegenerateSecret = useCallback(() => {
    setForm((prev) => ({ ...prev, jwt: { ...prev.jwt, secret: generateJwtSecret() } }));
    setErrors((prev) => ({ ...prev, 2: null }));
  }, []);

  const handleBack = useCallback(() => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleNext = useCallback(async () => {
    const validation = validateStep(activeStep, form, t);
    if (validation) {
      setErrors((prev) => ({ ...prev, [activeStep]: validation }));
      return;
    }
    setErrors((prev) => ({ ...prev, [activeStep]: null }));
    if (activeStep === 0 && form.metadataBackend === 'postgresql') {
      // Prefill from the target PG entered in step 1 (Q1b — setup-phase reads
      // are always direct; a no-`.env` boot's own store is the default sqlite
      // and never sees this PG). Best-effort: a failure must not block
      // advancing — the connection-test button is the explicit validator.
      setPrefilling(true);
      try {
        const res = await prefillSetup({
          backend: 'postgresql',
          host: form.pg.host,
          port: form.pg.port,
          database: form.pg.database,
          user: form.pg.user,
          password: form.pg.password,
          ssl: form.pg.ssl,
        });
        if (res?.current) {
          setForm((prev) => prefillForm(prev, res.current));
        }
      } catch {
        // best-effort: keep whatever status.current already prefilled.
      } finally {
        setPrefilling(false);
      }
    }
    setActiveStep((prev) => Math.min(prev + 1, STEP_COUNT - 1));
  }, [activeStep, form, t]);

  const buildTestPayload = useCallback(
    (target) => {
      if (target === 'postgresql') {
        return {
          host: form.pg.host,
          port: form.pg.port,
          database: form.pg.database,
          user: form.pg.user,
          password: form.pg.password,
          ssl: form.pg.ssl,
        };
      }
      if (target === 's3') {
        return {
          bucket: form.s3.bucket,
          region: form.s3.region,
          accessKeyId: form.s3.accessKeyId,
          secretAccessKey: form.s3.secretAccessKey,
          endpoint: form.s3.endpoint,
        };
      }
      return {
        url: form.webdav.url,
        username: form.webdav.username,
        password: form.webdav.password,
      };
    },
    [form]
  );

  const handleTestConnection = useCallback(
    async (target) => {
      const fields = STEP_REQUIRED_FIELDS[target];
      if (!fields) return;
      const requiredError = validateRequiredFields(form[TEST_TARGET_SCOPE[target]], fields, t);
      if (requiredError) {
        setTestStates((prev) => ({
          ...prev,
          [target]: { status: 'error', message: requiredError },
        }));
        return;
      }
      setTestStates((prev) => ({ ...prev, [target]: { status: 'testing', message: '' } }));
      try {
        await testSetup(target, buildTestPayload(target));
        setTestStates((prev) => ({
          ...prev,
          [target]: { status: 'ok', message: t('setup.testOk') },
        }));
      } catch (err) {
        setTestStates((prev) => ({
          ...prev,
          [target]: {
            status: 'error',
            message: resolveErrorMessage(err, t, 'setup.testFail'),
            reason: err?.reason,
          },
        }));
      }
    },
    [buildTestPayload, form, t]
  );

  const buildApplyPayload = useCallback(() => {
    const jwtSecret =
      !form.jwt.secret || form.jwt.secret === SECRET_MASK ? generateJwtSecret() : form.jwt.secret;
    // A masked (unchanged) secret is sent as the '****' marker so the server can
    // keep its existing value (only-re-encrypt-on-new-value, PLAN §7): the T0
    // WEA_PG_PASSWORD stays in .env, DB-stored secrets keep their ciphertext.
    const metadata =
      form.metadataBackend === 'postgresql'
        ? {
            backend: 'postgresql',
            host: form.pg.host,
            port: form.pg.port,
            database: form.pg.database,
            user: form.pg.user,
            password: form.pg.password,
            ssl: form.pg.ssl,
          }
        : { backend: 'sqlite' };
    const file =
      form.fileBackend === 's3'
        ? {
            backend: 's3',
            bucket: form.s3.bucket,
            region: form.s3.region,
            accessKeyId: form.s3.accessKeyId,
            secretAccessKey: form.s3.secretAccessKey,
            endpoint: form.s3.endpoint,
          }
        : {
            backend: 'webdav',
            url: form.webdav.url,
            username: form.webdav.username,
            password: form.webdav.password,
            authType: 'auto',
          };
    return {
      metadata,
      file,
      admin: { password: form.admin.password },
      jwt: { secret: jwtSecret, expiresIn: form.jwt.expiresIn || DEFAULT_EXPIRES_IN },
      server: { port: form.server.port, corsOrigins: form.server.corsOrigins },
      email: {
        host: form.email.host,
        port: form.email.port,
        user: form.email.user,
        password: form.email.password,
        secure: form.email.secure,
        fromName: form.email.fromName,
      },
    };
  }, [form]);

  const handleApply = useCallback(async () => {
    setApplyState({ status: 'applying', message: '' });
    try {
      await applySetup(buildApplyPayload());
      setApplyState({ status: 'idle', message: '' });
      setRestartRequired(true);
    } catch (err) {
      setApplyState({ status: 'error', message: resolveErrorMessage(err, t, 'setup.applyFail') });
    }
  }, [buildApplyPayload, t]);

  const viewModel = useMemo(
    () => ({
      title: t('setup.title'),
      subtitle: t('setup.subtitle'),
      loading: t('setup.loading'),
      stepLabels: [
        t('setup.steps.metadata'),
        t('setup.steps.fileStorage'),
        t('setup.steps.adminJwt'),
        t('setup.steps.optional'),
        t('setup.steps.apply'),
      ],
      stepCounter: t('setup.stepOf', { current: activeStep + 1, total: STEP_COUNT }),
      back: t('setup.back'),
      next: t('setup.next'),
      metadataBackend: t('setup.metadataBackend'),
      metadataSqlite: t('setup.metadataSqlite'),
      metadataPostgresql: t('setup.metadataPostgresql'),
      fileBackend: t('setup.fileBackend'),
      fileS3: t('setup.fileS3'),
      fileWebdav: t('setup.fileWebdav'),
      host: t('setup.host'),
      port: t('setup.port'),
      database: t('setup.database'),
      user: t('setup.user'),
      password: t('setup.password'),
      ssl: t('setup.ssl'),
      bucket: t('setup.bucket'),
      region: t('setup.region'),
      accessKeyId: t('setup.accessKeyId'),
      secretAccessKey: t('setup.secretAccessKey'),
      endpoint: t('setup.endpoint'),
      url: t('setup.url'),
      username: t('setup.username'),
      adminUsername: t('setup.adminUsername'),
      adminUsernameFixed: t('setup.adminUsernameFixed'),
      adminPassword: t('setup.adminPassword'),
      jwtSecret: t('setup.jwtSecret'),
      regenerate: t('setup.regenerate'),
      expiresIn: t('setup.expiresIn'),
      expiresInHelp: t('setup.expiresInHelp'),
      serverPort: t('setup.serverPort'),
      corsOrigins: t('setup.corsOrigins'),
      smtpTitle: t('setup.smtpTitle'),
      smtpHost: t('setup.smtpHost'),
      smtpPort: t('setup.smtpPort'),
      smtpUser: t('setup.smtpUser'),
      smtpPassword: t('setup.smtpPassword'),
      smtpSecure: t('setup.smtpSecure'),
      smtpFromName: t('setup.smtpFromName'),
      testConnection: t('setup.testConnection'),
      testing: t('setup.testing'),
      testOk: t('setup.testOk'),
      applyIntro: t('setup.applyIntro'),
      applyButton: t('setup.applyButton'),
      applying: t('setup.applying'),
      restartRequiredTitle: t('setup.restartRequiredTitle'),
      restartRequiredBody: t('setup.restartRequiredBody'),
    }),
    [t, activeStep]
  );

  return {
    statusLoading,
    loadError,
    restartRequired,
    activeStep,
    stepCount: STEP_COUNT,
    form,
    errors,
    testStates,
    applyState,
    prefilling,
    viewModel,
    onBack: handleBack,
    onNext: handleNext,
    onMetadataBackendChange: handleMetadataBackendChange,
    onFileBackendChange: handleFileBackendChange,
    onFieldChange: handleFieldChange,
    onCheckboxChange: handleCheckboxChange,
    onTestConnection: handleTestConnection,
    onRegenerateSecret: handleRegenerateSecret,
    onApply: handleApply,
  };
}

function validateStep(step, form, t) {
  if (step === 0) {
    if (form.metadataBackend === 'postgresql') {
      return validateRequiredFields(form.pg, STEP_REQUIRED_FIELDS.postgresql, t);
    }
    return null;
  }
  if (step === 1) {
    return validateRequiredFields(
      form[form.fileBackend],
      STEP_REQUIRED_FIELDS[form.fileBackend],
      t
    );
  }
  if (step === 2) {
    const passwordError = validatePassword(form.admin.password, { minLength: 6 });
    if (passwordError) return getValidationMessage(passwordError, t);
    const secretError = validateRequired(form.jwt.secret, t('setup.jwtSecret'));
    if (secretError) return getValidationMessage(secretError, t);
    return null;
  }
  return null;
}
