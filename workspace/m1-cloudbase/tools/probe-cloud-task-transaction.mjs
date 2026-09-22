import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cli = [process.execPath, resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')];
const environment = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => {
  const index = line.indexOf('='); return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
}));
const secrets = parseJson((await execute(cli[0], [...cli.slice(1), 'secrets', 'get', '--json'], { cwd: root, encoding: 'utf8', windowsHide: true })).stdout).data;
try { require('@cloudbase/adapter-node'); } catch { /* Supported Node runtimes may not need this adapter. */ }
const app = require('@cloudbase/js-sdk').init({ env: required(environment.TCB_ENV_ID), secretId: required(secrets.secretId), secretKey: required(secrets.secretKey), sessionToken: required(secrets.token) });
const database = app.database();
const id = `diag_tx_${randomBytes(12).toString('base64url')}`;
const base = { organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1, deletedAt: null };
const results = [];
for (const collection of ['idempotency_records', 'tasks']) {
  try {
    await database.runTransaction(async (transaction) => {
      const reference = transaction.collection(collection).doc(`${id}_${collection}`);
      await reference.create({ ...base, diagnostic: true });
      await reference.remove();
    });
    results.push(`${collection}=passed`);
  } catch (error) {
    results.push(`${collection}=failed:${safeCode(error)}`);
  }
}
try {
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection('idempotency_records').doc('idem_0123456789abcdef');
    await reference.create({ ...base, diagnostic: true });
    await reference.remove();
  });
  results.push('idempotency_fingerprint_id=passed');
} catch (error) { results.push(`idempotency_fingerprint_id=failed:${safeCode(error)}`); }
try {
  await database.runTransaction(async (transaction) => {
    await transaction.collection('idempotency_records').doc('idem_0123456789abcdef').get();
  });
  results.push('idempotency_fingerprint_get=passed');
} catch (error) { results.push(`idempotency_fingerprint_get=failed:${safeCode(error)}`); }
try {
  await database.runTransaction(async (transaction) => {
    await transaction.collection('idempotency_records').where({ _id: 'idem_0123456789abcdef' }).limit(2).get();
  });
  results.push('idempotency_fingerprint_query=passed');
} catch (error) { results.push(`idempotency_fingerprint_query=failed:${safeCode(error)}`); }
for (const [label, collection, documentId] of [
  ['membership', 'class_memberships', 'mem_grade3_2_g3_01'],
  ['grant', 'teacher_class_grants', 'grt_teacher_demo_01_grade3_2'],
]) {
  try {
    await database.runTransaction(async (transaction) => { await transaction.collection(collection).doc(documentId).get(); });
    results.push(`${label}_transaction_get=passed`);
  } catch (error) { results.push(`${label}_transaction_get=failed:${safeCode(error)}`); }
}
try {
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection('idempotency_records').doc(`${id}_create_set`);
    await reference.create({ ...base, diagnostic: true, state: 'processing' });
    await reference.set({ ...base, version: 2, diagnostic: true, state: 'succeeded' });
    await reference.remove();
  });
  results.push('idempotency_create_set=passed');
} catch (error) { results.push(`idempotency_create_set=failed:${safeCode(error)}`); }
for (const [collection, criteria] of [
  ['class_memberships', { organizationId: 'org_qihang_demo', status: 'active', deletedAt: null }],
  ['teacher_class_grants', { organizationId: 'org_qihang_demo', teacherId: 'usr_teacher_demo_01', status: 'active', deletedAt: null }],
  ['learning_resources', { organizationId: 'org_qihang_demo', status: 'published', deletedAt: null }],
]) {
  try {
    const found = await database.collection(collection).where(criteria).limit(100).get();
    const rows = Array.isArray(found?.data) ? found.data : [];
    results.push(`${collection}_read=${rows.length > 0 ? 'passed' : 'empty'}`);
  } catch (error) { results.push(`${collection}_read=failed:${safeCode(error)}`); }
}
process.stdout.write(`${results.join('\n')}\n`);
process.exit(results.every((result) => result.endsWith('=passed')) ? 0 : 2);

function parseJson(output) { const start = Math.min(...[output.indexOf('{'), output.indexOf('[')].filter((value) => value >= 0)); return JSON.parse(output.slice(start)); }
function required(value) { if (typeof value !== 'string' || value.trim().length === 0) throw new Error('CONFIG_UNAVAILABLE'); return value.trim(); }
function safeCode(error) { const candidate = error && typeof error === 'object' ? error.errCode ?? error.code ?? error.errorCode ?? error.name : undefined; return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).replace(/[^A-Za-z0-9_.:-]/gu, '_').slice(0, 80) : 'UNKNOWN'; }
