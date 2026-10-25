import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || !/^[A-Za-z0-9_-]+$/u.test(envId)) throw new Error('NONPRODUCTION_ENV_UNAVAILABLE');

try { require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default); } catch {
  // Some SDK versions register the Node adapter automatically.
}
const sdk = require('@cloudbase/js-sdk');
process.stdin.setRawMode?.(true);
process.stdin.resume();
const chunk = await new Promise(resolve => {
  let buffer = '';
  process.stdin.on('data', part => {
    buffer += String(part);
    const end = buffer.search(/[\r\n]/u);
    if (end >= 0) resolve(buffer.slice(0, end));
  });
});
let input;
try { input = JSON.parse(String(chunk)); } catch { throw new Error('INVALID_INPUT'); }
if (!Array.isArray(input?.mobiles) || input.mobiles.length !== 3
  || input.mobiles.some(phone => !/^1\d{10}$/u.test(phone))
  || typeof input.password !== 'string' || input.password.length < 1) throw new Error('INVALID_INPUT');

const expected = {
  reading: 'res_formal_sbc0008_v1_20261007',
  vocabulary: 'res_launch_pep3a_u2_vocabulary_v1_20261012',
  listening: 'res_launch_sbc0008_listening_v2_20261013',
  video: 'res_launch_sbc0008_video_credited_v1_20261012',
  cipVideo: 'res_cip50055_pangu_video_2q_voiced_v6_20261013',
  cipOldVideo: 'res_cip50055_pangu_silent_video_v1_20261013',
  cipSilentPanguV5: 'res_cip50055_pangu_video_2q_v5_20261013',
  cipRespectVideo: 'res_cip50055_respect_elders_video_2q_voiced_v2_20261013',
  cipSilentRespectV1: 'res_cip50055_respect_elders_video_2q_v1_20261013',
  dubbing: 'res_launch_sbc0008_dubbing_credited_v1_20261012',
  exercise: 'res_prod_sbc0008_exercise_01_v3',
};

for (const [index, mobile] of input.mobiles.entries()) {
  const label = `account_${index + 1}`;
  const app = sdk.init({ env: envId });
  const auth = app.auth({ persistence: 'none' });
  const result = { account: label, signIn: 'failed', roles: [], checks: {} };
  try {
    const signedIn = await Promise.race([
      auth.signInWithPassword({ phone: `+86${mobile}`, password: input.password }),
      new Promise((_, reject) => setTimeout(() => reject({ code: 'AUTH_TIMEOUT' }), 20_000)),
    ]);
    if (signedIn?.error) throw Object.assign(new Error('AUTH_FAILED'), { code: 'AUTH_FAILED' });
    result.signIn = 'passed';
    const bootstrap = await call(app, 'auth-session', 'bootstrap', {}, null);
    if (!bootstrap.ok || typeof bootstrap.data?.sessionId !== 'string') {
      result.bootstrap = `failed:${code(bootstrap.error)}`;
    } else {
      result.bootstrap = 'passed';
      result.roles = (Array.isArray(bootstrap.data.roles) ? bootstrap.data.roles : [])
        .map(role => typeof role === 'string' ? role : role?.role)
        .filter(role => ['student', 'parent', 'teacher', 'admin'].includes(role));
      for (const role of result.roles.filter(role => role !== 'admin')) {
        const selected = await call(app, 'auth-session', 'selectRole', { role }, bootstrap.data.sessionId);
        if (!selected.ok) { result.checks[role] = `select_failed:${code(selected.error)}`; continue; }
        const token = selected.data?.sessionId ?? bootstrap.data.sessionId;
        const queries = role === 'teacher'
          ? [
              ['reading', 'listTaskCatalogResources', { filters: { type: 'reading' }, page: { limit: 50, offset: 0 } }],
              ['vocabulary', 'listTaskCatalogResources', { filters: { type: 'vocabulary' }, page: { limit: 50, offset: 0 } }],
              ['exercise', 'listSchoolQuestions', { filters: {}, page: { limit: 50, offset: 0 } }],
              ...['listening', 'video', 'dubbing'].map(kind => [kind, 'listTeacherAssets', { filters: { kind }, page: { limit: 50, offset: 0 } }]),
            ]
          : [
              ['reading', 'listStudentCatalog', { filters: { type: 'reading' }, page: { limit: 50, offset: 0 } }],
              ['vocabulary', 'listStudentCatalog', { filters: { type: 'vocabulary' }, page: { limit: 50, offset: 0 } }],
            ];
        const checks = {};
        for (const [kind, action, payload] of queries) {
          const response = await call(app, 'content-query', action, payload, token);
          checks[kind] = response.ok
            ? { visible: response.data?.items?.some(item => item.id === expected[kind]) === true,
                count: response.data?.items?.length ?? null,
                ...(kind === 'video' ? {
                  newCipVisible: response.data?.items?.some(item => item.id === expected.cipVideo) === true,
                  oldCipVisible: response.data?.items?.some(item => item.id === expected.cipOldVideo) === true,
                  silentPanguV5Visible: response.data?.items?.some(item => item.id === expected.cipSilentPanguV5) === true,
                  respectVideoVisible: response.data?.items?.some(item => item.id === expected.cipRespectVideo) === true,
                  silentRespectV1Visible: response.data?.items?.some(item => item.id === expected.cipSilentRespectV1) === true,
                } : {}) }
            : `failed:${code(response.error)}`;
        }
        if (role === 'teacher') {
          const preview = await call(app, 'content-query', 'previewTeacherAsset',
            { resourceId: expected.cipVideo }, token);
          checks.cipVideoPreview = preview.ok
            ? { signedPlayback: preview.data?.playback?.temporaryUrl?.startsWith('https://') === true,
                automaticScoring: preview.data?.scoringKind === 'automatic',
                durationMs: preview.data?.durationMs ?? null,
                questionCount: preview.data?.questions?.length ?? null,
                grade: preview.data?.grade ?? null,
                book: preview.data?.textbook ?? null,
                section: preview.data?.unit ?? null }
            : `failed:${code(preview.error)}`;
          const respectPreview = await call(app, 'content-query', 'previewTeacherAsset',
            { resourceId: expected.cipRespectVideo }, token);
          checks.cipRespectPreview = respectPreview.ok
            ? { signedPlayback: respectPreview.data?.playback?.temporaryUrl?.startsWith('https://') === true,
                automaticScoring: respectPreview.data?.scoringKind === 'automatic',
                durationMs: respectPreview.data?.durationMs ?? null,
                questionCount: respectPreview.data?.questions?.length ?? null,
                grade: respectPreview.data?.grade ?? null,
                book: respectPreview.data?.textbook ?? null,
                section: respectPreview.data?.unit ?? null }
            : `failed:${code(respectPreview.error)}`;
        }
        result.checks[role] = checks;
      }
    }
  } catch (error) {
    result.errorCode = code(error);
  } finally {
    try { await Promise.race([auth.signOut(), new Promise(resolve => setTimeout(resolve, 3_000))]); }
    catch { /* Process exits without persisted session. */ }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
process.exit(0);

async function call(app, name, action, payload, token) {
  try {
    const response = await Promise.race([
      app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload,
        ...(token === null ? {} : { businessSessionToken: token }) }, parse: true }),
      new Promise((_, reject) => setTimeout(() => reject({ code: 'CALL_TIMEOUT' }), 20_000)),
    ]);
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) { return { ok: false, error: { code: code(error) } }; }
}

function code(error) {
  const value = typeof error?.code === 'string' ? error.code : 'FAILED';
  return /^[A-Za-z0-9_-]{1,60}$/u.test(value) ? value : 'FAILED';
}
