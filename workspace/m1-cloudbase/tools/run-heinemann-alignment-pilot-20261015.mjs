import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const argument = process.argv[2];
const resourceId = argument?.startsWith('book-') ? argument : 'book-74899b89e8b8';
const sungComparison = process.argv.includes('--sung');
const sungPaths = new Map([
  ['book-47d8344d39b1', '海尼曼/海尼曼GK唱读版音频/07--海尼曼 GK 第一阶 70节_7. On The Way To School.mp3'],
  ['book-2324d4e33aa2', '海尼曼/海尼曼GK唱读版音频/15--海尼曼 GK 第一阶 70节_15. The Baby.mp3'],
  ['book-2936d001b060', '海尼曼/海尼曼GK唱读版音频/57--海尼曼 GK 第一阶 70节_57. Fun At School.mp3'],
  ['book-32b3c6477d76', '海尼曼/海尼曼GK唱读版音频/48--海尼曼 GK 第一阶 70节_48. My Family.mp3'],
]);
if (sungComparison && !sungPaths.has(resourceId)) throw new Error('SUNG_SCOPE_INVALID');
const pageNumber = argument?.startsWith('book-')
  ? (process.argv[3] === undefined || process.argv[3] === '--sung' ? null : Number(process.argv[3]))
  : (argument === undefined ? null : Number(argument));
const sentenceIndex = process.argv[4] === undefined ? null : Number(process.argv[4]);
if (sentenceIndex !== null && (resourceId !== 'book-32b3c6477d76'
  || pageNumber === null || ![1, 2].includes(sentenceIndex))) throw new Error('SENTENCE_ARGUMENT_INVALID');
if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 3 || pageNumber > 11)) {
  throw new Error('PAGE_ARGUMENT_INVALID');
}
const envId = 'cloud1-d8ggzrwwedb786e41';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const output = join(assets, 'library/derived/heinemann-alignment-2026-10-15', resourceId,
  sungComparison ? 'vosk-sung-comparison-candidate-v1.json'
    : sentenceIndex !== null ? `vosk-page-${String(pageNumber).padStart(4, '0')}-sentence-${String(sentenceIndex).padStart(2, '0')}-candidate-v1.json`
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
if (!book || !book.sourceRelativePath.startsWith('海尼曼/')) throw new Error('BOOK_SCOPE_INVALID');
const pairs = JSON.parse(await readFile(join(assets,
  'reports/heinemann-audio-pairing-candidates-2026-10-15.json'), 'utf8'));
const pair = pairs.find(item => item.resourceId === resourceId);
if (!pair || pair.candidateStatus !== 'title_exact'
  || (resourceId !== 'book-74899b89e8b8' && pair.numberMatch !== 'true')) {
  throw new Error('BOOK_AUDIO_PAIR_NOT_EXACT');
}
const audio = catalog.resources.find(item => item.resourceType === 'audio'
  && item.sourceRelativePath === (sungComparison
    ? sungPaths.get(resourceId)
    : sentenceIndex !== null
      ? `library/derived/heinemann-gk-audio-2026-10-15/${resourceId}/v1/sentences/page-${String(pageNumber).padStart(4, '0')}-sentence-${String(sentenceIndex).padStart(2, '0')}-v1.mp3`
    : pageNumber === null ? pair.audioCandidate
    : resourceId === 'book-74899b89e8b8'
      ? `library/derived/heinemann-at-the-market-2026-10-15/v1/pages/page-${String(pageNumber).padStart(4, '0')}-narration-v1.mp3`
      : `library/derived/heinemann-${pair.series.toLowerCase()}-audio-2026-10-15/${resourceId}/v1/pages/page-${String(pageNumber).padStart(4, '0')}-narration-v1.mp3`));
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
const cloudPath = `yarei-assets/internal/heinemann-alignment/20261015/${resourceId}-${audioSha.slice(0,12)}.mp3`;
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
  const job = { operationId: `heinemann-alignment-${resourceId}-${audioSha.slice(0,12)}`,
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
    ...(resourceId === 'book-74899b89e8b8'
      ? { transcript: words.map(word => word.word).join(' ') } : {}) }) + '\n');
} finally {
  if (fileID) {
    const deleted = await app.deleteFile({ fileList: [fileID] });
    if (!Array.isArray(deleted?.fileList) || deleted.fileList.length !== 1
      || deleted.fileList[0].code !== 'SUCCESS') throw new Error('TEMP_MEDIA_CLEANUP_UNCONFIRMED');
  }
}
