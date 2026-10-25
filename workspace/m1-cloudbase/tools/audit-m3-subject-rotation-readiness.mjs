// Read-only, redacted audit. Never print raw CloudBase UIDs, digests or secrets.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';

function cliJson(args) {
  const text = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const start = text.indexOf('{');
  if (start < 0) throw new Error('CLI_JSON_UNAVAILABLE');
  return JSON.parse(text.slice(start));
}

try {
  const envLine = readFileSync(resolve(root, '.env.local'), 'utf8')
    .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
  if (!envLine) throw new Error('ENV_ID_UNAVAILABLE');
  const envId = envLine.slice('TCB_ENV_ID='.length).trim();
  const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
  if (config.envId !== envId) throw new Error('ENVIRONMENT_MISMATCH');
  const pepper = config.functions?.[0]?.envVariables?.YAREI_SUBJECT_PEPPER;
  if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('SUBJECT_KEY_UNAVAILABLE');

  const environments = cliJson(['env', 'list', '--json']).data;
  if (!Array.isArray(environments) || environments.length !== 1
    || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
    || environments[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_ENVIRONMENT_GATE');
  const accounts = cliJson(['user', 'list', '-e', envId, '--offset', '0', '--limit', '100', '--json']).data;
  if (!Array.isArray(accounts) || accounts.length === 100
    || accounts.some(account => typeof account.Uid !== 'string' || !account.Uid)) {
    throw new Error('AUTH_ACCOUNT_SET_INCOMPLETE');
  }
  const temporary = cliJson(['secrets', 'get', '--json']).data;
  if (!temporary?.isTemporary || temporary.envId !== envId
    || Date.parse(temporary.expiredAt) <= Date.now() + 60_000) {
    throw new Error('TEMPORARY_CREDENTIALS_INVALID');
  }
  const cloudbase = require('@cloudbase/node-sdk');
  const app = cloudbase.init({ env: envId, secretId: temporary.secretId,
    secretKey: temporary.secretKey, sessionToken: temporary.token });
  const response = await app.database().collection('auth_identities').limit(100).get();
  const identities = response.data;
  if (!Array.isArray(identities) || identities.length === 100) {
    throw new Error('BUSINESS_IDENTITY_SET_INCOMPLETE');
  }

  const accountsByDigest = new Map();
  const legacyAccountsByDigest = new Map();
  for (const account of accounts) {
    const value = `cloudbase:username:${account.Uid}`;
    const digest = `sd1_${createHmac('sha256', pepper)
      .update(`yarei:platform-subject:v1\u0000${value}`).digest('base64url')}`;
    accountsByDigest.set(digest, (accountsByDigest.get(digest) ?? 0) + 1);
    const legacyDigest = `sd1_${createHmac('sha256', pepper)
      .update(`yarei:platform-subject:v1\u0000${account.Uid}`).digest('base64url')}`;
    legacyAccountsByDigest.set(legacyDigest, (legacyAccountsByDigest.get(legacyDigest) ?? 0) + 1);
  }
  const active = identities.filter(identity => identity.status === 'active' && identity.deletedAt == null);
  const unmatched = active.filter(identity => accountsByDigest.get(identity.providerSubjectDigest) !== 1);
  const matchedAccounts = active.filter(identity => accountsByDigest.get(identity.providerSubjectDigest) === 1);
  const legacyMatchedActiveIdentities = active.filter(identity => legacyAccountsByDigest.get(identity.providerSubjectDigest) === 1).length;
  const legacyIdentityRows = active.filter(identity => legacyAccountsByDigest.get(identity.providerSubjectDigest) === 1);
  let legacyNativeTeacherAccounts = 0;
  for (const identity of legacyIdentityRows) {
    const [userResult, rolesResult, logsResult] = await Promise.all([
      app.database().collection('users').doc(identity.userId).get(),
      app.database().collection('role_assignments').where({ organizationId: identity.organizationId,
        userId: identity.userId, role: 'teacher', status: 'active', deletedAt: null }).limit(10).get(),
      app.database().collection('operation_logs').where({ organizationId: identity.organizationId,
        action: 'native_admin.user.created', targetId: identity.userId,
        targetType: 'user', result: 'succeeded' }).limit(10).get(),
    ]);
    const userRows = Array.isArray(userResult.data) ? userResult.data : [userResult.data];
    const user = userRows.find(row => row?._id === identity.userId && row.organizationId === identity.organizationId);
    const roles = Array.isArray(rolesResult.data) ? rolesResult.data : [];
    const logs = Array.isArray(logsResult.data) ? logsResult.data : [];
    if (user?.status === 'active' && user.deletedAt == null && user.roles?.includes('teacher')
      && roles.length === 1 && logs.length === 1) legacyNativeTeacherAccounts += 1;
  }
  const duplicateDigests = [...accountsByDigest.values()].filter(count => count !== 1).length;
  process.stdout.write(JSON.stringify({ authAccounts: accounts.length,
    businessIdentities: identities.length, activeIdentities: active.length,
    matchedActiveIdentities: matchedAccounts.length, unmatchedActiveIdentities: unmatched.length,
    legacyMatchedActiveIdentities,
    legacyNativeTeacherAccounts,
    duplicateAuthDigests: duplicateDigests,
    trustedMappingComplete: unmatched.length === 0 && duplicateDigests === 0 }) + '\n');
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
    ? error.message : 'READ_ONLY_AUDIT_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
