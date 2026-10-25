// Read-only account and teaching-data inventory. Never print credentials or Auth UIDs.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const configuredEnv = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!configuredEnv || configuredEnv !== config.envId) throw new Error('ENVIRONMENT_MISMATCH');

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLI_RESPONSE_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error('CLI_REQUEST_FAILED');
  return parsed.data;
}

const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== configuredEnv || environments[0].Status !== 'NORMAL') {
  throw new Error('TARGET_ENVIRONMENT_UNCONFIRMED');
}
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== configuredEnv
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const authUsers = cliData(['user', 'list', '-e', configuredEnv,
  '--offset', '0', '--limit', '100', '--json']);
if (!Array.isArray(authUsers) || authUsers.length === 100) {
  throw new Error('AUTH_ACCOUNT_SET_INCOMPLETE');
}
const pepper = config.functions?.[0]?.envVariables?.YAREI_SUBJECT_PEPPER;
if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('SUBJECT_KEY_UNAVAILABLE');
const require = createRequire(resolve(root, 'package.json'));
const db = require('@cloudbase/node-sdk').init({ env: configuredEnv,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database();

const accountRows = [];
for (const account of authUsers) {
  const digest = `sd1_${createHmac('sha256', pepper)
    .update(`yarei:platform-subject:v1\u0000cloudbase:username:${account.Uid}`)
    .digest('base64url')}`;
  const response = await db.collection('auth_identities').where({
    provider: 'cloudbase_uid', providerSubjectDigest: digest,
  }).limit(10).get();
  const identities = Array.isArray(response.data) ? response.data : [];
  const business = [];
  for (const identity of identities) {
    const userResponse = await db.collection('users').doc(identity.userId).get();
    const user = (Array.isArray(userResponse.data) ? userResponse.data : [userResponse.data])
      .find(row => row?._id === identity.userId);
    const roleResponse = await db.collection('role_assignments')
      .where({ userId: identity.userId }).limit(20).get();
    business.push({ userId: identity.userId, organizationId: identity.organizationId,
      identityStatus: identity.status, userStatus: user?.status ?? 'missing',
      roles: (Array.isArray(roleResponse.data) ? roleResponse.data : [])
        .map(row => ({ role: row.role, status: row.status })) });
  }
  const phone = typeof account.Phone === 'string' ? account.Phone : '';
  accountRows.push({ phone: /^1380013800[012]$/u.test(phone)
    ? phone : phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null,
  nickname: account.NickName, authStatus: account.UserStatus,
  authType: account.Type, business });
}
process.stdout.write(JSON.stringify({ kind: 'accounts', total: accountRows.length,
  rows: accountRows }) + '\n');

for (const name of ['organizations', 'classes', 'users', 'auth_identities',
  'role_assignments', 'class_memberships', 'teacher_class_grants',
  'parent_student_links', 'business_sessions', 'business_session_slots',
  'learning_resources', 'reading_progress', 'vocabulary_progress',
  'reading_page_events', 'vocabulary_attempts', 'tasks',
  'task_assignments', 'submissions', 'review_feedback', 'task_templates',
  'checkin_activities', 'checkin_overrides', 'checkin_final_boards',
  'notification_events', 'notification_read_states', 'student_works',
  'task_recordings', 'task_dubbing_works', 'review_voice_drafts',
  'review_voice_operations', 'phonics_answers', 'media_retention_jobs',
  'operation_logs', 'idempotency_records']) {
  try {
    const result = await db.collection(name).count();
    process.stdout.write(JSON.stringify({ kind: 'count', collection: name,
      total: result.total ?? null }) + '\n');
  } catch (error) {
    const candidate = String(error?.code ?? 'UNAVAILABLE');
    process.stdout.write(JSON.stringify({ kind: 'count', collection: name,
      error: /^[A-Za-z0-9_-]{1,40}$/u.test(candidate) ? candidate : 'UNAVAILABLE' }) + '\n');
  }
}
for (const organizationId of ['org_qihang_demo', 'org_isolation_secondary']) {
  for (const name of ['users', 'tasks', 'task_assignments', 'submissions',
    'review_feedback', 'checkin_activities', 'student_works']) {
    const total = await db.collection(name).where({ organizationId }).count();
    process.stdout.write(JSON.stringify({ kind: 'organizationCount', organizationId,
      collection: name, total: total.total ?? null }) + '\n');
  }
}
