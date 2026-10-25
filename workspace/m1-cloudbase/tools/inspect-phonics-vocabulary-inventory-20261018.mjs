// Read-only, redacted inventory of existing self-study phonics and grade word packs.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function call(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('CLOUD_READ_FAILED'); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const value = JSON.parse(raw.slice(at));
  if (value.error) throw new Error('CLOUD_API_ERROR');
  return value.data;
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const env = call(['env', 'list', '--json']);
if (env.length !== 1 || env[0].EnvId !== config.envId || env[0].Status !== 'NORMAL'
  || env[0].EnvPaid !== 'no' || env[0].EnvCharged !== 'no'
  || env[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_ENV_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== config.envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const db = require('@cloudbase/node-sdk').init({ env: config.envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token }).database();
async function all(collection) {
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await db.collection(collection).skip(offset).limit(100).get();
    rows.push(...page.data);
    if (page.data.length < 100) break;
  }
  if (rows.length >= 5000) throw new Error('INVENTORY_LIMIT');
  return rows;
}
const [courses, resources] = await Promise.all([all('phonics_courses'), all('learning_resources')]);
if (process.argv.includes('--word-samples')) {
  const selected = ['supplement-pep3a-u3-complete-v1', 'supplement-pep4a-u1-complete-v1',
    'supplement-join5a-1-complete-v1', 'supplement-join6a-1-complete-v1'];
  const samples = selected.map(id => {
    const row = resources.find(item => item._id === id);
    if (!row || row.status !== 'published') throw new Error(`PUBLISHED_PACK_MISSING:${id}`);
    const words = row.payload?.words ?? row.payload?.vocabulary?.words;
    return { id, grade: row.grade, words: Array.isArray(words) ? words.map(item => ({
      word: item.word ?? item.spelling ?? null,
      syllables: item.syllables ?? null,
    })) : [] };
  });
  process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction', samples,
    cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (process.argv.includes('--grade-words')) {
  const grades = ['三年级', '四年级', '五年级', '六年级'];
  const wordSets = grades.map(grade => {
    const matching = resources.filter(row => row.type === 'vocabulary' && row.status === 'published'
      && row.grade === grade && row._id.startsWith('supplement-'));
    const words = [...new Set(matching.flatMap(row => (row.payload?.words ?? [])
      .map(item => String(item.word ?? item.spelling ?? '').toLowerCase()).filter(Boolean)))].sort();
    return { grade, packCount: matching.length, wordCount: words.length, words };
  });
  process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction', wordSets,
    cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (process.argv.includes('--phonics-audio-candidates')) {
  const plan = {
    '三年级': ['cat', 'pet', 'big', 'sun'],
    '四年级': ['shop', 'child', 'clean', 'kite'],
    '五年级': ['thin', 'boat', 'team', 'light'],
    '六年级': ['couch', 'shoot', 'lake', 'pea'],
  };
  const result = Object.entries(plan).map(([grade, selected]) => {
    const packs = resources.filter(row => row.type === 'vocabulary' && row.status === 'published'
      && row.grade === grade && row._id.startsWith('supplement-'));
    return { grade, selected: selected.map(word => {
      const match = packs.flatMap(pack => (pack.payload?.words ?? [])
        .map(item => ({ packId: pack._id, item })))
        .find(entry => String(entry.item.word ?? entry.item.spelling).toLowerCase() === word);
      return { word, packId: match?.packId ?? null,
        audioAvailable: typeof match?.item.audioAssetKey === 'string'
          && match.item.audioAssetKey.startsWith('cloud://') };
    }) };
  });
  process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction', result,
    cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (process.argv.includes('--audio-shape')) {
  const row = resources.find(item => item._id === 'supplement-pep3a-u3-complete-v1');
  const word = row?.payload?.words?.find(item => item.word === 'cat');
  const another = row?.payload?.words?.find(item => item.word === 'dog');
  if (!word) throw new Error('AUDIO_WORD_MISSING');
  process.stdout.write(JSON.stringify({ packId: row._id, wordKeys: Object.keys(word).sort(),
    audioAssetKeyIsCloud: word.audioAssetKey?.startsWith('cloud://') === true,
    startMs: word.startMs ?? null,
    endMs: word.endMs ?? null,
    otherWordSharesAudio: another?.audioAssetKey === word.audioAssetKey,
    otherStartMs: another?.startMs ?? null, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (process.argv.includes('--pack-shape')) {
  const ids = ['supplement-pep3a-u3-complete-v1', 'supplement-join5a-1-complete-v1'];
  process.stdout.write(JSON.stringify(ids.map(id => {
    const row = resources.find(item => item._id === id);
    return { id, version: row?.contentVersion, status: row?.status,
      reviewStatus: row?.payload?.assetLibrary?.reviewStatus,
      assetLibraryKeys: Object.keys(row?.payload?.assetLibrary ?? {}).sort() };
  })) + '\n');
  process.exit(0);
}
const phonics = courses.map(row => ({ id: row._id, title: row.title,
  grade: row.grade, status: row.status, questionCount: row.questions?.length ?? 0,
  phonemeCount: row.phonemes?.length ?? 0, audioCount: row.phonemes?.filter(item => item.audioFileId).length ?? 0,
  sourceId: row.sourceResourceId ?? null, version: row.contentVersion ?? null }));
const vocabulary = resources.filter(row => row.type === 'vocabulary')
  .map(row => ({ id: row._id, title: row.title, grade: row.grade ?? row.payload?.grade ?? null,
    status: row.status, wordCount: row.payload?.words?.length ?? row.payload?.vocabulary?.words?.length ?? null,
    sourceId: row.payload?.assetLibrary?.sourcePublicId ?? row.payload?.assetLibrary?.sourceResourceId ?? null,
    testOnly: row.testOnly === true || row.payload?.testOnly === true }));
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction',
  phonicsCourseCount: phonics.length, phonics, vocabularyRecordCount: vocabulary.length,
  vocabulary, cloudWrites: 0 }) + '\n');
