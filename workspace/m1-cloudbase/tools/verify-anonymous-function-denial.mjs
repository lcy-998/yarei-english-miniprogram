import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUD_FUNCTIONS } from './build-cloud-functions.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env.local');
const variables = parseEnvironment(await readFile(ENV_PATH, 'utf8'));
const envId = variables.TCB_ENV_ID;
if (typeof envId !== 'string' || envId.trim().length === 0) throw new Error('TCB_ENV_ID is missing.');

const sdk = createRequire(import.meta.url)('@cloudbase/js-sdk');
if (sdk === null || (typeof sdk !== 'object' && typeof sdk !== 'function') || typeof sdk.init !== 'function') {
  throw new Error('The pinned CloudBase JS SDK is unavailable.');
}
const app = sdk.init({ env: envId });
const failures = [];

for (const { name } of CLOUD_FUNCTIONS) {
  try {
    const response = await app.callFunction({
      name,
      data: { apiVersion: 'm1.v1', action: '__anonymous_probe__', payload: {} },
      parse: true,
    });
    failures.push(`${name}:INVOKED:${safeResultCode(response?.result)}`);
  } catch (error) {
    const code = safeErrorCode(error);
    if (code !== 'MISSING_CREDENTIALS') failures.push(`${name}:ERROR:${code}`);
    else process.stdout.write(`${name}=MISSING_CREDENTIALS\n`);
  }
}

if (failures.length > 0) {
  process.stdout.write(`anonymous_denial_passed=false; failures=${failures.join(',')}\n`);
  process.exit(2);
} else {
  process.stdout.write(`anonymous_denial_passed=true; function_count=${CLOUD_FUNCTIONS.length}\n`);
  process.exit(0);
}

function parseEnvironment(source) {
  const result = Object.create(null);
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    result[name] = value;
  }
  return result;
}

function safeErrorCode(error) {
  if (error === null || typeof error !== 'object') return 'UNKNOWN';
  for (const candidate of [error.code, error.errorCode, error.errCode]) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const normalized = String(candidate).replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
      return normalized.length === 0 ? 'UNKNOWN' : normalized;
    }
  }
  return 'UNKNOWN';
}

function safeResultCode(result) {
  if (result !== null && typeof result === 'object' && result.ok === false
    && result.error !== null && typeof result.error === 'object'
    && typeof result.error.code === 'string') {
    return result.error.code.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
  }
  return 'UNEXPECTED_RESULT';
}
