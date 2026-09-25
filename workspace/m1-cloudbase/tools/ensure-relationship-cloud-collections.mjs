import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import tcb from '@cloudbase/node-sdk';

const environment = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/u).flatMap((line) => {
  const separator = line.indexOf('=');
  return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
}));
const rawSecrets = execFileSync(process.execPath, ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', 'secrets', 'get', '--json'], { encoding: 'utf8' });
const firstJson = Math.min(...[rawSecrets.indexOf('{'), rawSecrets.indexOf('[')].filter((index) => index >= 0));
const credentials = JSON.parse(rawSecrets.slice(firstJson)).data;
const database = tcb.init({
  env: environment.TCB_ENV_ID,
  secretId: credentials.secretId,
  secretKey: credentials.secretKey,
  sessionToken: credentials.token,
}).database();

const requiredCollections = ['idempotency_records', 'org_content_guards'];
const created = [];
for (const collection of requiredCollections) {
  if (await exists(collection)) continue;
  await database.createCollection(collection);
  created.push(collection);
}
for (const collection of requiredCollections) {
  if (!await exists(collection)) throw new Error(`RELATIONSHIP_COLLECTION_UNAVAILABLE:${collection}`);
}
process.stdout.write(`RELATIONSHIP_COLLECTIONS_READY=${requiredCollections.length}; CREATED=${created.length}\n`);

async function exists(collection) {
  try {
    await database.collection(collection).limit(1).get();
    return true;
  } catch (error) {
    if (String(error?.code ?? '').includes('DATABASE_COLLECTION_NOT_EXIST')) return false;
    throw error;
  }
}
