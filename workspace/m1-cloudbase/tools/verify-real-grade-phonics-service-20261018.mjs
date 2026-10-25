// Read-only service and protected-audio verification with a fictional student actor.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function call(args) {
  let raw;
  try { raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('CLOUD_READ_FAILED'); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const envs = call(['env', 'list', '--json']);
if (envs.length !== 1 || envs[0].Status !== 'NORMAL'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_ENV_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envs[0].EnvId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envs[0].EnvId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const output = join(root, '.runtime/phonics-grade-service-readback/entry.cjs');
await mkdir(dirname(output), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')],
  outfile: output, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(output);
const database = api.createCloudBaseDocumentDatabase(app.database(), { pageSize: 100, maxPages: 20 });
const service = new api.PhonicsService(new api.DocumentPhonicsRepository(database),
  { nowIso: () => new Date().toISOString() },
  { next: prefix => `${prefix}_readonly_probe` },
  { async temporaryUrl(fileId) {
    const signed = await app.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: 60 }] });
    const url = signed?.fileList?.[0]?.tempFileURL;
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('SIGNED_AUDIO_URL_INVALID');
    return url;
  } });
const actor = { requestId: 'phonics_readonly_probe', sessionId: 'virtual_student_readonly',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'fictional_probe', permissions: [],
  scopeIds: ['usr_student_g3_01'], authzVersion: 1 };
const list = await service.listCourses(actor);
if (list.length !== 4 || JSON.stringify(list.map(item => item.grade))
  !== JSON.stringify(['三年级', '四年级', '五年级', '六年级'])
  || list.some(item => item.questionCount !== 4 || item.phonemeCount !== 4)) {
  throw new Error('STUDENT_COURSE_CATALOG_INVALID');
}
let available = 0;
for (const item of list) {
  const course = await service.getCourse(actor, item.id);
  const state = await service.getState(actor, item.id);
  if (course.questions.length !== 4 || course.phonemes.length !== 4
    || course.phonemes.some(phoneme => !phoneme.audioAvailable)
    || state.courseId !== item.id || state.questions.length !== 4
    || JSON.stringify(course).includes('correctOptionId')
    || JSON.stringify(course).includes('explanation')) throw new Error('STUDENT_COURSE_DETAIL_INVALID');
  const audio = await service.getAudio(actor, item.id, course.phonemes[0].id);
  if (!audio.temporaryUrl.startsWith('https://')) throw new Error('PROTECTED_AUDIO_INVALID');
  available += 1;
}
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction',
  studentVisibleRealCourses: list.length, grades: list.map(item => item.grade),
  questionsPerCourse: 4, phonemesPerCourse: 4, protectedAudioSigned: available,
  studentAnswerWrites: 0, cloudWrites: 0 }) + '\n');
