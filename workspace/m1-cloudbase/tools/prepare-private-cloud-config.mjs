import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUD_FUNCTIONS } from './build-cloud-functions.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(PROJECT_ROOT, '..', '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env.local');
const TEMPLATE_PATH = resolve(REPOSITORY_ROOT, 'docs', 'm1-cloudbase', 'templates', 'cloudbaserc.example.json');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'cloudbaserc.json');
const STAGING_PATH = resolve(PROJECT_ROOT, 'cloudbaserc.json.staging');
const REQUIRED_SECRET_NAMES = Object.freeze([
  'YAREI_SUBJECT_PEPPER',
  'YAREI_QUERY_CURSOR_SIGNING_KEY',
  'YAREI_BATCH_REVIEW_SIGNING_KEY',
  'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_BINDING_CODE_DERIVATION_KEY',
  'YAREI_BINDING_CODE_PEPPER',
]);

const variables = parseEnvironment(await readFile(ENV_PATH, 'utf8'));
const template = JSON.parse(await readFile(TEMPLATE_PATH, 'utf8'));
assertPrivateVariables(variables);
const prepared = replaceVariables(template, variables);
assertPreparedConfig(prepared);
await writeFile(STAGING_PATH, `${JSON.stringify(prepared, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(STAGING_PATH, OUTPUT_PATH);
process.stdout.write(`Prepared private CloudBase config for ${prepared.functions.length} functions; no private values were printed.\n`);

function parseEnvironment(source) {
  const result = Object.create(null);
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Invalid private environment file.');
    const name = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (Object.hasOwn(result, name)) throw new Error(`Duplicate private variable name: ${name}.`);
    result[name] = value;
  }
  return result;
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1);
  return value;
}

function assertPrivateVariables(variables) {
  if (typeof variables.TCB_ENV_ID !== 'string' || variables.TCB_ENV_ID.trim().length === 0) {
    throw new Error('TCB_ENV_ID is missing.');
  }
  const values = [];
  for (const name of REQUIRED_SECRET_NAMES) {
    const value = variables[name];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
      throw new Error(`Private variable ${name} must be a 32-byte base64url value.`);
    }
    values.push(value);
  }
  if (new Set(values).size !== values.length) throw new Error('Private cryptographic values must be distinct.');
}

function replaceVariables(value, variables) {
  if (Array.isArray(value)) return value.map((item) => replaceVariables(item, variables));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVariables(item, variables)]));
  }
  if (typeof value !== 'string') return value;
  const match = /^\{\{env\.([A-Z0-9_]+)\}\}$/u.exec(value);
  if (match === null) return value;
  const variable = variables[match[1]];
  if (typeof variable !== 'string' || variable.length === 0) throw new Error(`Missing private variable ${match[1]}.`);
  return variable;
}

function assertPreparedConfig(config) {
  const expectedNames = new Set(CLOUD_FUNCTIONS.map((item) => item.name));
  if (config === null || typeof config !== 'object' || Array.isArray(config)
    || !Array.isArray(config.functions) || config.functions.length !== expectedNames.size
    || typeof config.envId !== 'string' || config.envId.length === 0) {
    throw new Error('Prepared CloudBase config does not match the reviewed function template.');
  }
  const names = config.functions.map((definition) => definition?.name);
  if (new Set(names).size !== expectedNames.size || names.some((name) => !expectedNames.has(name))) {
    throw new Error('Prepared CloudBase config function names differ from the build manifest.');
  }
  if (JSON.stringify(config).includes('{{env.')) throw new Error('Prepared CloudBase config still contains unresolved variables.');
  for (const definition of config.functions) {
    if (definition === null || typeof definition !== 'object' || Array.isArray(definition)
      || definition.runtime !== 'Nodejs20.19' || definition.handler !== 'index.main') {
      throw new Error('Prepared CloudBase function definition is invalid.');
    }
    for (const name of REQUIRED_SECRET_NAMES) {
      if (definition.envVariables?.[name] !== variables[name]) {
        throw new Error(`Prepared CloudBase function is missing ${name}.`);
      }
    }
  }
}
