import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const root = 'G:/英语资产';
const envId = 'cloud1-d8ggzrwwedb786e41';
const bookId = 'book-pep-8a-2025';
const part = Number(process.argv[2]);
if (part < 1 || part > 4) throw new Error('PART_INVALID');
const trackIndex = 20 + part;
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const ffprobe = 'D:/app-cache/m3-media-tools/ffmpeg-release-essentials/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLI_API_ERROR_${args[0]}`);
  return parsed.data;
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
    signal: AbortSignal.timeout(230000), headers: { 'content-type': contentType,
      'x-tc-action': 'Invoke', 'x-tc-version': '2018-04-16',
      'x-tc-timestamp': String(timestamp), 'x-tc-region': 'ap-shanghai',
      authorization, 'x-tc-token': credentials.token } });
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
if (config.envId !== envId) throw new Error('ENVIRONMENT_CHANGED');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'FunctionInvocation' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('INVOCATION_QUOTA_GATE');
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_GATE');
const functionInfo = cliData(['fn', 'detail', 'pronunciation-inference', '--json']);
const variables = Object.fromEntries((functionInfo?.Environment?.Variables ?? [])
  .map(entry => [entry.Key, entry.Value]));
if (functionInfo?.Status !== 'Active' || functionInfo?.Runtime !== 'Python3.11'
  || Number(functionInfo?.Timeout) < 90 || (functionInfo?.Triggers ?? []).length !== 0
  || typeof variables.VOICE_INTERNAL_SECRET !== 'string'
  || variables.VOICE_INTERNAL_SECRET.length < 32
  || typeof variables.VOICE_ALLOWED_MEDIA_HOST !== 'string') throw new Error('MODEL_GATE');
const path = join(root, `library/derived/pep8a-u1-vocabulary-alignment-2026-10-17/v1/part-0${part}.mp3`);
const bytes = await readFile(path);
const track = { file: `part-0${part}.mp3`, sha256: sha(bytes),
  bytes: bytes.length, unit: 'Unit 1', label: `Vocabulary part ${part}`,
  url: 'publisher_original_user_provided_cropped_for_alignment' };
if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error('SOURCE_SIZE_GATE');
const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'json', path], { encoding: 'utf8', windowsHide: true }));
const durationMs = Math.round(Number(probe.format.duration) * 1000);
if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 300000) {
  throw new Error('DURATION_GATE');
}
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) < Date.now() + 60000) throw new Error('CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey, sessionToken: credentials.token });
const cloudPath = `yarei-assets/internal/pep-vocabulary-alignment-20261017/${bookId}/${track.file}`;
const existing = cliData(['storage', 'list', cloudPath, '--json']);
if (Array.isArray(existing) && existing.length) throw new Error('TEMP_COLLISION');
let fileID;
try {
  const uploaded = await app.uploadFile({ cloudPath, fileContent: bytes });
  fileID = uploaded?.fileID;
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new Error('UPLOAD_GATE');
  const signed = await app.getTempFileURL({ fileList: [{ fileID, maxAge: 60 }] });
  const fileUrl = signed?.fileList?.[0]?.tempFileURL;
  if (typeof fileUrl !== 'string' || new URL(fileUrl).hostname !== variables.VOICE_ALLOWED_MEDIA_HOST) {
    throw new Error('SIGNED_URL_GATE');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const job = { operationId: `pep-vocab-align-${bookId}-${trackIndex}-${track.sha256.slice(0, 12)}`,
    recordingId: `${bookId}-${trackIndex}`, fileUrl, sha256: track.sha256,
    sizeBytes: bytes.length, durationMs };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(job)
    .sort(([left], [right]) => left.localeCompare(right))));
  const signature = createHmac('sha256', variables.VOICE_INTERNAL_SECRET)
    .update(`${timestamp}\n${canonical}`).digest('hex');
  const result = await invokeScf(credentials, { job, timestamp, signature });
  if (result?.ok !== true || result.result?.modelVersion !== 'vosk-model-small-en-us-0.15'
    || !Array.isArray(result.result.words)
    || Math.abs(result.result.durationMs - durationMs) > 1000) {
    throw new Error(`MODEL_RESULT_${result?.code ?? 'INVALID'}`);
  }
  const words = result.result.words;
  if (words.some(word => typeof word.word !== 'string' || typeof word.start !== 'number'
    || typeof word.end !== 'number' || typeof word.confidence !== 'number'
    || word.start < 0 || word.end <= word.start || word.end * 1000 > durationMs + 1000)) {
    throw new Error('WORD_TIMES_INVALID');
  }
  const output = join(root, 'library/derived/pep-vocabulary-alignment-2026-10-17/v1', bookId,
    `track-${String(trackIndex).padStart(3, '0')}-vosk.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schemaVersion: 1, status: 'alignment_candidate_only',
    bookId, trackIndex, unit: track.unit, label: track.label,
    sourceAudioSha256: track.sha256, sourceUrl: track.url,
    modelVersion: result.result.modelVersion, durationMs: result.result.durationMs,
    elapsedMs: result.elapsedMs, words,
    note: 'Cloud word times require source-page transcript and media review before word-audio publication.'
  }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ bookId, trackIndex, durationMs,
    wordCount: words.length, elapsedMs: result.elapsedMs, output }) + '\n');
} finally {
  if (fileID) {
    const deleted = await app.deleteFile({ fileList: [fileID] });
    if (!Array.isArray(deleted?.fileList) || deleted.fileList.length !== 1
      || deleted.fileList[0].code !== 'SUCCESS') throw new Error('TEMP_CLEANUP_GATE');
  }
}



