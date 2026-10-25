import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(join(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || envId !== config.envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const studentPassword = process.env.TEXTBOOK_TEST_STUDENT_PASSWORD;
const teacherPassword = process.env.TEXTBOOK_TEST_TEACHER_PASSWORD;
if (!studentPassword || !teacherPassword) throw new Error('TEST_PASSWORDS_MISSING');
try { require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default); } catch { /* SDK self-registers */ }
const sdk = require('@cloudbase/js-sdk');

async function call(app, name, action, payload, token) {
  const response = await app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload,
    ...(token ? { businessSessionToken: token } : {}) }, parse: true });
  const result = response?.result;
  if (!result || typeof result.ok !== 'boolean') throw new Error(`${name}_${action}_INVALID_RESPONSE`);
  if (!result.ok) throw new Error(`${name}_${action}_${String(result.error?.code ?? 'FAILED')}`);
  return result.data;
}
async function signIn(alias, password, role) {
  const app = sdk.init({ env: envId });
  try { await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password }); }
  catch { throw new Error(`${role.toUpperCase()}_AUTH_FAILED`); }
  const bootstrap = await call(app, 'auth-session', 'bootstrap', {}, null);
  const token = bootstrap?.sessionId;
  if (typeof token !== 'string') throw new Error(`${role.toUpperCase()}_SESSION_MISSING`);
  await call(app, 'auth-session', 'selectRole', { role }, token);
  return { app, token };
}

const student = await signIn('demo_student_01', studentPassword, 'student');
const catalog = await call(student.app, 'content-query', 'listStudentCatalog',
  { filters: { type: 'reading', category: 'synchronized' }, page: { limit: 20, offset: 0 } }, student.token);
const three = 'res_m2_real_pep3a_unit1_20260930';
const four = 'res_m2_real_pep4a_unit1_20260930';
if (!Array.isArray(catalog?.items) || !catalog.items.some(item => item.id === three)
  || catalog.items.some(item => item.id === four)) throw new Error('STUDENT_CATALOG_INVALID');
const detail = await call(student.app, 'content-query', 'getReadingResource', { resourceId: three }, student.token);
const pages = detail?.chapters?.flatMap(chapter => chapter.pages) ?? [];
if (pages.length !== 13 || pages.some(page => !page.imageAssetKey.startsWith('https://')
  || !page.thumbnailAssetKey.startsWith('https://'))) throw new Error('STUDENT_SIGNED_PAGES_INVALID');
await call(student.app, 'learning-progress-query', 'getReadingProgress', { resourceId: three }, student.token);
process.stdout.write('STUDENT_CLOUD_FUNCTIONS=passed;catalog=visible;pages=13;signed=26;progress=ready\n');

const teacher = await signIn('demo_teacher_01', teacherPassword, 'teacher');
const teacherCatalog = await call(teacher.app, 'teacher-textbook-query', 'listTextbooks',
  { filters: {}, page: { limit: 20, offset: 0 } }, teacher.token);
if (!Array.isArray(teacherCatalog?.items) || ![three, four].every(id => teacherCatalog.items.some(item => item.id === id))) {
  throw new Error('TEACHER_CATALOG_INVALID');
}
for (const [id, classId, pageCount] of [[three, 'cls_grade3_2', 13], [four, 'cls_grade4_1', 17]]) {
  const textbook = await call(teacher.app, 'teacher-textbook-query', 'getTextbook',
    { textbookId: id, targetClassId: classId }, teacher.token);
  const reading = await call(teacher.app, 'content-query', 'getReadingResource', { resourceId: id }, teacher.token);
  const signedPages = reading?.chapters?.flatMap(chapter => chapter.pages) ?? [];
  if (textbook?.chapters?.length !== 1 || signedPages.length !== pageCount
    || signedPages.some(page => !page.imageAssetKey.startsWith('https://')
      || !page.thumbnailAssetKey.startsWith('https://'))) throw new Error('TEACHER_PREVIEW_INVALID');
}
process.stdout.write('TEACHER_CLOUD_FUNCTIONS=passed;catalog=2;previews=2;signedPages=30\n');
process.exit(0);
