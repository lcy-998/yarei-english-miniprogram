import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const resourceId = process.argv[2];
if (!/^book-[a-f0-9]{12}$/.test(resourceId ?? '')) throw new Error('RESOURCE_ID_INVALID');
const generated = process.argv.includes('--generated');
const generatedFull = process.argv.includes('--generated-full');
const book04Clip = process.argv.includes('--book04-clip');
if ((generated || generatedFull) && resourceId !== 'book-247db2fc1d03') throw new Error('GENERATED_AUDIO_SCOPE_INVALID');
const pageNumber = process.argv[3] === undefined || process.argv[3] === '--transcript'
  || process.argv[3] === '--generated' || process.argv[3] === '--generated-full'
  ? null : Number(process.argv[3]);
if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 40)) {
  throw new Error('PAGE_ARGUMENT_INVALID');
}
if (book04Clip && (resourceId !== 'book-5b3e356188a8' || pageNumber === null
  || pageNumber < 3 || pageNumber > 8 || generated || generatedFull)) {
  throw new Error('BOOK04_CLIP_SCOPE_INVALID');
}
const envId = 'cloud1-d8ggzrwwedb786e41';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const output = join(assets, 'library/derived/raz-alignment-2026-10-15', resourceId,
  generatedFull ? 'vosk-generated-full-candidate-v1.json'
    : generated ? 'vosk-generated-page-0003-candidate-v1.json'
    : book04Clip ? `vosk-book04-page-${String(pageNumber).padStart(4, '0')}-candidate-v1.json`
    : pageNumber === null ? 'vosk-words-candidate-v1.json'
    : `vosk-page-${String(pageNumber).padStart(4, '0')}-candidate-v1.json`);
const require = createRequire(join(backend, 'package.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLI_JSON_MISSING');
  const payload = JSON.parse(raw.slice(start));
  if (payload.error) throw new Error('CLI_API_REJECTED');
  return payload.data;
}
function hmac(key, value) { return createHmac('sha256', key).update(value).digest(); }
async function invokeScf(credentials, event) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = `${date}/scf/tc3_request`;
  const contentType = 'application/json; charset=utf-8';
  const host = 'scf.tencentcloudapi.com';
  const body = JSON.stringify({ FunctionName: 'pronunciation-inference', Namespace: envId,
    InvocationType: 'RequestResponse', ClientContext: JSON.stringify(event) });
  const canonical = `POST\n/\n\ncontent-type:${contentType}\nhost:${host}\nx-tc-action:invoke\n\n`
    + `content-type;host;x-tc-action\n${sha(body)}`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`;
  const signingKey = hmac(hmac(hmac(`TC3${credentials.secretKey}`, date), 'scf'), 'tc3_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, `
    + `SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;
  const response = await fetch(`https://${host}/`, { method: 'POST', body, redirect: 'error',
    signal: AbortSignal.timeout(230000), headers: {
      'content-type': contentType, 'x-tc-action': 'Invoke', 'x-tc-version': '2018-04-16',
      'x-tc-timestamp': String(timestamp), 'x-tc-region': 'ap-shanghai', authorization,
      'x-tc-token': credentials.token,
    } });
  if (!response.ok) throw new Error(`SCF_HTTP_${response.status}`);
  const payload = await response.json();
  if (payload.Response?.Error) throw new Error(`SCF_API_${payload.Response.Error.Code}`);
  const result = payload.Response?.Result;
  if (result?.InvokeResult !== 0 || result?.ErrMsg !== '' || typeof result?.RetMsg !== 'string') {
    throw new Error('SCF_INVOKE_FAILED');
  }
  return JSON.parse(result.RetMsg);
}

const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('CONFIG_ENV_MISMATCH');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_NOT_PRIVATE');
const functionInfo = cliData(['fn', 'detail', 'pronunciation-inference', '--json']);
const variables = Object.fromEntries((functionInfo?.Environment?.Variables ?? [])
  .map(entry => [entry.Key, entry.Value]));
if (functionInfo?.Status !== 'Active' || functionInfo?.Runtime !== 'Python3.11'
  || Number(functionInfo?.Timeout) < 90 || (functionInfo?.Triggers ?? []).length !== 0
  || typeof variables.VOICE_INTERNAL_SECRET !== 'string'
  || variables.VOICE_INTERNAL_SECRET.length < 32
  || typeof variables.VOICE_ALLOWED_MEDIA_HOST !== 'string') {
  throw new Error('INTERNAL_MODEL_NOT_READY');
}
const catalog = JSON.parse(await readFile(join(assets, 'library/catalog.json'), 'utf8'));
const book = catalog.resources.find(item => item.resourceId === resourceId);
if (!book || !book.sourceRelativePath.startsWith('ZP0001-RAZ Phonics/')) throw new Error('BOOK_SCOPE_INVALID');
const pairs = JSON.parse(await readFile(join(assets,
  'reports/raz-source-audio-inventory-2026-10-15.json'), 'utf8'));
const pair = pairs.find(item => item.resourceId === resourceId);
if (!pair || (!(generated || generatedFull) && pair.audioStatus !== 'filename_pair_only')) throw new Error('BOOK_AUDIO_PAIR_MISSING');
const candidateAudio = catalog.resources.find(item => item.resourceType === 'audio'
  && item.sourceRelativePath === (pageNumber === null ? pair.audioRelativePath
    : `library/derived/raz-page-audio-2026-10-15/${resourceId}/v1/pages/page-${String(pageNumber).padStart(4, '0')}-narration-v1.mp3`));
const generatedReceipt = generatedFull ? JSON.parse(await readFile(join(assets,
  'library/derived/raz-read-aloud-audio-2026-10-15/book-247db2fc1d03/v1/generated-audio-technical-candidate-v1.json'), 'utf8')) : null;
const generatedFullRow = generatedReceipt?.outputs?.find(row => row.relativePath.endsWith('/chapter/full-story-v1.mp3'));
const book04Mapping = book04Clip ? JSON.parse(await readFile(join(assets,
  'library/derived/raz-decodable-book04-2026-10-16/v1/mapping-candidate-v1.json'), 'utf8')) : null;
const book04Page = book04Mapping?.pages?.find(row => row.pageNumber === pageNumber);
if (book04Clip && (book04Mapping?.status !== 'candidate_not_listened_or_approved'
  || book04Mapping?.resourceId !== resourceId || book04Mapping?.sourcePdfSha256 !== book.sourceSha256
  || book04Mapping?.sourceAudioSha256?.toUpperCase() !== pair.audioSha256?.toUpperCase()
  || !book04Page)) throw new Error('BOOK04_MAPPING_INVALID');
const book04Path = book04Page ? join(assets, ...book04Page.audioRelativePath.split('/')) : null;
const book04Bytes = book04Path ? await readFile(book04Path) : null;
const ffprobe = 'D:/app-cache/m3-media-tools/ffmpeg-release-essentials/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe';
const book04DurationMs = book04Path ? Math.round(Number(execFileSync(ffprobe,
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', book04Path],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim()) * 1000) : null;
if (book04Clip && (!book04Bytes || sha(book04Bytes).toUpperCase() !== book04Page.audioSha256
  || !Number.isFinite(book04DurationMs) || book04DurationMs < 1000)) {
  throw new Error('BOOK04_CLIP_HASH_OR_DURATION_INVALID');
}
const audio = book04Clip ? {
  sourceRelativePath: book04Page.audioRelativePath,
  sourceSha256: book04Page.audioSha256,
  sourceSizeBytes: book04Bytes.length,
  details: { durationMs: book04DurationMs },
} : generatedFull ? {
  sourceRelativePath: generatedFullRow?.relativePath,
  sourceSha256: generatedFullRow?.sha256,
  sourceSizeBytes: generatedFullRow?.bytes,
  details: { durationMs: generatedFullRow?.durationMs },
} : generated ? {
  sourceRelativePath: 'library/derived/raz-read-aloud-audio-2026-10-15/book-247db2fc1d03/v1/page-0003-zira-candidate-v1.mp3',
  sourceSha256: '421F53EF80C4DDD93EDF9F0C2B004D7BFB8DF1C2870118BDD8DFF484DFE319D2',
  sourceSizeBytes: 96538, details: { durationMs: 14778 },
} : candidateAudio;
if (generated) {
  const scanReport = await readFile(join(assets,
    'library/derived/raz-read-aloud-audio-2026-10-15/book-247db2fc1d03/v1/page-0003-audio-scan-v1.txt'), 'utf8');
  if (!scanReport.includes('Infected files: 0') || !/Data scanned: (?!0(?:\.0+)?\s)[0-9.]+\s(?:KiB|MiB)/.test(scanReport)) {
    throw new Error('GENERATED_AUDIO_SCAN_MISSING');
  }
}
if (generatedFull && (generatedReceipt?.status !== 'synthetic_audio_candidate_not_content_approved_or_published'
  || !generatedReceipt.cleanScan?.report?.includes('Infected files: 0')
  || !generatedReceipt.negativeControl?.report?.includes('Eicar-Test-Signature FOUND'))) {
  throw new Error('GENERATED_FULL_SCAN_MISSING');
}
if (!audio || audio.details?.durationMs < 1000 || audio.details.durationMs > 300000) {
  throw new Error('AUDIO_SOURCE_INVALID');
}
const audioPath = join(assets, ...audio.sourceRelativePath.split('/'));
const bytes = await readFile(audioPath);
const audioSha = sha(bytes);
if (audioSha.toUpperCase() !== audio.sourceSha256.toUpperCase()
  || bytes.length !== audio.sourceSizeBytes) throw new Error('LOCAL_AUDIO_HASH_MISMATCH');
const temp = cliData(['secrets', 'get', '--json']);
if (temp?.isTemporary !== true || temp.envId !== envId
  || Date.parse(temp.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_CREDENTIALS_INVALID');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: temp.secretId,
  secretKey: temp.secretKey, sessionToken: temp.token });
const cloudPath = `yarei-assets/internal/raz-alignment/20261015/${resourceId}-${audioSha.slice(0,12)}.mp3`;
const existing = cliData(['storage', 'list', cloudPath, '--json']);
if (Array.isArray(existing) && existing.length) throw new Error('TEMP_STORAGE_COLLISION');
let fileID;
try {
  const uploaded = await app.uploadFile({ cloudPath, fileContent: bytes });
  fileID = uploaded?.fileID;
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new Error('UPLOAD_INVALID');
  const downloaded = await app.downloadFile({ fileID });
  if (sha(Buffer.from(downloaded.fileContent)) !== audioSha) throw new Error('CLOUD_HASH_MISMATCH');
  const signed = await app.getTempFileURL({ fileList: [{ fileID, maxAge: 60 }] });
  const fileUrl = signed?.fileList?.[0]?.tempFileURL;
  if (typeof fileUrl !== 'string' || new URL(fileUrl).hostname !== variables.VOICE_ALLOWED_MEDIA_HOST) {
    throw new Error('SIGNED_URL_HOST_MISMATCH');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const job = { operationId: `raz-alignment-${resourceId}-${audioSha.slice(0,12)}`,
    recordingId: resourceId, fileUrl, sha256: audioSha, sizeBytes: bytes.length,
    durationMs: audio.details.durationMs };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(job)
    .sort(([left], [right]) => left.localeCompare(right))));
  const signature = createHmac('sha256', variables.VOICE_INTERNAL_SECRET)
    .update(`${timestamp}\n${canonical}`).digest('hex');
  const result = await invokeScf(temp, { job, timestamp, signature });
  if (result?.ok !== true || result.result?.modelVersion !== 'vosk-model-small-en-us-0.15'
    || !Array.isArray(result.result.words)
    || Math.abs(result.result.durationMs - audio.details.durationMs) > 1000) {
    throw new Error(`MODEL_RESULT_${result?.code ?? 'INVALID'}`);
  }
  const words = result.result.words;
  if (words.some(word => typeof word.word !== 'string' || typeof word.start !== 'number'
    || typeof word.end !== 'number' || typeof word.confidence !== 'number'
    || word.start < 0 || word.end <= word.start
    || word.end * 1000 > result.result.durationMs + 1000)) throw new Error('WORD_TIMES_INVALID');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schemaVersion: 1, status: 'alignment_candidate_only',
    resourceId, sourcePdfSha256: book.sourceSha256, sourceAudioSha256: audioSha,
    sourceAudioRelativePath: audio.sourceRelativePath,
    modelVersion: result.result.modelVersion, durationMs: result.result.durationMs,
    elapsedMs: result.elapsedMs, words,
    note: 'Model transcript requires source-text and audio-content review before page mapping or publication.'
  }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ resourceId, durationMs: result.result.durationMs,
    wordCount: words.length, elapsedMs: result.elapsedMs, output,
    ...(process.argv.includes('--transcript')
      ? { transcript: words.map(word => word.word).join(' ') } : {}) }) + '\n');
} finally {
  if (fileID) {
    const deleted = await app.deleteFile({ fileList: [fileID] });
    if (!Array.isArray(deleted?.fileList) || deleted.fileList.length !== 1
      || deleted.fileList[0].code !== 'SUCCESS') throw new Error('TEMP_MEDIA_CLEANUP_UNCONFIRMED');
  }
}
