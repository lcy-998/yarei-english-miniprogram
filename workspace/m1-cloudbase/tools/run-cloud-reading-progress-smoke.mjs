import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environment = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => {
  const separator = line.indexOf('=');
  return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
}));
const envId = environment.TCB_ENV_ID;
if (typeof envId !== 'string' || envId.length === 0) throw new Error('MISSING_DEV_ENVIRONMENT');

const sdk = require('@cloudbase/js-sdk');
sdk.useAdapters(require('@cloudbase/adapter-node').default);
const cli = [process.execPath, 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'];
const resourceId = 'res_reading_zoo_cloud_v2';

const account = await cliJson(['user', 'list', '-e', envId, '--name', 'demo_student_01', '--json']);
const user = Array.isArray(account.data) ? account.data.find((item) => item?.Name === 'demo_student_01') : null;
if (!user?.Uid) throw new Error('VIRTUAL_STUDENT_NOT_FOUND');
const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
await cliJson(['user', 'update', '-e', envId, user.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
const app = sdk.init({ env: envId });
await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_student_01', password });
const bootstrap = await call('auth-session', 'bootstrap', {}, null);
if (!bootstrap.ok || typeof bootstrap.data?.sessionId !== 'string') fail('bootstrap', bootstrap);
const selected = await call('auth-session', 'selectRole', { role: 'student' }, bootstrap.data.sessionId);
if (!selected.ok || typeof selected.data?.sessionId !== 'string') fail('select_role', selected);
const token = selected.data.sessionId;

const readingList = await call('content-query', 'listReadingResources', {}, token);
if (!readingList.ok || !Array.isArray(readingList.data) || !readingList.data.some((item) => item?.id === resourceId)) fail('list_reading_resources', readingList);
const vocabulary = await call('content-query', 'getVocabularyPack', { resourceId: 'res_vocabulary_animals_cloud_v1' }, token);
if (!vocabulary.ok || typeof vocabulary.data?.grade !== 'string' || !Array.isArray(vocabulary.data?.words)
  || !vocabulary.data.words.every((word) => typeof word?.word === 'string' && Array.isArray(word?.syllables))) fail('get_vocabulary_pack', vocabulary);
const vocabularyProgress = await call('learning-progress-query', 'getVocabularyProgress', { packId: 'res_vocabulary_animals_cloud_v1' }, token);
if (!vocabularyProgress.ok || (vocabularyProgress.data !== null && typeof vocabularyProgress.data?.version !== 'number')) fail('get_vocabulary_progress', vocabularyProgress);

const resource = await call('content-query', 'getReadingResource', { resourceId }, token);
const chapter = resource.ok && Array.isArray(resource.data?.chapters) ? resource.data.chapters[0] : null;
const page = chapter && Array.isArray(chapter.pages) ? chapter.pages[0] : null;
if (!resource.ok || typeof chapter?.id !== 'string' || typeof page?.id !== 'string' || typeof page?.pageNumber !== 'number') fail('get_reading_resource', resource);

const current = await call('learning-progress-query', 'getReadingProgress', { resourceId }, token);
if (!current.ok || (current.data !== null && typeof current.data?.version !== 'number')) fail('get_reading_progress', current);
const expectedVersion = current.data?.version ?? 0;
const payload = {
  resourceId,
  chapterId: chapter.id,
  pageId: page.id,
  pageNumber: page.pageNumber,
  favorite: current.data?.favorite === true,
};
const operationId = `reading_smoke_${randomBytes(9).toString('hex')}`;
const saved = await call('learning-progress-command', 'saveReadingProgress', payload, token, { operationId, expectedVersion });
if (!saved.ok || saved.data?.version !== expectedVersion + 1) fail('save_reading_progress', saved);
const repeated = await call('learning-progress-command', 'saveReadingProgress', payload, token, { operationId, expectedVersion });
if (!repeated.ok || repeated.data?.version !== saved.data.version) fail('idempotent_retry', repeated);
process.stdout.write('reading_list=passed; vocabulary_pack=passed; vocabulary_progress_query=passed; reading_resource=passed; progress_query=passed; progress_save=passed; idempotent_retry=passed\n');
await new Promise((resolve) => process.stdout.write('', resolve));
process.exit(0);

async function call(name, action, payload, token, options = {}) {
  try {
    const response = await app.callFunction({
      name,
      data: {
        apiVersion: 'm1.v1', action, payload, ...(token === null ? {} : { businessSessionToken: token }),
        ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
        ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
      },
      parse: true,
    });
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) {
    return { ok: false, error: { code: String(error?.code ?? error?.message ?? 'NETWORK_ERROR').slice(0, 80) } };
  }
}

async function cliJson(args) {
  const { stdout } = await execute(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((index) => index >= 0));
  return JSON.parse(stdout.slice(start));
}

function fail(stage, result) {
  const code = String(result?.error?.code ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
  process.stdout.write(`reading_progress_smoke=failed:${stage}:${code}\n`);
  process.exit(2);
}
