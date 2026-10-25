/** Publish only a reviewed, one-audio five-question teaching resource. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(import.meta.dirname, '..')
const pack = 'G:/英语资产/library/derived/sss-hello-listening-20261017/v2'
const audioPath = join(pack, 'audio/hello-reviewed-v2.mp3')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const require = createRequire(import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const get = async name => readFile(join(pack, name))

function cliData(args) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const at = raw.indexOf('{')
    if (at < 0) throw new Error('MISSING_JSON')
    const result = JSON.parse(raw.slice(at))
    if (result.error) throw new Error('CLOUD_API_ERROR')
    return result.data
  } catch {
    throw new Error(`CLOUD_PREFLIGHT_FAILED_${args.slice(0, 3).join('_')}`)
  }
}

const [sourceBytes, activityBytes, previewBytes, rightsBytes,
  techBytes, reviewBytes, manifestBytes, audioBytes,
  sourceScanBytes, outputScanBytes, negativeScanBytes] = await Promise.all([
  get('source-record-v2.json'), get('activity-v2.json'), get('student-preview-v2.json'),
  get('rights-v2.json'), get('technical-receipt-v2.json'), get('review-v2.json'),
  get('manifest-v2.json'), readFile(audioPath),
  get('scan/source-receipt-v2.json'), get('scan/output-receipt-v2.json'),
  get('scan/negative-receipt-v2.json'),
])
const [source, activity, preview, rights, tech, review, manifest,
  sourceScan, outputScan, negativeScan] = [sourceBytes, activityBytes,
  previewBytes, rightsBytes, techBytes, reviewBytes, manifestBytes,
  sourceScanBytes, outputScanBytes, negativeScanBytes].map(bytes => JSON.parse(bytes))
const sourceId = 'res_listening_sss_hello_20261017_v2'
if (source.resourceId !== sourceId || activity.resourceId !== sourceId
  || rights.resourceId !== sourceId || manifest.resourceId !== sourceId
  || review.resourceId !== sourceId || review.reviewerId !== 'Codex'
  || review.decision !== 'approved_for_content_publication'
  || manifest.processingStatus !== 'publish_ready'
  || review.sourceRecordSha256 !== sha(sourceBytes)
  || review.activitySha256 !== sha(activityBytes)
  || review.studentPreviewSha256 !== sha(previewBytes)
  || review.rightsSha256 !== sha(rightsBytes)
  || review.technicalReceiptSha256 !== sha(techBytes)
  || review.audioSha256 !== sha(audioBytes)
  || manifest.reviewSha256 !== sha(reviewBytes)
  || source.audioSha256 !== sha(audioBytes)
  || rights.originalAudioSha256 !== sha(audioBytes)
  || rights.distributedAudioSha256 !== sha(audioBytes)
  || rights.decision !== 'approved' || rights.scope !== 'all_schools_teaching'
  || source.rightsStatus !== 'user_confirmed_cleared'
  || tech.audioSha256 !== sha(audioBytes) || tech.audioBytes !== audioBytes.length
  || tech.durationMs !== 78089 || tech.codec !== 'mp3'
  || tech.sourceScanSha256 !== sourceScan.reportSha256
  || tech.outputScanSha256 !== outputScan.reportSha256
  || tech.negativeControlSha256 !== negativeScan.reportSha256
  || !sourceScan.report.includes('Infected files: 0')
  || !sourceScan.report.includes('Data scanned: 59.60 MiB')
  || !outputScan.report.includes('Infected files: 0')
  || !outputScan.report.includes('Data scanned: 1.27 MiB')
  || !negativeScan.report.includes('Eicar-Test-Signature FOUND')
  || source.decodedAudioEnvelopeCorrelationVideoVsQuarkMp3 < 0.999
  || source.decodedAudioEnvelopeCorrelationVideoVsMirrorMp3 < 0.999
  || activity.questionCount !== 5 || activity.questions.length !== 5
  || preview.questions.length !== 5 || review.questions.length !== 5
  || JSON.stringify(preview).includes('correctAnswer')
  || JSON.stringify(preview).includes('explanation')) throw new Error('CONTENT_GATE')
for (const [index, q] of activity.questions.entries()) {
  const student = preview.questions[index]
  if (q.id !== student.id || q.stem !== student.stem
    || !same(q.options, student.options) || !q.options.includes(q.correctAnswer)
    || q.mainSegment.startMs < 0 || q.mainSegment.endMs > tech.durationMs
    || q.mainSegment.startMs >= q.mainSegment.endMs
    || !activity.audioTranscript.some(line => line.toLowerCase()
      .includes(q.answerAudioText.toLowerCase()))
    || review.questions[index].id !== q.id
    || review.questions[index].correctAnswer !== q.correctAnswer) {
    throw new Error(`QUESTION_GATE_${index}`)
  }
}

const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envId = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const envs = cliData(['env', 'list', '--json'])
if (!envId || envId !== config.envId || envs.length !== 1
  || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].PackageName !== '个人版' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_COST_GATE')
}
const quotas = {}
for (const metric of ['DbWritepkg', 'DbReadpkg', 'StorageSizepkg']) {
  const result = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json'])
  if (!Number.isFinite(result.Value)) throw new Error(`QUOTA_MISSING_${metric}`)
  quotas[metric] = result.Value
}
if (quotas.DbWritepkg >= 190000 || quotas.DbReadpkg >= 190000
  || quotas.StorageSizepkg + audioBytes.length + rightsBytes.length >= 4_000_000_000) {
  throw new Error('QUOTA_GATE')
}
const acl = execFileSync(process.execPath, [cli, 'storage', 'get-acl', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
})
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE')
const token = cliData(['secrets', 'get', '--json'])
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE')
const sdk = require('@cloudbase/node-sdk')
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token })
const runtime = resolve(root, '.runtime', 'sss-hello-approved')
await mkdir(runtime, { recursive: true })
const bundle = resolve(runtime, `entry-${process.pid}.cjs`)
await build({ entryPoints: [resolve(root, 'src/seed/m3-public-media-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22',
  logLevel: 'silent' })
const api = require(bundle)
const db = api.createCloudBaseDocumentDatabase(app.database())
const orgs = (await db.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort()
if (!same(orgs, ['org_isolation_secondary', 'org_qihang_demo'])) throw new Error('ORG_SCOPE_CHANGED')
const stage = JSON.parse(await readFile('G:/英语资产/reports/sbc0008-listening-v2-nonproduction-stage.json', 'utf8'))
const prefix = stage.fileID.slice(0, stage.fileID.indexOf(stage.cloudPath))
if (!prefix.startsWith('cloud://') || !prefix.includes(envId)) throw new Error('STORAGE_PREFIX_GATE')
const objects = [
  { name: 'audio', path: `english-assets/2026-10-17/sss-hello/audio-${sha(audioBytes).slice(0, 16)}.mp3`, bytes: audioBytes },
  { name: 'rights', path: `english-assets/2026-10-17/sss-hello/rights-${sha(rightsBytes).slice(0, 16)}.json`, bytes: rightsBytes },
].map(row => ({ ...row, fileID: `${prefix}${row.path}` }))
const storagePresence = []
for (const item of objects) {
  let found = null
  try { found = await app.downloadFile({ fileID: item.fileID }) } catch { /* exact target absent */ }
  if (found) {
    const bytes = Buffer.isBuffer(found.fileContent)
      ? found.fileContent : Buffer.from(found.fileContent ?? '')
    if (sha(bytes) !== sha(item.bytes)) throw new Error(`STORAGE_CONFLICT_${item.name}`)
  }
  storagePresence.push(Boolean(found))
}
const projectedId = `public_media_${sha(Buffer.from(JSON.stringify([sourceId, 'org_isolation_secondary']))).slice(0, 40)}`
const targetIds = [sourceId, projectedId]
const auditIds = [`public_media_import_${sourceId}`, `public_media_projection_${projectedId}`]
const existing = await Promise.all(targetIds.map(id => db.get('learning_resources', id)))
const existingAudit = await Promise.all(auditIds.map(id => db.get('operation_logs', id)))
if (mode === 'inspect' && [...existing, ...existingAudit].some(Boolean)) {
  throw new Error('TARGET_NOT_EMPTY')
}
const media = {
  id: sourceId, organizationId: 'org_qihang_demo', title: activity.title,
  kind: 'listening', version: 1, status: 'published', reviewVersion: 1,
  reviewedBy: 'Codex', reviewedAt: review.reviewedAt,
  copyrightStatus: 'verified', copyrightEvidenceKey: objects[1].fileID,
  scanStatus: 'clean', transcodeStatus: 'ready',
  sourceScanEvidence: { engine: 'clamav', signatureVersion: 'ClamAV 1.5.4; daily 28156',
    scannedAt: tech.sourceScannedAt, scannedSha256: sha(audioBytes),
    reportId: sourceScan.archiveSha256 },
  scanEvidence: { engine: 'clamav', signatureVersion: 'ClamAV 1.5.4; daily 28156',
    scannedAt: tech.outputScannedAt, scannedSha256: sha(audioBytes),
    reportId: outputScan.archiveSha256 },
  transcodeEvidence: { engine: 'ci', engineVersion: 'audited MP3 passthrough',
    transcodedAt: tech.passthroughAt, sourceSha256: sha(audioBytes),
    outputSha256: sha(audioBytes), outputAssetKey: objects[0].fileID },
  mediaAssetKey: objects[0].fileID, mediaSha256: sha(audioBytes),
  durationMs: tech.durationMs, allowedClassIds: [],
  questionIds: activity.questions.map(q => q.id),
  questions: activity.questions.map(q => ({ questionId: q.id,
    questionType: q.questionType, stem: q.stem, options: q.options })),
  answerKeys: activity.questions.map(q => ({ questionId: q.id,
    correctAnswer: q.correctAnswer, explanation: q.explanation })),
  clips: activity.questions.map((q, index) => ({ questionId: q.id,
    segmentId: `sss-hello-segment-${index + 1}-v2`,
    startMs: q.mainSegment.startMs, endMs: q.mainSegment.endMs })),
  continuousPlaybackEnforced: true,
}
const input = { resourceId: sourceId, organizationId: 'org_qihang_demo', contentVersion: 1,
  manifestSha256: sha(manifestBytes), reviewId: `review_${sha(reviewBytes).slice(0, 32)}`,
  importedBy: 'codex_sss_hello_20261017', grade: '一年级',
  textbook: 'Super Simple Songs', unit: 'Hello! / 问候与情绪',
  sourceSha256: sha(audioBytes), verifiedAt: review.reviewedAt,
  releaseMode: 'formal_reusable', processedMedia: media }
api.buildVerifiedCentralMediaResource(input)
const planPath = join(pack, 'preflight/approved-publication-plan.json')
if (mode === 'inspect') {
  const plan = { createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(),
    envId, sourceId, projectedId, auditIds, targetIds,
    manifestSha256: sha(manifestBytes), reviewSha256: sha(reviewBytes),
    audioSha256: sha(audioBytes), rightsSha256: sha(rightsBytes),
    quotas, storagePresence, rollback: 'soft-offline exact new source and projection; preserve audit and media bytes' }
  await mkdir(join(pack, 'preflight'), { recursive: true })
  await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' })
  process.stdout.write(JSON.stringify({ mode, ready: true, envId, sourceId,
    questionCount: 5, mediaBytes: audioBytes.length, quotas, storagePresence }) + '\n')
  process.exit(0)
}
const plan = JSON.parse(await readFile(planPath, 'utf8'))
if (plan.envId !== envId || plan.sourceId !== sourceId || plan.projectedId !== projectedId
  || Date.parse(plan.expiresAt) <= Date.now()
  || plan.manifestSha256 !== sha(manifestBytes) || plan.reviewSha256 !== sha(reviewBytes)
  || plan.audioSha256 !== sha(audioBytes) || plan.rightsSha256 !== sha(rightsBytes)) {
  throw new Error('PUBLICATION_PLAN_STALE')
}
if (mode === 'apply') {
  if ([...existing, ...existingAudit].some(Boolean)) throw new Error('TARGET_CHANGED')
  for (const [index, item] of objects.entries()) {
    if (storagePresence[index]) continue
    const uploaded = await app.uploadFile({ cloudPath: item.path, fileContent: item.bytes })
    if (uploaded?.fileID !== item.fileID) throw new Error(`UPLOAD_ID_MISMATCH_${item.name}`)
  }
}
for (const item of objects) {
  const result = await app.downloadFile({ fileID: item.fileID })
  const bytes = Buffer.isBuffer(result.fileContent)
    ? result.fileContent : Buffer.from(result.fileContent ?? '')
  if (sha(bytes) !== sha(item.bytes)) throw new Error(`STORAGE_READBACK_${item.name}`)
}
if (mode === 'apply') {
  const service = new api.PublicMediaDistributionService(db,
    { nowIso: () => new Date().toISOString() })
  await service.importVerified(input)
}
for (const id of targetIds) {
  const row = await db.get('learning_resources', id)
  if (!row || row.status !== 'published' || row.testOnly !== false
    || row.payload?.teacherMedia?.questionIds?.length !== 5
    || row.payload?.teacherMedia?.clips?.length !== 5
    || row.payload?.teacherMedia?.mediaSha256 !== sha(audioBytes)) {
    throw new Error(`CONTENT_READBACK_${id}`)
  }
}
for (const id of auditIds) if (!await db.get('operation_logs', id)) {
  throw new Error(`AUDIT_READBACK_${id}`)
}
const projection = await db.get('learning_resources', projectedId)
if (projection.payload?.assetLibrary?.sourcePublicId !== sourceId) {
  throw new Error('PROJECTION_SOURCE_LINK')
}
const contentBundle = resolve(runtime, `content-${process.pid}.cjs`)
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentBundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22',
  logLevel: 'silent' })
const contentApi = require(contentBundle)
const catalog = new contentApi.TeacherAssetCatalogService(db,
  contentApi.createOrgContentDocumentRepository(db), undefined,
  { nowIso: () => new Date().toISOString() })
const catalogReadback = {}
for (const organizationId of orgs) {
  const actor = { requestId: 'sss_hello_catalog_audit', sessionId: 'sss_hello_catalog_audit',
    actorUserId: 'sss_hello_catalog_auditor', actorRole: 'teacher', organizationId,
    platformSubjectDigest: 'sss_hello_catalog_auditor', permissions: ['content.read'],
    scopeIds: [], authzVersion: 1 }
  const listed = await catalog.list(actor, { kind: 'listening', keyword: 'SSS儿歌' },
    { limit: 50, offset: 0 })
  const expectedId = organizationId === 'org_qihang_demo' ? sourceId : projectedId
  const item = listed.items.find(row => row.id === expectedId)
  if (!item || item.questionCount !== 5 || item.durationMs !== tech.durationMs) {
    throw new Error(`TEACHER_CATALOG_READBACK_${organizationId}`)
  }
  catalogReadback[organizationId] = item.questionCount
}
const signed = await app.getTempFileURL({ fileList: [{ fileID: objects[0].fileID, maxAge: 60 }] })
const temporaryUrl = signed.fileList?.find(item => item.fileID === objects[0].fileID)?.tempFileURL
if (typeof temporaryUrl !== 'string' || !temporaryUrl.startsWith('https://')) {
  throw new Error('SIGNED_PLAYBACK_URL_MISSING')
}
const playback = await fetch(temporaryUrl)
if (!playback.ok || sha(Buffer.from(await playback.arrayBuffer())) !== sha(audioBytes)) {
  throw new Error('SIGNED_PLAYBACK_HASH_MISMATCH')
}
process.stdout.write(JSON.stringify({ mode, status: 'published_and_verified',
  envId, sourceId, projectedId, questionCount: 5,
  storageReadback: 2, contentReadback: 2, auditReadback: 2,
  catalogReadback, signedPlaybackReadback: true,
  mediaSha256: sha(audioBytes) }) + '\n')
