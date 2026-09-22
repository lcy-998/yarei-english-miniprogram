import type { JsonValue } from '../shared/protocol';

export interface SeedManifest {
  readonly seedVersion: string;
  readonly schemaVersion: number;
  readonly source: 'm0-fixture';
  readonly generatedAt: string;
  readonly contentHash: string;
  readonly seedRunId: string;
  readonly expectedCounts: Readonly<Record<string, number>>;
}

export interface SeedDryRunInput {
  readonly manifest: SeedManifest;
  readonly collections: Readonly<Record<string, readonly Readonly<Record<string, JsonValue>>[]>>;
}

export interface SeedDryRunResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

const REQUIRED_COLLECTIONS = ['organizations', 'users', 'auth_identities', 'role_assignments', 'classes', 'class_memberships', 'teacher_class_grants', 'parent_student_links'] as const;
const FORBIDDEN_FIELD_NAMES = ['password', 'mobile', 'phone', 'token', 'secret', 'appSecret'] as const;

export function dryRunSeed(input: SeedDryRunInput): SeedDryRunResult {
  const errors: string[] = [];
  const counts = Object.fromEntries(Object.entries(input.collections).map(([name, documents]) => [name, documents.length]));
  if (!input.manifest.seedVersion || !input.manifest.seedRunId || input.manifest.schemaVersion < 1) errors.push('manifest 必须包含有效版本和 seedRunId。');
  for (const collection of REQUIRED_COLLECTIONS) if (input.collections[collection] === undefined) errors.push(`缺少必需集合：${collection}。`);
  for (const [collection, expected] of Object.entries(input.manifest.expectedCounts)) if ((counts[collection] ?? 0) !== expected) errors.push(`${collection} 的数量与 manifest 不一致。`);
  const ids = new Set<string>();
  for (const [collection, documents] of Object.entries(input.collections)) {
    for (const document of documents) {
      const id = document._id;
      if (typeof id !== 'string' || id.length === 0) errors.push(`${collection} 含无效 _id。`);
      else if (ids.has(`${collection}/${id}`)) errors.push(`${collection} 存在重复 _id：${id}。`);
      else ids.add(`${collection}/${id}`);
      validateNoSensitiveFields(collection, document, errors);
    }
  }
  validateReferences(input.collections, errors);
  validateUserAuthorizationVersions(input.collections.users ?? [], errors);
  return { ok: errors.length === 0, errors, counts };
}

function validateUserAuthorizationVersions(
  users: readonly Readonly<Record<string, JsonValue>>[],
  errors: string[],
): void {
  for (const user of users) {
    const value = user.authorizationVersion;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      errors.push(`users/${String(user._id ?? 'unknown')}.authorizationVersion 必须是大于等于 1 的整数。`);
    }
  }
}

function validateNoSensitiveFields(path: string, value: JsonValue, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSensitiveFields(`${path}[${index}]`, item, errors));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.some((forbidden) => key.toLowerCase().includes(forbidden.toLowerCase()))) errors.push(`${path}.${key} 不允许出现在虚构种子中。`);
    validateNoSensitiveFields(`${path}.${key}`, child, errors);
  }
}

function validateReferences(collections: SeedDryRunInput['collections'], errors: string[]): void {
  const known = new Set(Object.values(collections).flat().map((document) => document._id).filter((id): id is string => typeof id === 'string'));
  const references: ReadonlyArray<readonly [string, string]> = [
    ['auth_identities', 'userId'], ['role_assignments', 'userId'], ['class_memberships', 'studentId'], ['teacher_class_grants', 'teacherId'], ['parent_student_links', 'parentId'], ['parent_student_links', 'studentId'],
  ];
  for (const [collection, field] of references) {
    for (const document of collections[collection] ?? []) {
      const target = document[field];
      if (typeof target !== 'string' || !known.has(target)) errors.push(`${collection}.${field} 引用了不存在的对象。`);
    }
  }
}
