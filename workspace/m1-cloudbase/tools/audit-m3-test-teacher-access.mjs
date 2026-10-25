// Read-only audit of a user-supplied test account. The account identifier and Auth UID stay in memory.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const accountAliases = process.argv.slice(2);
if (accountAliases.length === 0 || accountAliases.some(alias => !/^1\d{10}$/u.test(alias))) {
  throw new Error('TEST_ACCOUNT_REQUIRED');
}
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(start));
  if (parsed.error) throw new Error('CLOUD_CLI_FAILED');
  return parsed.data;
}
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_GATE');
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const accounts = cliData(['user', 'list', '-e', envId, '--offset', '0', '--limit', '100', '--json']);
if (!Array.isArray(accounts) || accounts.length === 100) throw new Error('AUTH_ACCOUNT_SET_INCOMPLETE');
const pepper = config.functions?.[0]?.envVariables?.YAREI_SUBJECT_PEPPER;
if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('SUBJECT_KEY_UNAVAILABLE');
const cloudbase = createRequire(resolve(root, 'package.json'))('@cloudbase/node-sdk');
const db = cloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token }).database();
async function auditAlias(alias, aliasIndex) {
  const matches = accounts.filter(account => Object.values(account).includes(alias));
  if (matches.length !== 1 || typeof matches[0].Uid !== 'string') {
    return { aliasIndex, accountMatches: matches.length, identityFound: false };
  }
  const digest = `sd1_${createHmac('sha256', pepper)
    .update(`yarei:platform-subject:v1\u0000cloudbase:username:${matches[0].Uid}`).digest('base64url')}`;
  const identityResponse = await db.collection('auth_identities').where({ provider: 'cloudbase_uid',
    providerSubjectDigest: digest, status: 'active', deletedAt: null }).limit(3).get();
  const identities = Array.isArray(identityResponse.data) ? identityResponse.data : [];
  if (identities.length !== 1) return { aliasIndex, accountMatches: 1, activeIdentityCount: identities.length };
  const identity = identities[0];
  const userResult = await db.collection('users').doc(identity.userId).get();
  const userRows = Array.isArray(userResult.data) ? userResult.data : [userResult.data];
  const user = userRows.find(row => row?._id === identity.userId && row.organizationId === identity.organizationId);
  const grantId = `native_admin_${createHash('sha256').update(JSON.stringify([
    identity.organizationId, identity.userId])).digest('hex').slice(0, 40)}`;
  const [grantResult, roleResult, createdLogsResult, grantLogsResult, revokeLogsResult] = await Promise.all([
    db.collection('native_admin_grants').doc(grantId).get(),
    db.collection('role_assignments').where({ organizationId: identity.organizationId,
      userId: identity.userId, status: 'active', deletedAt: null }).limit(10).get(),
    db.collection('operation_logs').where({ organizationId: identity.organizationId,
      action: 'native_admin.user.created', targetType: 'user', targetId: identity.userId,
      result: 'succeeded' }).limit(10).get(),
    db.collection('operation_logs').where({ organizationId: identity.organizationId,
      action: 'native_admin.granted', targetType: 'native_admin_grant', targetId: identity.userId,
      result: 'succeeded' }).limit(10).get(),
    db.collection('operation_logs').where({ organizationId: identity.organizationId,
      action: 'native_admin.revoked', targetType: 'native_admin_grant', targetId: identity.userId,
      result: 'succeeded' }).limit(10).get(),
  ]);
  const grantRows = Array.isArray(grantResult.data) ? grantResult.data : [grantResult.data];
  const grant = grantRows.find(row => row?._id === grantId);
  const roles = Array.isArray(roleResult.data) ? roleResult.data : [];
  const createdLogs = Array.isArray(createdLogsResult.data) ? createdLogsResult.data : [];
  const grantLogs = Array.isArray(grantLogsResult.data) ? grantLogsResult.data : [];
  const revokeLogs = Array.isArray(revokeLogsResult.data) ? revokeLogsResult.data : [];
  return { aliasIndex, accountMatches: 1,
    identityActive: identity.status === 'active' && identity.deletedAt === null,
    businessUserActive: user?.status === 'active' && user.deletedAt === null,
    businessRoles: Array.isArray(user?.roles) ? user.roles : [],
    managementGrantStatus: grant?.status ?? 'none',
    managementPermissions: Array.isArray(grant?.permissions) ? grant.permissions : [],
    createdByA03: createdLogs.length === 1,
    successfulGrantEvents: grantLogs.length,
    successfulRevokeEvents: revokeLogs.length,
    activeRoleAssignments: roles.map(row => ({ role: row.role,
      permissions: Array.isArray(row.permissions) ? row.permissions : [], scopeType: row.scopeType ?? null })) };
}
const audit = await Promise.all(accountAliases.map((alias, index) => auditAlias(alias, index + 1)));
process.stdout.write(JSON.stringify(audit) + '\n');
