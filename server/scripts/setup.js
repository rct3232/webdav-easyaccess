'use strict';

/**
 * CLI first-run setup tool — the headless counterpart of the browser setup
 * wizard. Shares the exact apply core with POST /api/setup/apply
 * (server/domains/setup/setupCore.js) and mirrors the server boot subset
 * (server/index.js runBoot) so "what the CLI sees" equals "what the next
 * server boot sees".
 *
 * @see docs/features/setup-cli.md
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const readline = require('readline');

const { resolveEnvPath } = require('../infrastructure/envPath');
const { computeSetupStatus } = require('../infrastructure/setupStatus');
const {
  createConfigResolver,
  setSharedResolver,
  getSharedResolver,
} = require('../infrastructure/configResolver');
const { initMetadataSchema, ensureDefaultAdmin } = require('../store/bootstrap');
const Settings = require('../models/Settings');
const setupCore = require('../domains/setup/setupCore');
const backendProbe = require('../infrastructure/backendProbe');

// Mount base for the resolved env file must match server/index.js:10-12 and
// setupCore.js:29 (SERVER_ROOT two levels up from domains/setup = <server>).
// This file lives in <server>/scripts, so the server root is one level up.
const SERVER_ROOT = path.join(__dirname, '..');

const SECRET_MASK = '****';

const BOOLEAN_FLAGS = new Set(['help', 'status', 'check', 'yes']);

// Every accepted value flag mapped to its canonical name (aliases normalized).
const VALUE_FLAG_CANONICAL = {
  'file-backend': 'file-backend',
  's3-bucket': 's3-bucket',
  'aws-region': 'aws-region',
  'aws-access-key-id': 'aws-access-key-id',
  'aws-secret-access-key': 'aws-secret-access-key',
  's3-secret-key': 'aws-secret-access-key',
  's3-endpoint': 's3-endpoint',
  'webdav-url': 'webdav-url',
  'webdav-username': 'webdav-username',
  'webdav-password': 'webdav-password',
  'webdav-auth-type': 'webdav-auth-type',
  'admin-password': 'admin-password',
  'jwt-secret': 'jwt-secret',
  'jwt-expires-in': 'jwt-expires-in',
  port: 'port',
  'cors-origins': 'cors-origins',
  'email-host': 'email-host',
  'email-port': 'email-port',
  'email-user': 'email-user',
  'email-password': 'email-password',
  'email-secure': 'email-secure',
  'email-from': 'email-from',
};

const USAGE = `
Usage:
  node server/scripts/setup.js                           interactive (readline) first-run wizard
  node server/scripts/setup.js --help                    print this reference and exit
  node server/scripts/setup.js --status                  print the derived setup state and exit
  node server/scripts/setup.js <apply flags> --yes       non-interactive apply (skips confirmation)
  node server/scripts/setup.js <file flags> --check      test the file-backend connection (no writes)

Apply / check flags (values use --flag=value):
  --file-backend=s3|webdav                               file storage backend (required)
  --s3-bucket=NAME                                       S3 credential block
  --aws-region=REGION                                    S3 region
  --aws-access-key-id=KEY                                S3 access key id
  --aws-secret-access-key=SECRET                         S3 secret access key
  --s3-secret-key=SECRET                                 alias for --aws-secret-access-key
  --s3-endpoint=URL                                      optional custom S3-compatible endpoint
  --webdav-url=URL                                       WebDAV credential block
  --webdav-username=USER                                 WebDAV username
  --webdav-password=PASS                                 WebDAV password
  --webdav-auth-type=auto|basic|digest                   optional WebDAV auth type
  --admin-password=PASS                                  new admin password (username is fixed 'admin')
  --jwt-secret=SECRET                                    JWT signing secret (optional — when omitted the server generates an ephemeral per-boot secret)
  --jwt-expires-in=DURATION                              session duration, e.g. 30m or 7d
  --port=NUMBER                                          server port
  --cors-origins=LIST                                    allowed browser origins (comma-separated)
  --email-host=HOST --email-port=NUMBER --email-user=USER   optional SMTP block
  --email-password=PASS --email-secure=true|false --email-from=NAME
  --check                                                run the connection probe for --file-backend
  --yes                                                  confirm a non-interactive apply

Flag values may also be supplied as environment variables of the form
WEA_SETUP_<UPPER_FLAG> (e.g. WEA_SETUP_ADMIN_PASSWORD, WEA_SETUP_WEBDAV_PASSWORD,
WEA_SETUP_AWS_SECRET_ACCESS_KEY). Secrets are never echoed; on an interactive
terminal a missing secret is prompted for with hidden input.

The metadata backend (the remote WEA_DB_* block, or the default sqlite store)
is .env-owned and never set by this tool.

Exit codes:
  0 success (help/status/probe-ok/apply-ok)
  1 refusal, validation failure, probe failure, boot or apply error
  2 usage error
`;

class UsageError extends Error {}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function describeError(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

function parseFlags(argv) {
  const values = {};
  const bools = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const raw = eq === -1 ? true : arg.slice(eq + 1);
    if (BOOLEAN_FLAGS.has(name)) {
      bools[name] = raw === true ? true : isTruthy(raw);
      continue;
    }
    const canonical = VALUE_FLAG_CANONICAL[name];
    if (canonical === undefined) {
      throw new UsageError(`Unknown flag: --${name}`);
    }
    if (raw === true) {
      throw new UsageError(`Flag --${name} requires a value (--${name}=<value>)`);
    }
    values[canonical] = raw;
  }
  return { values, bools };
}

// Env name for a canonical flag, e.g. 'admin-password' -> 'WEA_SETUP_ADMIN_PASSWORD'.
function envFlagName(canonicalFlag) {
  return `WEA_SETUP_${canonicalFlag.toUpperCase().replace(/-/g, '_')}`;
}

// Flag value first, then the WEA_SETUP_<FLAG> env fallback.
function readCanonical(canonicalFlag, values, env) {
  if (isNonEmpty(values[canonicalFlag])) return values[canonicalFlag];
  const fromEnv = env[envFlagName(canonicalFlag)];
  if (isNonEmpty(fromEnv)) return fromEnv;
  return undefined;
}

/**
 * A readline prompter over an interactive terminal. Secret answers are entered
 * with echo suppressed (never shown on screen or logged).
 */
function createPrompter(input, rlOut) {
  const terminal = Boolean(input && input.isTTY && rlOut && rlOut.isTTY);
  const rl = readline.createInterface({ input, output: rlOut, terminal });
  let muted = false;
  rl._writeToOutput = (stringToWrite) => {
    if (!muted) rl.output.write(stringToWrite);
  };

  function ask(question) {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(String(answer))));
  }

  function askHidden(question) {
    return new Promise((resolve) => {
      rl.pause();
      rlOut.write(question);
      muted = true;
      rl.resume();
      rl.question('', (answer) => {
        muted = false;
        rlOut.write('\n');
        resolve(String(answer));
      });
    });
  }

  async function confirm(question) {
    const answer = await ask(question);
    return /^\s*y(es)?\s*$/i.test(answer);
  }

  function close() {
    rl.close();
  }

  return { ask, askHidden, confirm, close };
}

/**
 * Resolve a required-or-optional secret: prefer an explicit value, then a
 * hidden TTY prompt, otherwise leave it unset for validation to report.
 */
async function promptSecret(existing, label, prompter) {
  if (isNonEmpty(existing)) return existing;
  if (prompter) {
    const answer = (await prompter.askHidden(`${label}: `)).trim();
    return answer === '' ? undefined : answer;
  }
  return undefined;
}

/**
 * Collect the file-backend block (backend + its credential fields) from the
 * canonical flag values with WEA_SETUP_* env fallbacks.
 */
async function collectFileFromFlags(values, env, prompter) {
  const read = (key) => readCanonical(key, values, env);
  const backend = read('file-backend');
  if (backend === 's3') {
    return {
      backend: 's3',
      bucket: read('s3-bucket'),
      region: read('aws-region'),
      accessKeyId: read('aws-access-key-id'),
      secretAccessKey: await promptSecret(
        read('aws-secret-access-key'),
        'S3 secret access key',
        prompter
      ),
      endpoint: read('s3-endpoint'),
    };
  }
  if (backend === 'webdav') {
    return {
      backend: 'webdav',
      url: read('webdav-url'),
      username: read('webdav-username'),
      password: await promptSecret(read('webdav-password'), 'WebDAV password', prompter),
      authType: read('webdav-auth-type'),
    };
  }
  return { backend };
}

async function collectApplyFromFlags(values, env, prompter) {
  const read = (key) => readCanonical(key, values, env);
  const file = await collectFileFromFlags(values, env, prompter);

  const server = {};
  const port = read('port');
  if (isNonEmpty(port)) server.port = port;
  const corsOrigins = read('cors-origins');
  if (isNonEmpty(corsOrigins)) server.corsOrigins = corsOrigins;

  const email = {};
  const emailFields = {
    host: read('email-host'),
    port: read('email-port'),
    user: read('email-user'),
    password: read('email-password'),
    secure: read('email-secure'),
    fromName: read('email-from'),
  };
  for (const [key, value] of Object.entries(emailFields)) {
    if (isNonEmpty(value)) email[key] = value;
  }

  return {
    file,
    adminPassword: await promptSecret(read('admin-password'), 'New admin password', prompter),
    jwtSecret: read('jwt-secret'),
    jwtExpiresIn: read('jwt-expires-in'),
    ...(Object.keys(server).length > 0 ? { server } : {}),
    ...(Object.keys(email).length > 0 ? { email } : {}),
  };
}

/**
 * Build the shared apply payload from a collected answer object. The metadata
 * block is never set: the metadata backend is .env-owned (wizard D7 rule).
 * The jwt block is optional — a secret is sent only when the operator supplied
 * one; otherwise the server generates an ephemeral per-boot secret.
 */
function toApplyPayload(collected) {
  const file = {};
  if (collected.file) {
    for (const [key, value] of Object.entries(collected.file)) {
      if (isNonEmpty(value)) file[key] = value;
    }
  }
  const payload = {
    file,
    admin: { password: collected.adminPassword },
  };
  const jwt = {};
  if (isNonEmpty(collected.jwtSecret)) jwt.secret = collected.jwtSecret;
  if (isNonEmpty(collected.jwtExpiresIn)) jwt.expiresIn = collected.jwtExpiresIn;
  if (Object.keys(jwt).length > 0) payload.jwt = jwt;
  if (collected.server && Object.keys(collected.server).length > 0)
    payload.server = collected.server;
  if (collected.email && Object.keys(collected.email).length > 0) payload.email = collected.email;
  return payload;
}

function probePayloadFromFile(file) {
  const out = {};
  if (!file) return out;
  for (const [key, value] of Object.entries(file)) {
    if (key !== 'backend' && isNonEmpty(value)) out[key] = value;
  }
  return out;
}

// Boot subset of server/index.js runBoot (lines 228-267): schema, resolver
// prime + install, default-admin seeding. Backend selection is presence-based
// and validated inside storage.getBackend (partial WEA_DB_* throws here).
async function bootSetupStore() {
  await initMetadataSchema();
  const resolver = createConfigResolver({ settingsStore: Settings });
  await resolver.loadAll();
  setSharedResolver(resolver);
  await ensureDefaultAdmin();
}

// Derived state exactly as the setup routes compute it (requireSetupIncomplete
// in routes.js:144-157 and GET /api/setup/status): effective config normalized
// for status (mask-drop rule), then the pure required-key completeness rules.
async function readSetupStatus() {
  const effective = await getSharedResolver().getEffectiveConfig();
  return computeSetupStatus(process.env, {
    effectiveConfig: setupCore.normalizeEffectiveForStatus(effective),
  });
}

async function isSetupComplete() {
  return (await readSetupStatus()).setup_complete === true;
}

// Load the app's env file exactly like server/index.js:10-28 — the CLI resolves
// the same DOTENV_CONFIG_PATH-aware path the server boot reads, so both see the
// same values. Must run before any module call that reads process.env.
function loadDotenv() {
  const envPath = resolveEnvPath(SERVER_ROOT);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  } else {
    dotenv.config();
  }
}

function printSummary(output, payload) {
  const lines = [];
  lines.push('Summary of the configuration to apply:');
  if (payload.file) {
    for (const [key, value] of Object.entries(payload.file)) {
      if (key === 'backend') {
        lines.push(`  file backend: ${value}`);
      } else if (key === 'secretAccessKey' || key === 'password') {
        lines.push(`  ${key}: ${isNonEmpty(value) ? SECRET_MASK : '(unset)'}`);
      } else {
        lines.push(`  ${key}: ${isNonEmpty(value) ? value : '(unset)'}`);
      }
    }
  }
  lines.push(
    `  admin password: ${isNonEmpty(payload.admin && payload.admin.password) ? SECRET_MASK : '(unset)'}`
  );
  lines.push(
    `  jwt.secret: ${payload.jwt && isNonEmpty(payload.jwt.secret) ? SECRET_MASK : '(unset)'}`
  );
  if (payload.jwt && isNonEmpty(payload.jwt.expiresIn))
    lines.push(`  jwt.expiresIn: ${payload.jwt.expiresIn}`);
  if (payload.server) lines.push(`  server: ${JSON.stringify(payload.server)}`);
  if (payload.email) {
    const email = { ...payload.email };
    if (isNonEmpty(email.password)) email.password = SECRET_MASK;
    lines.push(`  email: ${JSON.stringify(email)}`);
  }
  output.log(lines.join('\n'));
}

/**
 * Validate then apply through the shared core. On success print the
 * restart_required guidance; on validation failure print { message, fields }
 * and exit non-zero without any write.
 */
async function applyAndReport(payload, output) {
  const validation = setupCore.validateApplyPayload(payload);
  if (validation) {
    output.error(`Invalid setup payload: ${validation.message}`);
    output.error(JSON.stringify({ fields: validation.fields }, null, 2));
    return 1;
  }
  try {
    const result = await setupCore.applySetup(payload);
    output.log('Setup configuration applied successfully.');
    output.log(JSON.stringify(result));
    output.log(
      'Restart the server now: on the next boot it binds all interfaces and runs fully configured.'
    );
    output.log(
      'Post-setup configuration is managed through the admin UI and .env, not this first-run tool.'
    );
    return 0;
  } catch (error) {
    if (error && error.errorCode === backendProbe.SETUP_INVALID_PAYLOAD_CODE) {
      output.error(`Invalid setup payload: ${error.message}`);
      if (error.fields) output.error(JSON.stringify({ fields: error.fields }, null, 2));
      return 1;
    }
    output.error(`Setup apply failed: ${describeError(error)}`);
    return 1;
  }
}

async function runProbeForCollected(collected, output) {
  const file = collected && collected.file;
  if (!file) return false;
  try {
    await backendProbe.runProbe(file.backend, probePayloadFromFile(file));
    output.log(`Connection OK for the ${file.backend} file backend.`);
    return true;
  } catch (error) {
    output.error(
      `Connection test failed for the ${file.backend} file backend: ${
        error.message || error.errorCode || 'unknown error'
      }`
    );
    return false;
  }
}

async function isSecretSet(current, key) {
  return current[key] === SECRET_MASK;
}

function currentValue(current, key) {
  const value = current[key];
  return value === undefined || value === SECRET_MASK ? '' : String(value);
}

async function collectInteractive(prompter, current) {
  const defaultBackend = currentValue(current, 'WEA_FILE_STORAGE') || 's3';
  const backendChoice = (
    await prompter.ask(`File storage backend (s3/webdav) [${defaultBackend}]: `)
  )
    .trim()
    .toLowerCase();
  const backend = backendChoice || defaultBackend;
  const file = { backend };

  if (backend === 's3') {
    file.bucket = (
      await prompter.ask(`S3 bucket [${currentValue(current, 'S3_BUCKET')}]: `)
    ).trim();
    file.region = (
      await prompter.ask(`AWS region [${currentValue(current, 'AWS_REGION')}]: `)
    ).trim();
    file.accessKeyId = (
      await prompter.ask(`AWS access key id [${currentValue(current, 'AWS_ACCESS_KEY_ID')}]: `)
    ).trim();
    if (await isSecretSet(current, 'AWS_SECRET_ACCESS_KEY')) {
      const answer = await prompter.askHidden(
        'AWS secret access key (already set - empty keeps it): '
      );
      file.secretAccessKey = answer.trim() === '' ? SECRET_MASK : answer.trim();
    } else {
      file.secretAccessKey = (await prompter.askHidden('AWS secret access key: ')).trim();
    }
    const endpoint = (
      await prompter.ask(`S3 endpoint, optional [${currentValue(current, 'S3_ENDPOINT')}]: `)
    ).trim();
    if (endpoint) file.endpoint = endpoint;
  } else {
    file.url = (await prompter.ask(`WebDAV url [${currentValue(current, 'WEBDAV_URL')}]: `)).trim();
    file.username = (
      await prompter.ask(`WebDAV username [${currentValue(current, 'WEBDAV_USERNAME')}]: `)
    ).trim();
    if (await isSecretSet(current, 'WEBDAV_PASSWORD')) {
      const answer = await prompter.askHidden('WebDAV password (already set - empty keeps it): ');
      file.password = answer.trim() === '' ? SECRET_MASK : answer.trim();
    } else {
      file.password = (await prompter.askHidden('WebDAV password: ')).trim();
    }
    const authType = (
      await prompter.ask(
        `WebDAV auth type (auto/basic/digest) [${currentValue(current, 'WEBDAV_AUTH_TYPE') || 'auto'}]: `
      )
    ).trim();
    if (authType) file.authType = authType;
  }

  const adminPassword = (
    await prompter.askHidden('New admin password (username is fixed as admin): ')
  ).trim();
  const jwtDefaultHint = (await isSecretSet(current, 'JWT_SECRET'))
    ? 'Enter to keep the existing secret'
    : 'Enter to skip (the server generates an ephemeral secret per boot)';
  const jwtInput = (await prompter.askHidden(`JWT signing secret (${jwtDefaultHint}): `)).trim();
  let jwtSecret;
  if (jwtInput === '') {
    jwtSecret = (await isSecretSet(current, 'JWT_SECRET')) ? SECRET_MASK : undefined;
  } else {
    jwtSecret = jwtInput;
  }
  const expiresInDefault = currentValue(current, 'JWT_EXPIRES_IN');
  const expiresIn = (
    await prompter.ask(`JWT expiry, e.g. 30m or 7d [${expiresInDefault}]: `)
  ).trim();
  const jwtExpiresIn = expiresIn || expiresInDefault || undefined;

  const portDefault = currentValue(current, 'PORT');
  const port = (await prompter.ask(`Server port [${portDefault || '5001'}]: `)).trim();
  const corsOrigins = (
    await prompter.ask(
      `Allowed CORS origins (comma-separated, optional) [${currentValue(current, 'CORS_ORIGINS')}]: `
    )
  ).trim();

  const server = {};
  const resolvedPort = port || portDefault;
  if (resolvedPort) server.port = resolvedPort;
  const resolvedCors = corsOrigins || currentValue(current, 'CORS_ORIGINS');
  if (resolvedCors) server.corsOrigins = resolvedCors;

  const collected = {
    file,
    adminPassword,
    jwtSecret,
    ...(jwtExpiresIn ? { jwtExpiresIn } : {}),
  };
  if (Object.keys(server).length > 0) collected.server = server;

  const emailDefault = isNonEmpty(current['EMAIL_HOST']) ? 'y' : 'n';
  const emailChoice = (
    await prompter.ask(`Configure SMTP email notifications? (y/N) [${emailDefault}]: `)
  )
    .trim()
    .toLowerCase();
  if (emailChoice === 'y' || emailChoice === 'yes') {
    const email = {};
    const host = (
      await prompter.ask(`SMTP host [${currentValue(current, 'EMAIL_HOST')}]: `)
    ).trim();
    const hostResolved = host || currentValue(current, 'EMAIL_HOST');
    if (hostResolved) email.host = hostResolved;
    const portPrompt = (
      await prompter.ask(`SMTP port [${currentValue(current, 'EMAIL_PORT') || '587'}]: `)
    ).trim();
    const portResolved = portPrompt || currentValue(current, 'EMAIL_PORT');
    if (portResolved) email.port = portResolved;
    const user = (
      await prompter.ask(`SMTP user [${currentValue(current, 'EMAIL_USER')}]: `)
    ).trim();
    const userResolved = user || currentValue(current, 'EMAIL_USER');
    if (userResolved) email.user = userResolved;
    if (await isSecretSet(current, 'EMAIL_PASSWORD')) {
      const answer = await prompter.askHidden('SMTP password (already set - empty keeps it): ');
      if (answer.trim() !== '') email.password = answer.trim();
      else if (isNonEmpty(current['EMAIL_PASSWORD'])) email.password = SECRET_MASK;
    } else {
      const password = (await prompter.askHidden('SMTP password (optional): ')).trim();
      if (password) email.password = password;
    }
    const secureDefault = currentValue(current, 'EMAIL_SECURE') || 'false';
    const secureChoice = (
      await prompter.ask(`Use TLS/SSL? (y/N) [${secureDefault === 'true' ? 'y' : 'n'}]: `)
    )
      .trim()
      .toLowerCase();
    if (secureChoice === 'y' || secureChoice === 'yes') email.secure = 'true';
    else if (secureChoice === 'n' || secureChoice === 'no') email.secure = 'false';
    else email.secure = secureDefault;
    const fromName = (
      await prompter.ask(`Sender name [${currentValue(current, 'EMAIL_FROM_NAME')}]: `)
    ).trim();
    const fromResolved = fromName || currentValue(current, 'EMAIL_FROM_NAME');
    if (fromResolved) email.fromName = fromResolved;
    if (Object.keys(email).length > 0) collected.email = email;
  }

  return collected;
}

async function runStatus(output) {
  try {
    loadDotenv();
    await bootSetupStore();
    output.log(JSON.stringify(await readSetupStatus(), null, 2));
    return 0;
  } catch (error) {
    output.error(`setup --status failed: ${describeError(error)}`);
    return 1;
  }
}

async function runCheck(values, output, input, rlOut) {
  const prompter = input && input.isTTY ? createPrompter(input, rlOut) : null;
  let file;
  try {
    file = await collectFileFromFlags(values, process.env, prompter);
  } catch (error) {
    output.error(`setup --check failed: ${describeError(error)}`);
    return 1;
  } finally {
    if (prompter) prompter.close();
  }
  if (!file || (file.backend !== 's3' && file.backend !== 'webdav')) {
    output.error('--check requires --file-backend=s3|webdav with its credential flags.');
    output.error(USAGE);
    return 2;
  }
  try {
    await backendProbe.runProbe(file.backend, probePayloadFromFile(file));
    output.log(
      `Connection OK - the ${file.backend} file backend is reachable with the provided credentials.`
    );
    return 0;
  } catch (error) {
    output.error(`Connection test failed for the ${file.backend} file backend.`);
    output.error(`  message: ${error.message || error.errorCode || 'unknown error'}`);
    if (error.errorCode) output.error(`  errorCode: ${error.errorCode}`);
    if (error.reason) output.error(`  reason: ${error.reason}`);
    return 1;
  }
}

async function runFlagApply(values, bools, output, input, rlOut) {
  try {
    loadDotenv();
    await bootSetupStore();
  } catch (error) {
    output.error(`setup failed: ${describeError(error)}`);
    return 1;
  }

  if (await isSetupComplete()) {
    output.error(
      'Setup is already complete. The first-run tool refuses to overwrite an existing ' +
        'configuration; manage post-setup settings through the admin UI and .env.'
    );
    return 1;
  }

  const tty = Boolean(input && input.isTTY);
  const prompter = tty ? createPrompter(input, rlOut) : null;
  let collected;
  try {
    collected = await collectApplyFromFlags(values, process.env, prompter);
  } catch (error) {
    output.error(`setup failed: ${describeError(error)}`);
    return 1;
  }

  const payload = toApplyPayload(collected);
  let confirmed = bools.yes === true;
  if (!bools.yes) {
    if (!prompter) {
      output.error('A non-interactive apply requires --yes to confirm writes.');
      output.error(USAGE);
      return 2;
    }
    printSummary(output, payload);
    confirmed = await prompter.confirm('Apply this setup configuration? (y/N): ');
    if (!confirmed) {
      output.log('Setup aborted - nothing was written.');
      if (prompter) prompter.close();
      return 0;
    }
  }
  if (prompter) prompter.close();
  return applyAndReport(payload, output);
}

async function runInteractive(output, input, rlOut) {
  try {
    loadDotenv();
    await bootSetupStore();
  } catch (error) {
    output.error(`setup failed: ${describeError(error)}`);
    return 1;
  }

  let status;
  try {
    status = await readSetupStatus();
  } catch (error) {
    output.error(`setup failed: ${describeError(error)}`);
    return 1;
  }
  if (status.setup_complete) {
    output.error(
      'Setup is already complete. The first-run tool refuses to overwrite an existing ' +
        'configuration; manage post-setup settings through the admin UI and .env.'
    );
    return 1;
  }

  const prompter = createPrompter(input, rlOut);
  try {
    const collected = await collectInteractive(prompter, status.current || {});
    const payload = toApplyPayload(collected);
    printSummary(output, payload);
    if (await prompter.confirm('Run a connection check against the file backend now? (y/N): ')) {
      const ok = await runProbeForCollected(collected, output);
      if (
        !ok &&
        !(await prompter.confirm('Connection check failed. Continue applying anyway? (y/N): '))
      ) {
        output.log('Setup aborted - nothing was written.');
        return 0;
      }
    }
    if (!(await prompter.confirm('Apply this setup configuration? (y/N): '))) {
      output.log('Setup aborted - nothing was written.');
      return 0;
    }
    return await applyAndReport(payload, output);
  } catch (error) {
    output.error(`setup failed: ${describeError(error)}`);
    return 1;
  } finally {
    prompter.close();
  }
}

/**
 * CLI entry point. Modes:
 *   --help / --status: always run (no writes; status boots the store first).
 *   no flags + TTY: interactive readline wizard (refuses when complete).
 *   --check: run the file-backend probe with the supplied flags (no writes).
 *   any other flags: non-interactive apply (refuses when complete; requires
 *   --yes unless an interactive confirmation is available).
 *
 * @param {string[]} argv process.argv.slice(2)
 * @param {{ output?: {log:Function,error:Function,warn:Function}, input?: NodeJS.ReadableStream & {isTTY?:boolean}, rlOut?: NodeJS.WritableStream & {isTTY?:boolean} }} [deps]
 * @returns {Promise<number>} process exit code
 */
async function main(argv = [], deps = {}) {
  const output = deps.output || console;
  const input = deps.input || process.stdin;
  const rlOut = deps.rlOut || process.stdout;

  if (argv.some((arg) => arg === '--help' || arg.startsWith('--help='))) {
    output.log(USAGE);
    return 0;
  }

  if (argv.length === 0) {
    if (!input.isTTY) {
      output.error('Interactive setup requires an interactive terminal (stdin TTY).');
      output.error('Use --help for the flag-driven mode.');
      output.error(USAGE);
      return 2;
    }
    return runInteractive(output, input, rlOut);
  }

  let values;
  let bools;
  try {
    ({ values, bools } = parseFlags(argv));
  } catch (error) {
    if (error instanceof UsageError) {
      output.error(error.message);
      output.error(USAGE);
      return 2;
    }
    throw error;
  }

  if (bools.help) {
    output.log(USAGE);
    return 0;
  }
  if (bools.status) {
    return runStatus(output);
  }
  if (bools.check) {
    return runCheck(values, output, input, rlOut);
  }
  return runFlagApply(values, bools, output, input, rlOut);
}

async function runAsScript() {
  const code = await main(process.argv.slice(2));
  const { getBackend, closePgPool, closeSqliteDb } = require('../store/storage');
  try {
    if (getBackend() === 'postgresql') {
      await closePgPool();
    } else {
      await closeSqliteDb();
    }
  } catch {
    // best-effort cleanup; the exit code already reflects the result
  }
  process.exit(code);
}

if (require.main === module) {
  runAsScript().catch((error) => {
    console.error('setup: fatal error:', describeError(error));
    process.exit(1);
  });
}

module.exports = { main, parseFlags, toApplyPayload };
