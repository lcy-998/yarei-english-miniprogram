import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(root, '..', '..');
const assets = 'F:/英语资产';
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');

const ORG = 'org_qihang_demo';
const CLASSES = ['cls_grade3_2', 'cls_grade4_1'];
const RESOURCE = 'res_m3_original_feelings_draft_20261003';
const AUDIT = 'audit_m3_feelings_audio_map_pending_20261006';
const PACK = 'm3-feelings-real-audio-pointread-2026-10-06';
const PREFIX = 'm3-acceptance-reading/2026-10-03/original-feelings/';
const LOCAL_CANDIDATE = resolve(assets, 'library/books/book-sbc-en-0030/v1/review/content-candidate-original-v2.json');
const LOCAL_MANIFEST = resolve(assets, 'library/books/book-sbc-en-0030/v1/manifest.json');
const CLI = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const FFMPEG = 'D:/app-cache/m3-media-tools/ffmpeg-release-essentials/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe';
const sorted = values => [...values].sort();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function cliJson(args) {
  const raw = execFileSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error('CLOUD_PREFLIGHT_FAILED');
  return result.data;
}

async function fileDurationMs(path) {
  const { stdout } = await execFileAsync(FFMPEG, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path], { windowsHide: true, encoding: 'utf8' });
  const value = Number(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('SOURCE_AUDIO_DURATION_INVALID');
  return Math.round(value * 1000);
}

const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const acl = execFileSync(process.execPath, [CLI, 'storage', 'get-acl', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
});
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');

const candidate = JSON.parse(await readFile(LOCAL_CANDIDATE, 'utf8'));
const manifest = JSON.parse(await readFile(LOCAL_MANIFEST, 'utf8'));
if (candidate.schemaVersion !== 1 || candidate.decision !== 'pending'
  || candidate.sourceSha256 !== manifest.sourceSha256
  || candidate.resourceId !== 'book-sbc-en-0030'
  || candidate.reading.category !== 'original' || candidate.reading.pages.length !== 7) {
  throw new Error('SOURCE_CANDIDATE_MISMATCH');
}
const sourceRoot = resolve(assets);
const audios = [];
for (const page of candidate.reading.pages) {
  if (!page.audioSourceRelativePath || !page.sentenceMappings?.length) continue;
  const sourcePath = resolve(sourceRoot, page.audioSourceRelativePath);
  const bytes = await readFile(sourcePath);
  const durationMs = await fileDurationMs(sourcePath);
  if (page.sentenceMappings.length !== 1) throw new Error('PAGE_MAPPING_NOT_SINGLE');
  const sentence = page.sentenceMappings[0];
  if (sentence.endMs > durationMs || !sentence.hitAreas?.length
    || sentence.hitAreas.some(rect => ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
      || rect.x + rect.width > 1 || rect.y + rect.height > 1)) throw new Error('SOURCE_POINTREAD_MAP_INVALID');
  audios.push({ pageNumber: page.pageNumber, localPath: sourcePath, key: `${PREFIX}page_audio/page_audio_${String(page.pageNumber).padStart(2, '0')}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.mp3`,
    hash: sha256(bytes), size: bytes.length, durationMs, sentence, bytes });
}
if (audios.length !== 5 || audios.some(item => item.durationMs < 1000)) throw new Error('SOURCE_POINTREAD_AUDIO_COUNT');
const bucketPrefix = 'cloud://cloud1-d8ggzrwwedb786e41.636c-cloud1-d8ggzrwwedb786e41-1486593797';
const cloudAudioIds = audios.map(item => `${bucketPrefix}/${item.key}`);
const storageList = cliJson(['storage', 'list', PREFIX, '--json']);
if (!Array.isArray(storageList) || storageList.length !== 22
  || audios.some(item => !storageList.some(row => row.key === item.key && Number(row.size) === item.size))) {
  throw new Error('CLOUD_AUDIO_ASSETS_MISSING');
}

const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token });
const database = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'))
  .createCloudBaseDocumentDatabase(app.database());
const contentEntry = resolve(root, '.runtime/m3-feelings-audio-map/entry.cjs');
await mkdir(dirname(contentEntry), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')], outfile: contentEntry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(contentEntry);
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
const [resource, audit, membershipRows] = await Promise.all([
  database.get('learning_resources', RESOURCE), database.get('operation_logs', AUDIT),
  Promise.all(CLASSES.map(classId => database.find('class_memberships', {
    organizationId: ORG, classId, status: 'active', deletedAt: null,
  }))),
]);
if (membershipRows[0].length !== 36 || membershipRows[1].length !== 32) throw new Error('STUDENT_SCOPE_CHANGED');
if (resource?.organizationId !== ORG || resource.status !== 'published' || resource.type !== 'reading'
  || resource.testOnly !== true || resource.acceptanceStatus !== 'pending_user_acceptance'
  || resource.copyrightStatus !== 'verified' || resource.category !== 'original'
  || resource.payload?.sourceSha256 !== manifest.sourceSha256 || resource.payload?.chapters?.length !== 1) {
  throw new Error('RESOURCE_SOURCE_GATE');
}
const oldMap = resource.payload.readingAudio;
if (mode !== 'verify' && (resource.version !== 2 || oldMap !== undefined || audit)) throw new Error('INITIAL_RESOURCE_STATE_CHANGED');
if (mode === 'verify' && (resource.version !== 3 || oldMap?.reviewStatus !== 'pending_user_acceptance'
  || oldMap?.chapters?.[0]?.segments?.length !== 5 || audit?.targetId !== RESOURCE)) {
  throw new Error('UPDATED_RESOURCE_STATE_MISMATCH');
}

const pageAssets = new Map(resource.payload.chapters[0].pages.map(page => [page.pageNumber, page]));
const chapterId = resource.payload.chapters[0].id;
const pageSegments = audios.map((audio, index) => {
  const page = pageAssets.get(audio.pageNumber);
  if (!page) throw new Error('RESOURCE_PAGE_MISSING');
  const mapping = audio.sentence;
  const rect = mapping.hitAreas[0];
  return { id: `feelings_pointread_p${String(audio.pageNumber).padStart(2, '0')}`,
    pageId: page.id, pageNumber: audio.pageNumber, text: mapping.text,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    startMs: 0, endMs: audio.durationMs, clipAudioAssetKey: cloudAudioIds[index],
    clipDurationMs: audio.durationMs };
});
const fullAudioDuration = await fileDurationMs(resolve(sourceRoot, candidate.reading.chapters[0].audioSourceRelativePath));
const fullAudioId = resource.payload.chapterAudioFileId;
const expectedMap = { reviewStatus: 'pending_user_acceptance', sourceVersion: String(resource.contentVersion),
  chapters: [{ chapterId, audioAssetKey: fullAudioId, durationMs: fullAudioDuration, segments: pageSegments }] };

if (mode === 'inspect' || mode === 'apply') {
  const signed = await app.getTempFileURL({ fileList: cloudAudioIds.map(fileID => ({ fileID, maxAge: 60 })) });
  const urlMap = new Map(signed.fileList?.map(item => [item.fileID, item.tempFileURL]));
  for (let index = 0; index < audios.length; index += 1) {
    const url = urlMap.get(cloudAudioIds[index]);
    if (!url?.startsWith('https://')) throw new Error('CLOUD_AUDIO_SIGN_FAILED');
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== audios[index].hash) {
      throw new Error('CLOUD_AUDIO_HASH_MISMATCH');
    }
  }
}

if (mode === 'inspect') {
  for (let index = 0; index < CLASSES.length; index += 1) {
    const actor = { requestId: `feelings_inspect_${CLASSES[index]}`, sessionId: 'server-m3-feelings-audio',
      actorUserId: membershipRows[index][0].studentId, actorRole: 'student', organizationId: ORG,
      platformSubjectDigest: 'server-m3-feelings-audio', permissions: ['content.read'],
      scopeIds: [CLASSES[index]], authzVersion: 1 };
    const catalog = await content.listStudentCatalog(actor, { type: 'reading' }, { limit: 50, offset: 0 });
    if (!catalog.items.some(item => item.id === RESOURCE)) throw new Error('FEELINGS_NOT_STUDENT_VISIBLE');
  }
  process.stdout.write(JSON.stringify({ status: 'ready', resourceVersion: resource.version,
    mappedPages: audios.map(item => item.pageNumber), sourceAudioHashes: audios.length,
    cloudAudioHashes: audios.length, students: 68, acceptanceOnly: true, noMediaUpload: true }) + '\n');
} else if (mode === 'apply') {
  const now = new Date().toISOString();
  const next = { ...resource, payload: { ...resource.payload, readingAudio: expectedMap },
    version: resource.version + 1, updatedAt: now };
  const log = { _id: AUDIT, id: AUDIT, organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, requestId: PACK, actorUserId: null, actorRole: null,
    action: 'content.realFeelingsPendingAudioPointreadEnabled', targetType: 'learning_resources',
    targetId: RESOURCE, result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId: PACK, sourceResourceId: candidate.sourceResourceId,
      sourceSha256: candidate.sourceSha256, previousVersion: resource.version, nextVersion: next.version,
      contentVersion: String(resource.contentVersion), mappedPageNumbers: audios.map(item => item.pageNumber),
      mappedAudioSha256: audios.map(item => item.hash), reviewStatus: 'pending_user_acceptance',
      testOnly: true, classIds: CLASSES, newFiles: 0, functionsChanged: 0 } };
  await database.runTransaction(async tx => {
    if ((await tx.get('learning_resources', RESOURCE))?.version !== resource.version
      || await tx.get('operation_logs', AUDIT)) throw new Error('RESOURCE_VERSION_CHANGED');
    if (!await tx.replace('learning_resources', RESOURCE, resource.version, next)
      || !await tx.create('operation_logs', log)) throw new Error('CLOUD_TRANSACTION_FAILED');
  });
  process.stdout.write(JSON.stringify({ status: 'updated', fromVersion: resource.version,
    toVersion: next.version, mappedPages: audios.length, privateFilesUploaded: 0 }) + '\n');
} else {
  for (let index = 0; index < CLASSES.length; index += 1) {
    const actor = { requestId: `feelings_verify_${CLASSES[index]}`, sessionId: 'server-m3-feelings-audio',
      actorUserId: membershipRows[index][0].studentId, actorRole: 'student', organizationId: ORG,
      platformSubjectDigest: 'server-m3-feelings-audio', permissions: ['content.read'],
      scopeIds: [CLASSES[index]], authzVersion: 1 };
    const catalog = await content.listStudentCatalog(actor, { type: 'reading' }, { limit: 50, offset: 0 });
    const item = catalog.items.find(row => row.id === RESOURCE);
    if (item?.audioPointreadPending !== true || item.audioPointreadReady === true) throw new Error('PENDING_CAPABILITY_CARD_FAILED');
    const map = await content.getReadingAudioMap(actor, RESOURCE, chapterId);
    if (map.segments.length !== 5 || map.segments.some(segment => !segment.clipAudioAssetKey)) {
      throw new Error('POINTREAD_MAP_FAILED');
    }
  }
  process.stdout.write(JSON.stringify({ status: 'verified', resourceVersion: resource.version,
    audioPointreadPendingClasses: 2, mappedSourceSentences: 5, clipHashes: audios.length,
    userApprovalRecorded: false }) + '\n');
}
