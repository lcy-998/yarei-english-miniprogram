import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/u).flatMap((line) => {
  const separator = line.indexOf('=');
  return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
}));
const cliPath = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const rawCredentials = execFileSync(process.execPath, [cliPath, 'secrets', 'get', '--json'], { encoding: 'utf8' });
const credentials = JSON.parse(rawCredentials.slice(Math.min(...[rawCredentials.indexOf('{'), rawCredentials.indexOf('[')].filter((value) => value >= 0)))).data;
const cloudbase = require('@cloudbase/js-sdk');
const app = cloudbase.init({ env: env.TCB_ENV_ID, secretId: credentials.secretId, secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = app.database();
const now = new Date().toISOString();
const organizationId = 'org_qihang_demo';
const seedRunId = 'seed_m1_content_expansion_v1';
const resources = [
  resource('res_reading_zoo_cloud_v2', 'reading', 'A Day at the Zoo', {
    category: 'picture_book', grade: '三年级', difficulty: '基础', chapters: [{
      id: 'chapter_zoo_cloud_01', title: 'At the Zoo', order: 1, pages: [{
        id: 'page_zoo_cloud_01', pageNumber: 1, order: 1,
        thumbnailAssetKey: 'demo/reading/zoo/page-01-thumbnail', imageAssetKey: 'demo/reading/zoo/page-01-image',
        width: 1200, height: 1600, assetVersion: '1',
      }, {
        id: 'page_zoo_cloud_02', pageNumber: 2, order: 2,
        thumbnailAssetKey: 'demo/reading/zoo/page-02-thumbnail', imageAssetKey: 'demo/reading/zoo/page-02-image',
        width: 1200, height: 1600, assetVersion: '1',
      }],
    }],
  }),
  resource('res_vocabulary_animals_cloud_v1', 'vocabulary', 'Animals Word Pack', {
    grade: '三年级', unit: 'Unit 3', words: [
      { id: 'word_animal_cloud_01', word: 'animal', meaning: '动物', example: 'The animal is at the zoo.', syllables: ['an', 'i', 'mal'] },
      { id: 'word_zoo_cloud_01', word: 'zoo', meaning: '动物园', example: 'We visit the zoo today.', syllables: ['zoo'] },
      { id: 'word_tiger_cloud_01', word: 'tiger', meaning: '老虎', example: 'The tiger is strong.', syllables: ['ti', 'ger'] },
      { id: 'word_lion_cloud_01', word: 'lion', meaning: '狮子', example: 'The lion is at the zoo.', syllables: ['li', 'on'] },
      { id: 'word_monkey_cloud_01', word: 'monkey', meaning: '猴子', example: 'The monkey can jump.', syllables: ['mon', 'key'] },
      { id: 'word_bird_cloud_01', word: 'bird', meaning: '鸟', example: 'A bird can fly.', syllables: ['bird'] },
      { id: 'word_fish_cloud_01', word: 'fish', meaning: '鱼', example: 'The fish can swim.', syllables: ['fish'] },
      { id: 'word_bear_cloud_01', word: 'bear', meaning: '熊', example: 'The bear is big.', syllables: ['bear'] },
    ],
  }),
];

await database.runTransaction(async (transaction) => {
  for (const item of resources) {
    const existing = await getOptionalDocument(transaction, item._id);
    const rows = Array.isArray(existing?.data) ? existing.data : existing?.data?.list ?? (existing?.data === undefined ? [] : [existing.data]);
    if (rows.length > 0) throw new Error('CONTENT_EXPANSION_ID_CONFLICT');
  }
  for (const item of resources) {
    const { _id, ...fields } = item;
    await transaction.collection('learning_resources').doc(_id).set(fields);
  }
});
process.stdout.write('CONTENT_EXPANSION=created\nRESOURCE_COUNT=2\n');

function resource(id, type, title, payload) {
  return {
    _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null,
    seedRunId, seedVersion: 'content-expansion-v1', createdAt: now, updatedAt: now,
    type, title, contentVersion: 1, status: 'published', copyrightStatus: 'demo',
    visibility: { type: 'classes', classIds: ['cls_grade3_2', 'cls_grade4_1'] }, payload,
  };
}

async function getOptionalDocument(transaction, id) {
  try {
    return await transaction.collection('learning_resources').doc(id).get();
  } catch (error) {
    if (String(error?.code ?? '').toUpperCase().includes('DOCUMENT_NOT_FOUND')) return { data: [] };
    throw error;
  }
}
