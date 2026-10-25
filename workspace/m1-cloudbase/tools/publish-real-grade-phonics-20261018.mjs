// Publish four grade-specific phonics self-study courses from already approved word packs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const packRoot = join(assets, 'library/derived/phonics-grade-courses-2026-10-18/v1');
const candidatePath = join(packRoot, 'courses-candidate-v1.json');
const sourcePath = join(packRoot, 'source/uk-national-curriculum-english.html');
const technicalPath = join(packRoot, 'review/technical-inspect-v1.json');
const approvalPath = join(packRoot, 'review/codex-approved-content-v1.json');
const backupPath = join(packRoot, 'review/old-demo-course-backup-v1.json');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const require = createRequire(join(root, 'package.json'));
const organizations = ['org_qihang_demo', 'org_isolation_secondary'];
const suffix = organization => organization === 'org_qihang_demo' ? 'qihang' : 'isolation';
const courseId = (course, organization) => `${course.id}_${suffix(organization)}`;
const auditId = organization => `audit_real_grade_phonics_20261018_${suffix(organization)}`;
const demoIds = ['phonics_m2_short_a_demo', 'phonics_m2_accept_short_a_20260929'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const one = result => Array.isArray(result?.data) ? result.data[0] ?? null : result?.data ?? null;

function cliData(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
      encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error(`CLOUD_COMMAND_FAILED_${args.slice(0, 3).join('_')}`); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const value = JSON.parse(raw.slice(at));
  if (value.error) throw new Error('CLOUD_API_ERROR');
  return value.data;
}

const candidateBytes = await readFile(candidatePath);
const candidateSha256 = sha(candidateBytes);
const candidate = JSON.parse(candidateBytes);
const htmlBytes = await readFile(sourcePath);
if (candidate.status !== 'content_candidate_requires_source_and_audio_reuse_review'
  || candidate.framework?.sha256 !== sha(htmlBytes)
  || !htmlBytes.includes(Buffer.from('Open Government Licence'))
  || candidate.courses?.length !== 4
  || JSON.stringify(candidate.courses.map(course => course.grade))
    !== JSON.stringify(['三年级', '四年级', '五年级', '六年级'])
  || new Set(candidate.courses.map(course => course.id)).size !== 4) {
  throw new Error('LOCAL_CONTENT_SOURCE_GATE');
}
for (const course of candidate.courses) {
  if (course.phonemes?.length !== 4 || course.questions?.length !== 4
    || new Set(course.phonemes.map(item => item.id)).size !== 4
    || new Set(course.questions.map(item => item.id)).size !== 4
    || course.phonemes.some(item => !item.label?.trim() || !item.examples?.length
      || !item.examples.includes(item.exemplarWord))
    || course.questions.some(question => !question.stem?.trim()
      || !question.explanation?.trim() || question.options?.length !== 3
      || new Set(question.options.map(item => item.id)).size !== 3
      || question.options.filter(item => item.id === question.correctOptionId).length !== 1)) {
    throw new Error(`LOCAL_COURSE_STRUCTURE_GATE:${course.id}`);
  }
}

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const configuredEnvId = (await readFile(join(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const environments = cliData(['env', 'list', '--json']);
if (!configuredEnvId || config.envId !== configuredEnvId || environments.length !== 1
  || environments[0].EnvId !== configuredEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no' || environments[0].EnableOverrun !== false
  || environments[0].UsageStatus !== 'normal') throw new Error('NONPRODUCTION_COST_GATE');
const writeQuota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: configuredEnvId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(writeQuota.Value) || writeQuota.Value > 190000) throw new Error('WRITE_QUOTA_GATE');
const token = cliData(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== configuredEnvId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: configuredEnvId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const get = async (collection, id) => one(await db.collection(collection).doc(id).get().catch(() => null));
const allResources = [];
for (let offset = 0; offset < 5000; offset += 100) {
  const page = await db.collection('learning_resources').skip(offset).limit(100).get();
  allResources.push(...page.data);
  if (page.data.length < 100) break;
}
if (allResources.length >= 5000) throw new Error('VOCABULARY_INVENTORY_LIMIT');
const selectedPacks = allResources.filter(row => row.type === 'vocabulary'
  && row.status === 'published' && row._id.startsWith('supplement-')
  && ['三年级', '四年级', '五年级', '六年级'].includes(row.grade)
  && row.payload?.assetLibrary?.reviewStatus === 'approved'
  && /^[a-f0-9]{64}$/i.test(row.payload.assetLibrary.manifestSha256 ?? ''))
  .sort((left, right) => left._id.localeCompare(right._id));
const bindings = [];
for (const course of candidate.courses) {
  const gradePacks = selectedPacks.filter(pack => pack.grade === course.grade);
  const lookup = word => gradePacks.flatMap(pack => (pack.payload?.words ?? [])
    .map(item => ({ pack, item })))
    .find(entry => String(entry.item.word ?? entry.item.spelling ?? '').toLowerCase()
      === String(word).toLowerCase());
  for (const phoneme of course.phonemes) {
    for (const example of phoneme.examples) {
      const found = lookup(example);
      if (!found || course.grade.match(/三|四/u) && found.item.syllables?.length !== 1) {
        throw new Error(`GRADE_WORD_OR_SYLLABLE_MISSING:${course.id}:${example}`);
      }
    }
    const found = lookup(phoneme.exemplarWord);
    if (!found || typeof found.item.audioAssetKey !== 'string'
      || !found.item.audioAssetKey.startsWith('cloud://')
      || found.item.startMs !== 0 || !Number.isSafeInteger(found.item.endMs)
      || found.item.endMs < 200 || found.item.endMs > 10000
      || (found.pack.payload?.words ?? []).filter(item => item.audioAssetKey === found.item.audioAssetKey).length !== 1) {
      throw new Error(`EXEMPLAR_AUDIO_GATE:${course.id}:${phoneme.id}`);
    }
    const downloaded = await app.downloadFile({ fileID: found.item.audioAssetKey });
    const audioBytes = Buffer.from(downloaded.fileContent ?? '');
    if (audioBytes.length < 300 || !(audioBytes.subarray(0, 3).toString('ascii') === 'ID3'
      || audioBytes[0] === 0xff && (audioBytes[1] & 0xe0) === 0xe0)) {
      throw new Error(`EXEMPLAR_AUDIO_READBACK_GATE:${course.id}:${phoneme.id}`);
    }
    bindings.push({ courseId: course.id, grade: course.grade, phonemeId: phoneme.id,
      word: phoneme.exemplarWord, sourcePackId: found.pack._id,
      sourcePackVersion: found.pack.contentVersion,
      sourcePackManifestSha256: found.pack.payload.assetLibrary.manifestSha256,
      audioFileId: found.item.audioAssetKey,
      audioSha256: sha(audioBytes), audioBytes: audioBytes.length,
      clipEndMs: found.item.endMs });
  }
  for (const question of course.questions) {
    if (question.options.some(option => !lookup(option.text))) {
      throw new Error(`QUESTION_WORD_OUTSIDE_GRADE_PACK:${course.id}:${question.id}`);
    }
  }
}
if (bindings.length !== 16 || new Set(bindings.map(item => `${item.courseId}:${item.phonemeId}`)).size !== 16) {
  throw new Error('AUDIO_BINDING_COUNT_GATE');
}

const targets = [];
for (const organization of organizations) {
  const org = await get('organizations', organization);
  if (org?.status !== 'active' || org.deletedAt !== null) throw new Error('ORGANIZATION_GATE');
  for (const course of candidate.courses) {
    const id = courseId(course, organization);
    const existing = await get('phonics_courses', id);
    if (mode === 'verify' ? existing?.status !== 'published' : existing) {
      throw new Error(`TARGET_COURSE_STATE_GATE:${id}`);
    }
    targets.push({ id, organization, course, existing });
  }
  const audit = await get('operation_logs', auditId(organization));
  if (mode === 'verify' ? audit?.result !== 'succeeded' : audit) {
    throw new Error(`TARGET_AUDIT_STATE_GATE:${organization}`);
  }
}
const oldDemos = await Promise.all(demoIds.map(id => get('phonics_courses', id)));
if (oldDemos.some((row, index) => !row || row._id !== demoIds[index]
  || row.organizationId !== 'org_qihang_demo'
  || row.status !== (mode === 'verify' ? 'offline' : 'published'))) {
  throw new Error('OLD_DEMO_STATE_GATE');
}

const technical = { schemaVersion: 1, status: 'content_and_reused_audio_technically_checked',
  candidateSha256, frameworkSha256: sha(htmlBytes), environment: 'verified_nonproduction',
  courseCount: candidate.courses.length, grades: candidate.courses.map(course => course.grade),
  phonemeCount: bindings.length, questionCount: candidate.courses.reduce((sum, course) => sum + course.questions.length, 0),
  wordAudioKind: 'already_published_individual_word_clip_not_isolated_phoneme',
  bindings: bindings.map(({ audioFileId: ignored, ...rest }) => { void ignored; return rest; }),
  sourcePackIds: [...new Set(bindings.map(item => item.sourcePackId))].sort(),
  targetIds: targets.map(item => item.id), oldDemoIds: demoIds,
};
if (mode === 'inspect') {
  await mkdir(dirname(technicalPath), { recursive: true });
  await writeFile(technicalPath, JSON.stringify(technical, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ mode, status: technical.status,
    courseCount: technical.courseCount, grades: technical.grades,
    phonemeCount: technical.phonemeCount, questionCount: technical.questionCount,
    sourcePackCount: technical.sourcePackIds.length, targetCount: targets.length,
    writeQuotaUsed: writeQuota.Value, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
const technicalBytes = await readFile(technicalPath);
if (JSON.stringify(JSON.parse(technicalBytes)) !== JSON.stringify(technical)) {
  throw new Error('TECHNICAL_EVIDENCE_CHANGED');
}
const approvalBytes = await readFile(approvalPath);
const approval = JSON.parse(approvalBytes);
if (approval.decision !== 'approved_for_verified_nonproduction_phonics_release'
  || approval.reviewerId !== 'Codex' || approval.candidateSha256 !== candidateSha256
  || approval.technicalSha256 !== sha(technicalBytes)
  || !Number.isFinite(Date.parse(approval.reviewedAt))) throw new Error('CONTENT_REVIEW_GATE');
if (mode === 'apply') {
  await writeFile(backupPath, JSON.stringify({ schemaVersion: 1,
    createdAt: new Date().toISOString(), records: oldDemos }, null, 2) + '\n', { flag: 'wx' });
  const now = new Date().toISOString();
  await db.runTransaction(async tx => {
    for (const target of targets) {
      const existing = one(await tx.collection('phonics_courses').doc(target.id).get().catch(() => null));
      if (existing) throw new Error(`TARGET_COLLISION:${target.id}`);
      const phonemes = target.course.phonemes.map(phoneme => ({
        id: phoneme.id, label: phoneme.label, examples: phoneme.examples,
        audioFileId: bindings.find(item => item.courseId === target.course.id
          && item.phonemeId === phoneme.id)?.audioFileId ?? null,
      }));
      if (phonemes.some(item => !item.audioFileId)) throw new Error('AUDIO_BINDING_MISSING');
      await tx.collection('phonics_courses').doc(target.id).set({
        id: target.id, organizationId: target.organization, schemaVersion: 1,
        version: 1, deletedAt: null, title: target.course.title,
        grade: target.course.grade, unit: target.course.unit,
        contentVersion: `v1-${candidateSha256.slice(0, 12)}`,
        status: 'published', visibility: { type: 'organization' },
        phonemes, questions: target.course.questions,
        sourceKind: 'adapted_from_approved_grade_vocabulary_packs',
        sourceFrameworkUrl: candidate.framework.url,
        sourceFrameworkSha256: technical.frameworkSha256,
        sourcePackIds: [...new Set(bindings.filter(item => item.courseId === target.course.id)
          .map(item => item.sourcePackId))].sort(),
        contentSha256: candidateSha256, reviewSha256: sha(approvalBytes),
        reviewedBy: 'Codex', reviewedAt: approval.reviewedAt,
        audioKind: technical.wordAudioKind, createdAt: now, updatedAt: now,
      });
    }
    for (const row of oldDemos) {
      const current = one(await tx.collection('phonics_courses').doc(row._id).get());
      if (current?.version !== row.version || current.status !== 'published') {
        throw new Error(`OLD_DEMO_CHANGED:${row._id}`);
      }
      const { _id: ignored, ...fields } = current;
      void ignored;
      await tx.collection('phonics_courses').doc(row._id).set({ ...fields,
        version: current.version + 1, status: 'offline', updatedAt: now,
        offlineReason: '真实分年级拼读课程已替代虚构演示内容',
      });
    }
    for (const organization of organizations) {
      await tx.collection('operation_logs').doc(auditId(organization)).set({
        organizationId: organization, schemaVersion: 1, version: 1, deletedAt: null,
        requestId: auditId(organization), actorUserId: 'codex_phonics_grade_20261018',
        actorRole: 'system', action: 'phonics.real_grade_courses_publish',
        targetType: 'phonics_courses', targetId: courseId(candidate.courses[0], organization),
        result: 'succeeded', occurredAt: now,
        metadata: { contentSha256: candidateSha256, reviewSha256: sha(approvalBytes),
          courseIds: candidate.courses.map(course => courseId(course, organization)),
          reusedAudioClips: 16, oldDemoCoursesOffline: organization === 'org_qihang_demo' ? 2 : 0,
          studentAnswersChanged: false, mediaUploaded: false },
      });
    }
  });
}
const readback = await Promise.all(targets.map(item => get('phonics_courses', item.id)));
const demos = await Promise.all(demoIds.map(id => get('phonics_courses', id)));
const audits = await Promise.all(organizations.map(id => get('operation_logs', auditId(id))));
if (readback.some((row, index) => row?.status !== 'published'
  || row.contentSha256 !== candidateSha256 || row.phonemes?.length !== 4
  || row.questions?.length !== 4 || row.organizationId !== targets[index].organization
  || row.phonemes.some(item => !item.audioFileId?.startsWith('cloud://')))
  || demos.some(row => row?.status !== 'offline')
  || audits.some(row => row?.result !== 'succeeded')) throw new Error('CLOUD_READBACK_FAILED');
process.stdout.write(JSON.stringify({ mode, status: 'verified_nonproduction_published',
  publishedCourseDocuments: readback.length, distinctGrades: candidate.courses.length,
  realPhonemeRows: readback.reduce((sum, row) => sum + row.phonemes.length, 0),
  oldDemoCoursesOffline: demos.length, auditRecords: audits.length,
  mediaUploaded: 0, studentAnswerWrites: 0,
  cloudWrites: mode === 'apply' ? readback.length + demos.length + audits.length : 0 }) + '\n');
