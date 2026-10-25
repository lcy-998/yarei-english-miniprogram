import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Prepare a code-only nonproduction review package. No cloud write occurs. */
const root = resolve(import.meta.dirname, '..');
const rebased = process.argv[2] === '--rebased';
if (process.argv.length > 3 || process.argv[2] && !rebased) throw new Error('MODE_INVALID');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(raw.slice(start)).data;
}
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_PREFLIGHT_FAILED');
const detail = cliData(['fn', 'detail', 'task-command', '--json']);
if (detail.FunctionName !== 'task-command' || detail.Status !== 'Active'
  || detail.Runtime !== 'Nodejs20.19' || detail.Timeout !== 20
  || detail.MemorySize !== 256 || detail.InstallDependency !== 'FALSE'
  || detail.FunctionVersion !== '$LATEST' || !Array.isArray(detail.Triggers)
  || detail.Triggers.length !== 0 || typeof detail.CodeInfo !== 'string') {
  throw new Error('REMOTE_FUNCTION_CONFIG_CHANGED');
}
const sha = value => createHash('sha256').update(value).digest('hex');
const original = detail.CodeInfo;
const expectedBase = rebased
  ? 'ad0a4bf3c21dd4ba9e436c108bd3084f1ddd67b6283374a854dc4e9927336bdd'
  : '373a5b8b8ed5c5845ba0694947fd4e3e67bf012ea3533acdcd26b288b1f24806';
if (sha(original) !== expectedBase) throw new Error('REMOTE_FUNCTION_CODE_CHANGED');
let patched = original;
function replaceOnce(before, after) {
  if (patched.split(before).length !== 2) throw new Error('REMOTE_PATCH_CONTEXT_CHANGED');
  patched = patched.replace(before, after);
}
const functionStart = 'function decodeLearningResource(document2) {';
const functionEnd = '\nasync function readTaskRecording(';
const start = patched.indexOf(functionStart);
const end = patched.indexOf(functionEnd, start);
if (start < 0 || end < 0 || patched.indexOf(functionStart, end) >= 0) {
  throw new Error('REMOTE_RESOURCE_DECODER_CHANGED');
}
const beforeDecoder = patched.slice(start, end);
const afterDecoder = beforeDecoder
  .replace('  const resource = decodeDocument(document2);', [
    '  const resource = decodeDocument(document2);',
    '  const storedPayload = document2.payload;',
    '  const payload = storedPayload !== null && typeof storedPayload === "object" && !Array.isArray(storedPayload) ? storedPayload : null;',
    '  if (storedPayload !== void 0 && payload === null) throw new TaskCorePersistenceError("INTERNAL_ERROR");',
    '  const vocabularyPayload = resource.type === "vocabulary" ? {',
    '    ...(payload ?? {}),',
    '    ...["grade", "term", "textbook", "unit", "words"].reduce((fields, key) => {',
    '      const value = payload?.[key] ?? document2[key];',
    '      if (value !== void 0) fields[key] = value;',
    '      return fields;',
    '    }, {})',
    '  } : null;',
    '  if (resource.type !== "vocabulary" && payload === null) throw new TaskCorePersistenceError("INTERNAL_ERROR");',
  ].join('\n'))
  .replace('    visibility,\n    allowedClassIds: [...allowedClassIds]',
    '    payload: structuredClone(vocabularyPayload ?? payload),\n    visibility,\n    allowedClassIds: [...allowedClassIds]');
if (afterDecoder === beforeDecoder || !afterDecoder.includes('payload: structuredClone(vocabularyPayload ?? payload)')) {
  throw new Error('REMOTE_RESOURCE_DECODER_PATCH_FAILED');
}
replaceOnce(beforeDecoder, afterDecoder);
replaceOnce('function approvedReadingPronunciation(payload, resourceVersion) {',
  'function approvedReadingPronunciation(payload, resourceVersion, copyrightStatus = payload.copyrightStatus) {');
replaceOnce('if (payload.copyrightStatus !== "verified" || !record2(payload.pronunciation)) return false;',
  'if (copyrightStatus !== "verified" || !record2(payload.pronunciation)) return false;');
replaceOnce('!approvedReadingPronunciation(resource.payload, resource.contentVersion)',
  '!approvedReadingPronunciation(resource.payload, resource.contentVersion, resource.copyrightStatus ?? null)');
replaceOnce('snapshotSchemaVersion: wordIds === null ? 1 : 2,\n      resourceSnapshot: { title: resource.title, type: resource.type, payload: resource.payload },',
  'snapshotSchemaVersion: wordIds === null ? 1 : 2,\n      resourceSnapshot: { title: resource.title, type: resource.type, payload: resource.type === "reading" && resource.copyrightStatus ? { ...resource.payload, copyrightStatus: resource.copyrightStatus } : resource.payload },');
const output = resolve(root, rebased
  ? 'dist/m3-task-publication-hotfix-20261008-rebased'
  : 'dist/m3-task-publication-hotfix-20261008');
const target = resolve(output, 'task-command');
await mkdir(target, { recursive: true });
await writeFile(resolve(output, 'baseline-index.js'), original, 'utf8');
await writeFile(resolve(target, 'index.js'), patched, 'utf8');
await writeFile(resolve(target, 'package.json'), `${JSON.stringify({
  name: 'yarei-cloud-function-task-command', version: '0.1.0', private: true,
  main: 'index.js', engines: { node: '20.19.x' },
  dependencies: { '@cloudbase/node-sdk': '3.18.3' },
}, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({ status: 'prepared', remoteModifiedAt: detail.ModTime,
  baselineSha256: sha(original), patchedSha256: sha(patched),
  baselineBytes: Buffer.byteLength(original), patchedBytes: Buffer.byteLength(patched),
  output }) + '\n');
