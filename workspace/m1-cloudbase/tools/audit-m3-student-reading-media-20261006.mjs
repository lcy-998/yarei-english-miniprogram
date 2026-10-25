import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const { stdout } = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const secretStart = stdout.indexOf('{');
if (secretStart < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(stdout.slice(secretStart)).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const api = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'));
const database = api.createCloudBaseDocumentDatabase(app.database());
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
const cohorts = [
  { grade: '3', userId: 'usr_student_g3_01', classId: 'cls_grade3_2' },
  { grade: '4', userId: 'usr_student_g4_01', classId: 'cls_grade4_1' },
];
const output = [];
for (const cohort of cohorts) {
  const actor = { requestId: `m3_reading_media_audit_${cohort.grade}`, sessionId: 'm3-reading-media-audit',
    actorUserId: cohort.userId, actorRole: 'student', organizationId: 'org_qihang_demo',
    platformSubjectDigest: 'm3-reading-media-audit', permissions: ['content.read'],
    scopeIds: [cohort.classId], authzVersion: 1 };
  const catalog = await content.listStudentCatalog(actor, { type: 'reading' }, { limit: 50, offset: 0 });
  const books = [];
  for (const item of catalog.items) {
    const detail = await content.getReadingResource(actor, item.id);
    const chapters = [];
    let segmentCount = 0;
    let audioStates = [];
    for (const chapter of detail.chapters) {
      try {
        const map = await content.getReadingAudioMap(actor, item.id, chapter.id);
        const segments = map.segments.length;
        segmentCount += segments;
        chapters.push({ chapterId: chapter.id, durationMs: map.durationMs,
          playbackAvailable: map.audioAssetKey !== null, mappedSegments: segments });
      } catch (error) {
        audioStates.push(String(error?.code ?? error?.message ?? 'unknown').slice(0, 60));
      }
    }
    let pronunciationSegmentCount = 0;
    try {
      const pronunciation = await content.getReadingPronunciationSegments(actor, item.id);
      pronunciationSegmentCount = pronunciation.segments.length;
    } catch (error) {
      audioStates.push(`pronunciation:${String(error?.code ?? error?.message ?? 'unknown').slice(0, 60)}`);
    }
    books.push({ id: item.id, title: item.title, pageCount: detail.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0),
      category: item.category, grade: item.grade, audioPointreadReady: item.audioPointreadReady ?? false,
      chapters, mappedSegments: segmentCount, pronunciationSegments: pronunciationSegmentCount, errors: audioStates });
  }
  output.push({ classId: cohort.classId, studentCatalogTotal: catalog.total, books });
}
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
