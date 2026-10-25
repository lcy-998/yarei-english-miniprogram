// Narrow repair for M3 fictional teacher accounts created before canonical Auth subject mapping.
// Updates only exact legacy digests and preserves an operation-log audit in the same transaction.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error('CLOUD_API_FAILED');
  return parsed.data;
}

const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1 || environments[0].EnvId !== envId
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_OR_COST_GATE');
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const pepper = config.functions?.[0]?.envVariables?.YAREI_SUBJECT_PEPPER;
if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('SUBJECT_KEY_UNAVAILABLE');
const accounts = cliData(['user', 'list', '-e', envId, '--offset', '0', '--limit', '100', '--json']);
if (!Array.isArray(accounts) || accounts.length === 100
  || accounts.some(account => typeof account.Uid !== 'string' || !account.Uid)) {
  throw new Error('AUTH_ACCOUNT_SET_INCOMPLETE');
}

const bundlePath = resolve(root, '.runtime/repair-m3-native-account-subject-digests.cjs');
await mkdir(dirname(bundlePath), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-native-admin-readonly-audit-entry.ts')],
  outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundlePath);
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = api.createCloudBaseDocumentDatabase(app.database(), { pageSize: 100, maxPages: 2 });
const subjectDigest = value => `sd1_${createHmac('sha256', pepper)
  .update(`yarei:platform-subject:v1\u0000${value}`).digest('base64url')}`;
const canonicalByDigest = new Map();
const legacyByDigest = new Map();
for (const account of accounts) {
  canonicalByDigest.set(subjectDigest(`cloudbase:username:${account.Uid}`), account.Uid);
  legacyByDigest.set(subjectDigest(account.Uid), account.Uid);
}

const identityRows = await database.find('auth_identities', { provider: 'cloudbase_uid', status: 'active', deletedAt: null });
const candidates = identityRows.filter(row => legacyByDigest.has(row.providerSubjectDigest));
if (candidates.length !== 2 || identityRows.filter(row => canonicalByDigest.has(row.providerSubjectDigest)).length !== 8) {
  throw new Error('LEGACY_MAPPING_SET_CHANGED');
}
const plan = [];
for (const identity of candidates) {
  const uid = legacyByDigest.get(identity.providerSubjectDigest);
  const [user, roles, logs, duplicate] = await Promise.all([
    database.get('users', identity.userId),
    database.find('role_assignments', { organizationId: identity.organizationId,
      userId: identity.userId, role: 'teacher', status: 'active', deletedAt: null }),
    database.find('operation_logs', { organizationId: identity.organizationId,
      action: 'native_admin.user.created', targetType: 'user', targetId: identity.userId, result: 'succeeded' }),
    database.find('auth_identities', { provider: 'cloudbase_uid',
      providerSubjectDigest: subjectDigest(`cloudbase:username:${uid}`), deletedAt: null }),
  ]);
  if (!user || user.organizationId !== identity.organizationId || user.status !== 'active'
    || user.deletedAt !== null || !user.roles?.includes('teacher') || roles.length !== 1
    || logs.length !== 1 || duplicate.length !== 0 || !Number.isSafeInteger(identity.version)) {
    throw new Error('LEGACY_TEACHER_PRECONDITION_FAILED');
  }
  plan.push({ identity, uid, canonicalDigest: subjectDigest(`cloudbase:username:${uid}`) });
}

const now = new Date().toISOString();
let repaired = 0;
for (const item of plan) {
  const auditId = `audit_auth_subject_${createHash('sha256').update(item.identity._id).digest('hex').slice(0, 32)}`;
  const requestId = `req_${auditId}`;
  const result = await database.runTransaction(async tx => {
    const identity = await tx.get('auth_identities', item.identity._id);
    const existingAudit = await tx.get('operation_logs', auditId);
    const user = await tx.get('users', item.identity.userId);
    const roles = await tx.find('role_assignments', { organizationId: item.identity.organizationId,
      userId: item.identity.userId, role: 'teacher', status: 'active', deletedAt: null });
    const priorCanonical = await tx.find('auth_identities', { provider: 'cloudbase_uid',
      providerSubjectDigest: item.canonicalDigest, deletedAt: null });
    if (!identity || identity.version !== item.identity.version
      || identity.providerSubjectDigest !== item.identity.providerSubjectDigest
      || identity.status !== 'active' || identity.deletedAt !== null
      || !user || user.organizationId !== identity.organizationId || user.status !== 'active'
      || user.deletedAt !== null || !user.roles?.includes('teacher') || roles.length !== 1
      || priorCanonical.length !== 0 || existingAudit) throw new Error('REPAIR_TRANSACTION_PRECONDITION_FAILED');
    const next = { ...identity, providerSubjectDigest: item.canonicalDigest,
      version: identity.version + 1, updatedAt: now };
    const audit = { _id: auditId, organizationId: identity.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, requestId, actorUserId: null,
      actorRole: 'system', action: 'auth.identity_subject_normalized', targetType: 'user',
      targetId: identity.userId, result: 'succeeded', errorCode: null, occurredAt: now,
      metadata: { reason: '修正非生产环境开户账号的 CloudBase Auth 主题摘要格式，恢复登录会话解析。',
        operation: 'canonical_cloudbase_username_subject', identityVersionBefore: identity.version,
        identityVersionAfter: next.version } };
    if (!await tx.replace('auth_identities', identity._id, identity.version, next)
      || !await tx.append('operation_logs', audit)) throw new Error('REPAIR_TRANSACTION_CONFLICT');
    return { repaired: true };
  });
  if (!result.repaired) throw new Error('REPAIR_RESULT_INVALID');
  repaired += 1;
}
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction', candidates: plan.length,
  repaired, auditRecords: repaired, rawIdsOrSecretsPrinted: false }) + '\n');
