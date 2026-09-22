import { isRecord, type JsonObject, type JsonValue } from '../shared/protocol';
import { SEED_COLLECTION_ORDER, type SeedCollectionName, type SeedCollections, type SeedManifest, type SeedPackage } from './model';

const MAX_SEED_BYTES = 5 * 1024 * 1024;
const MANIFEST_FIELDS = new Set(['seedVersion', 'schemaVersion', 'source', 'generatedAt', 'contentHash', 'seedRunId', 'expectedCounts']);
const COLLECTION_NAMES = new Set<string>(SEED_COLLECTION_ORDER);

interface BufferPort { byteLength(value: string, encoding: 'utf8'): number }
interface FilePort { readFile(path: string, options: Readonly<{ encoding: 'utf8' }>): Promise<string> }
interface PathPort { basename(path: string): string; extname(path: string): string; resolve(path: string): string }
declare const Buffer: BufferPort;
declare const require: {
  (moduleName: 'node:fs/promises'): FilePort;
  (moduleName: 'node:path'): PathPort;
};

export class SeedLoadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SeedLoadError';
  }
}

export async function loadSeedFile(filePath: string): Promise<SeedPackage> {
  const paths = require('node:path');
  const absolutePath = paths.resolve(filePath);
  const fileName = paths.basename(absolutePath).toLowerCase();
  if (paths.extname(fileName) !== '.json' || fileName.startsWith('.env')) {
    throw new SeedLoadError('种子工具只读取显式指定的 JSON 文件，不读取环境配置文件。');
  }
  const source = await require('node:fs/promises').readFile(absolutePath, { encoding: 'utf8' });
  if (Buffer.byteLength(source, 'utf8') > MAX_SEED_BYTES) throw new SeedLoadError('种子文件超过 5 MB 本地校验上限。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new SeedLoadError('种子文件不是有效 JSON。');
  }
  return parseSeedPackage(parsed);
}

export function parseSeedPackage(value: unknown): SeedPackage {
  if (!isRecord(value)) throw new SeedLoadError('种子根节点必须是对象。');
  const allowedTopLevel = new Set(['manifest', ...SEED_COLLECTION_ORDER]);
  const unknown = Object.keys(value).filter((key) => !allowedTopLevel.has(key));
  if (unknown.length > 0) throw new SeedLoadError(`种子包含未知顶层字段：${unknown.join('、')}。`);
  const manifest = parseManifest(value.manifest);
  const collections = Object.fromEntries(SEED_COLLECTION_ORDER.map((name) => [name, parseCollection(name, value[name])])) as unknown as SeedCollections;
  return { manifest, collections };
}

function parseManifest(value: unknown): SeedManifest {
  if (!isRecord(value)) throw new SeedLoadError('manifest 必须是对象。');
  const unknown = Object.keys(value).filter((key) => !MANIFEST_FIELDS.has(key));
  if (unknown.length > 0) throw new SeedLoadError(`manifest 包含未知字段：${unknown.join('、')}。`);
  const expectedCounts = value.expectedCounts;
  if (!isRecord(expectedCounts)) throw new SeedLoadError('manifest.expectedCounts 必须是对象。');
  for (const [name, count] of Object.entries(expectedCounts)) {
    if (!COLLECTION_NAMES.has(name)) throw new SeedLoadError(`manifest.expectedCounts 包含未知集合：${name}。`);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new SeedLoadError(`manifest.expectedCounts.${name} 必须是非负整数。`);
  }
  return {
    seedVersion: readString(value.seedVersion, 'manifest.seedVersion'),
    schemaVersion: readNumber(value.schemaVersion, 'manifest.schemaVersion'),
    source: readString(value.source, 'manifest.source') as 'm0-fixture',
    generatedAt: readString(value.generatedAt, 'manifest.generatedAt'),
    contentHash: readString(value.contentHash, 'manifest.contentHash'),
    seedRunId: readString(value.seedRunId, 'manifest.seedRunId'),
    expectedCounts: expectedCounts as Readonly<Record<string, number>>,
  };
}

function parseCollection(name: SeedCollectionName, value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) throw new SeedLoadError(`${name} 必须是数组。`);
  return value.map((document, index) => {
    if (!isRecord(document) || !isJsonValue(document)) throw new SeedLoadError(`${name}[${index}] 必须是 JSON 对象。`);
    return document;
  });
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SeedLoadError(`${path} 必须是字符串。`);
  return value;
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SeedLoadError(`${path} 必须是有限数字。`);
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
