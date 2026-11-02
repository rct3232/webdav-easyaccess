/**
 * E2E execution axes.
 *
 * `CI` is the environment signal: any automated run must fail closed (`.only`,
 * missing resources, no server reuse). `E2E_PROFILE=release` is the policy
 * profile used by the release matrix: zero retries and the strict skip budget.
 * They are independent — a CI run may use the local profile, and a local run
 * may use the release profile.
 *
 * `CI=0`/`CI=false` are intentionally NOT treated as CI; unlike a bare
 * `Boolean(process.env.CI)`, the accepted values are explicit.
 */

const rawCI = process.env.CI;
const rawProfile = process.env.E2E_PROFILE;

export const isCI = rawCI === '1' || rawCI === 'true';
export const isReleaseProfile = rawProfile === 'release';
export const isStrictProfile = isCI || isReleaseProfile;

if (rawProfile && rawProfile !== 'local' && rawProfile !== 'release') {
  throw new Error(`E2E_PROFILE must be "local" or "release" (received "${rawProfile}")`);
}
