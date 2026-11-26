import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = 'G:/英语资产';
const envId = 'cloud1-d8ggzrwwedb786e41';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const clipHashes = {
  0: '76f80eb3d777ff69d44146170dd6d745c1469ed3fd98df8e0086b04d2e456a48',
  30: 'c97e317db27e7ece1b218d81a2c767803b5586831557a81e347098598337d85c',
  60: '329bd72883f61dc6f8108431d67d1d38232e9ffd8fe52ebb67138bc49c2b2335',
  90: '9d39c2ca1110136feaa14690491a01378cb06c26859ba7729a1396e880761791',
  120: 'd9caf2d4d5e65c1c4460e31b6d3ef8f0496ba74ba1ceab031aa2d487a5e3dd6f',
  150: 'aea077321c1fa920d9c486b4f8c5429ee7c2114e6ceb87edee154b228108afb1',
  180: 'ae6874b4bd3ad863258971ee4644445d8047f8a62d05ada604d26b419b9826c6',
  210: '7433a240784a5562b1a3c0557b1a372ea54e93cea2f478f45e61114a4716a267',
  240: 'b17fbef6ac40419c1df4967b0c7c31c21aa30b5289a51b8dbe9edbb00cfcb8f0',
  270: '7020ec08593be0b12c42c0a85781187310863c1206cae7744f569a72215ef10e',
  300: 'e36f5a47140d85c5573fd7bf7bcc95fa60faa364978b7e3cc6ca9111e64e4384',
  330: 'da59981f0b1521032348f68451c1a1c5f2127ab042a3e1f5ae3879deab4f160d',
  356: '5ec4c6e82cac1c767bcf07e2cea55c7148171661b266532c877cc644b08b48c9',
};
const clipStartSeconds = Number(process.argv[2]);
if (!Object.hasOwn(clipHashes, clipStartSeconds)) throw new Error('CLIP_ARGUMENT_INVALID');
const clipEndSeconds = clipStartSeconds + 30;
const clipRelativePath = `library/derived/bbc-2025-musician-audio-review/v1/musician-${clipStartSeconds}-${clipEndSeconds}s-source-clip-v1.mp3`;
const outputRelativePath = `library/derived/bbc-2025-musician-audio-review/v1/cloud-vosk-${clipStartSeconds}-${clipEndSeconds}s-candidate-v1.json`;
const clipPath = join(assetRoot, ...clipRelativePath.split('/'));
const outputPath = join(assetRoot, ...outputRelativePath.split('/'));
const expectedClipSha256 = clipHashes[clipStartSeconds];
const expectedOriginalSha256 = 'd4ea3d0876613f6a513859d504b038448077f616ec5757304c12b107b4fac1f2';
const originalRelativePath = '2021-2025年《BBC  LEARNING ENGLISH》 6 Minute English合集/BBC 6 minute English 2025合集/2025上半年/250130_6_minute_english_becoming_a_musician_download.mp3';
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

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

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
if (config.envId !== envId) throw new Error('ENVIRONMENT_CHANGED');
const originalBytes = await readFile(join(assetRoot, ...originalRelativePath.split('/')));
const clipBytes = await readFile(clipPath);
if (sha(originalBytes) !== expectedOriginalSha256 || sha(clipBytes) !== expectedClipSha256) {
  throw new Error('LOCAL_SOURCE_HASH_MISMATCH');
}
try {
  await readFile(outputPath);
  throw new Error('IMMUTABLE_OUTPUT_EXISTS');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
for (const [metric, maximum] of [['FunctionInvocation', 190000],
  ['StorageSizepkg', 2900], ['StorageWritepkg', 190000]]) {
  const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json']);
  if (!Number.isFinite(quota?.Value) || quota.Value > maximum) {
    throw new Error(`QUOTA_GATE_${metric}`);
  }
}
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_NOT_PRIVATE');
const functionInfo = cliData(['fn', 'detail', 'pronunciation-inference', '--json']);
const variables = Object.fromEntries((functionInfo?.Environment?.Variables ?? [])
  .map(entry => [entry.Key, entry.Value]));
if (functionInfo?.Status !== 'Active' || functionInfo?.Runtime !== 'Python3.11'
  || Number(functionInfo?.Timeout) < 90 || (functionInfo?.Triggers ?? []).length !== 0
  || typeof variables.VOICE_INTERNAL_SECRET !== 'string'
  || variables.VOICE_INTERNAL_SECRET.length < 32
  || typeof variables.VOICE_ALLOWED_MEDIA_HOST !== 'string') throw new Error('INTERNAL_MODEL_NOT_READY');
const ffprobe = 'D:/app-cache/m3-media-tools/ffmpeg-release-essentials/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe';
const durationMs = Math.round(Number(execFileSync(ffprobe,
  ['-v', 'error', '-show_entries', 'format=duration', '-of',
    'default=noprint_wrappers=1:nokey=1', clipPath],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim()) * 1000);
if (!Number.isFinite(durationMs) || durationMs < 29000 || durationMs > 31000) {
  throw new Error('CLIP_DURATION_INVALID');
}
const temp = cliData(['secrets', 'get', '--json']);
if (temp?.isTemporary !== true || temp.envId !== envId
  || Date.parse(temp.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_CREDENTIALS_INVALID');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: temp.secretId,
  secretKey: temp.secretKey, sessionToken: temp.token });
const cloudPath = `yarei-assets/internal/bbc-audio-review/20261027/musician-${clipStartSeconds}-${clipEndSeconds}-${expectedClipSha256.slice(0, 12)}.mp3`;
const existing = cliData(['storage', 'list', cloudPath, '--json']);
if (Array.isArray(existing) && existing.length) throw new Error('TEMP_STORAGE_COLLISION');

let fileID;
try {
  const uploaded = await app.uploadFile({ cloudPath, fileContent: clipBytes });
  fileID = uploaded?.fileID;
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new Error('UPLOAD_INVALID');
  const downloaded = await app.downloadFile({ fileID });
  if (sha(Buffer.from(downloaded.fileContent)) !== expectedClipSha256) {
    throw new Error('CLOUD_HASH_MISMATCH');
  }
  const signed = await app.getTempFileURL({ fileList: [{ fileID, maxAge: 60 }] });
  const fileUrl = signed?.fileList?.[0]?.tempFileURL;
  if (typeof fileUrl !== 'string' || new URL(fileUrl).hostname !== variables.VOICE_ALLOWED_MEDIA_HOST) {
    throw new Error('SIGNED_URL_HOST_MISMATCH');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const job = { operationId: `bbc-musician-${clipStartSeconds}-${clipEndSeconds}-${expectedClipSha256.slice(0, 12)}`,
    recordingId: `bbc-musician-20250130-${clipStartSeconds}-${clipEndSeconds}`, fileUrl,
    sha256: expectedClipSha256, sizeBytes: clipBytes.length, durationMs };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(job)
    .sort(([left], [right]) => left.localeCompare(right))));
  const signature = createHmac('sha256', variables.VOICE_INTERNAL_SECRET)
    .update(`${timestamp}\n${canonical}`).digest('hex');
  const result = await invokeScf(temp, { job, timestamp, signature });
  if (result?.ok !== true || result.result?.modelVersion !== 'vosk-model-small-en-us-0.15'
    || !Array.isArray(result.result.words)
    || Math.abs(result.result.durationMs - durationMs) > 1000) {
    throw new Error(`MODEL_RESULT_${result?.code ?? 'INVALID'}`);
  }
  const words = result.result.words;
  if (words.some(word => typeof word.word !== 'string' || typeof word.start !== 'number'
    || typeof word.end !== 'number' || typeof word.confidence !== 'number'
    || word.start < 0 || word.end <= word.start
    || word.end * 1000 > result.result.durationMs + 1000)) throw new Error('WORD_TIMES_INVALID');
  await writeFile(outputPath, JSON.stringify({ schemaVersion: 1, status: 'alignment_candidate_only',
    episode: 'BBC 6 Minute English 2025-01-30 Becoming a musician',
    sourceAudioRelativePath: originalRelativePath, sourceAudioSha256: expectedOriginalSha256,
    clipRelativePath, clipSha256: expectedClipSha256,
    clipSourceRangeMs: { startMs: clipStartSeconds * 1000,
      endMs: Math.min(385977, clipEndSeconds * 1000) },
    modelVersion: result.result.modelVersion, durationMs: result.result.durationMs,
    elapsedMs: result.elapsedMs, words,
    note: 'Cloud Vosk word times are machine evidence only; no publication or actual listening claimed.'
  }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: 'candidate', durationMs: result.result.durationMs,
    words: words.length, outputRelativePath, published: false }) + '\n');
} finally {
  if (fileID) {
    await app.deleteFile({ fileList: [fileID] });
  }
}
