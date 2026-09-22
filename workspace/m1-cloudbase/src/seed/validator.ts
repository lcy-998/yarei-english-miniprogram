import type { JsonObject, JsonValue } from '../shared/protocol';
import { ROLE_PERMISSIONS, TEACHER_CLASS_PERMISSIONS } from '../org-content/types';
import { computeSeedContentHash, CONTENT_HASH_PLACEHOLDER } from './canonical-json';
import { SEED_COLLECTION_ORDER, type SeedCollectionName, type SeedPackage, type SeedValidationIssue, type SeedValidationResult } from './model';

export interface SeedValidationOptions {
  readonly allowContentHashPlaceholder?: boolean;
  /** Defaults to fixture so local CLI and existing callers never accept runtime digests implicitly. */
  readonly identityProfile?: SeedIdentityProfile;
}

export type SeedIdentityProfile = 'fixture' | 'runtime';

type DocumentIndex = Readonly<Record<SeedCollectionName, ReadonlyMap<string, JsonObject>>>;

const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ISO_WITH_ZONE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SEED_ROLE_PERMISSIONS = [
  ...ROLE_PERMISSIONS,
  'task.read.self',
  'submission.write.self',
  'learning.read.self',
] as const;
const FORBIDDEN_KEY_PARTS = ['password', 'passwd', 'mobile', 'phone', 'email', 'token', 'secret', 'appsecret', 'privatekey', 'accesskey', 'openid', 'unionid', 'bindingcode', 'sessionkey'] as const;
const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['手机号', /(^|\D)1[3-9]\d{9}(\D|$)/],
  ['邮箱', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['JWT', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/],
  ['Bearer 凭据', /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  ['私钥', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['腾讯云 SecretId', /\bAKID[A-Za-z0-9]{12,}\b/],
  ['带凭据的 URL', /[?&](?:token|secret|signature|key)=[^&#\s]+/i],
] as const;

const STRING_FIELDS_BY_COLLECTION: Readonly<Record<SeedCollectionName, readonly string[]>> = {
  organizations: ['_id', 'organizationId', 'name', 'status', 'timeZone', 'seedRunId'],
  classes: ['_id', 'organizationId', 'name', 'term', 'status', 'seedRunId'],
  users: ['_id', 'organizationId', 'displayName', 'displayNameMasked', 'status', 'seedRunId'],
  auth_identities: ['_id', 'organizationId', 'userId', 'provider', 'providerSubjectDigest', 'status', 'verifiedAt', 'seedRunId'],
  role_assignments: ['_id', 'organizationId', 'userId', 'role', 'status', 'scopeType', 'grantedBy', 'grantedAt', 'seedRunId'],
  class_memberships: ['_id', 'organizationId', 'classId', 'studentId', 'status', 'joinedAt', 'seedRunId'],
  teacher_class_grants: ['_id', 'organizationId', 'teacherId', 'classId', 'status', 'grantedBy', 'grantedAt', 'seedRunId'],
  parent_student_links: ['_id', 'organizationId', 'parentId', 'studentId', 'status', 'confirmedBy', 'confirmedAt', 'seedRunId'],
  learning_resources: ['_id', 'organizationId', 'type', 'title', 'status', 'copyrightStatus', 'seedRunId'],
  tasks: ['_id', 'organizationId', 'creatorTeacherId', 'title', 'deliveryType', 'status', 'targetType', 'startsAt', 'dueAt', 'visibility', 'seedRunId'],
  task_assignments: ['_id', 'organizationId', 'taskId', 'studentId', 'classId', 'status', 'seedRunId'],
  submissions: ['_id', 'organizationId', 'taskId', 'assignmentId', 'studentId', 'status', 'seedRunId'],
  review_feedback: ['_id', 'organizationId', 'taskId', 'assignmentId', 'submissionId', 'teacherId', 'decision', 'publishedAt', 'source', 'seedRunId'],
};

export function validateSeedPackage(seed: SeedPackage, options: SeedValidationOptions = {}): SeedValidationResult {
  const issues: SeedValidationIssue[] = [];
  const counts = Object.fromEntries(SEED_COLLECTION_ORDER.map((name) => [name, seed.collections[name].length])) as Record<SeedCollectionName, number>;
  validateManifest(seed, counts, issues, options);
  const index = buildIndex(seed, issues);
  for (const collection of SEED_COLLECTION_ORDER) {
    seed.collections[collection].forEach((document, position) => {
      const path = `${collection}[${position}]`;
      validateDocumentShape(seed, collection, document, path, issues, options.identityProfile ?? 'fixture');
      scanSensitiveValue(document, path, issues);
    });
  }
  validateReferences(seed, index, issues);
  validateAggregateConsistency(seed, index, issues);
  const computedContentHash = computeSeedContentHash(seed);
  return {
    ok: issues.length === 0,
    issues,
    errors: issues.map((issue) => `${issue.path}: ${issue.message}`),
    counts,
    computedContentHash,
  };
}

function validateManifest(
  seed: SeedPackage,
  counts: Readonly<Record<SeedCollectionName, number>>,
  issues: SeedValidationIssue[],
  options: SeedValidationOptions,
): void {
  const manifest = seed.manifest;
  if (!VERSION_PATTERN.test(manifest.seedVersion)) add(issues, 'MANIFEST', 'manifest.seedVersion', '必须是稳定的非空版本标识。');
  if (!ID_PATTERN.test(manifest.seedRunId)) add(issues, 'MANIFEST', 'manifest.seedRunId', '必须是小写、可读且不含姓名或手机号的标识。');
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) add(issues, 'MANIFEST', 'manifest.schemaVersion', '必须是大于等于 1 的整数。');
  if (manifest.source !== 'm0-fixture') add(issues, 'MANIFEST', 'manifest.source', 'M1 本地种子只接受 m0-fixture。');
  if (!isIsoWithZone(manifest.generatedAt)) add(issues, 'MANIFEST', 'manifest.generatedAt', '必须是带时区的 ISO 8601 时间。');
  for (const collection of SEED_COLLECTION_ORDER) {
    const expected = manifest.expectedCounts[collection];
    if (!Number.isSafeInteger(expected) || expected < 0) add(issues, 'MANIFEST', `manifest.expectedCounts.${collection}`, '必须显式声明非负整数。');
    else if (expected !== counts[collection]) add(issues, 'COUNT_MISMATCH', `manifest.expectedCounts.${collection}`, `声明 ${expected}，实际 ${counts[collection]}。`);
  }
  const computed = computeSeedContentHash(seed);
  if (manifest.contentHash === CONTENT_HASH_PLACEHOLDER && options.allowContentHashPlaceholder) return;
  if (!SHA256_PATTERN.test(manifest.contentHash)) add(issues, 'CONTENT_HASH', 'manifest.contentHash', '必须是 sha256: 前缀的 64 位小写十六进制摘要。');
  else if (manifest.contentHash !== computed) add(issues, 'CONTENT_HASH', 'manifest.contentHash', `与规范化内容不一致；当前应为 ${computed}。`);
}

function buildIndex(seed: SeedPackage, issues: SeedValidationIssue[]): DocumentIndex {
  const entries = SEED_COLLECTION_ORDER.map((collection) => {
    const documents = new Map<string, JsonObject>();
    seed.collections[collection].forEach((document, position) => {
      const id = document._id;
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        add(issues, 'DOCUMENT_SCHEMA', `${collection}[${position}]._id`, '必须是小写、不可变的业务标识。');
      } else if (documents.has(id)) {
        add(issues, 'DUPLICATE_ID', `${collection}[${position}]._id`, `集合内重复：${id}。`);
      } else {
        documents.set(id, document);
      }
    });
    return [collection, documents] as const;
  });
  return Object.fromEntries(entries) as unknown as DocumentIndex;
}

function validateDocumentShape(
  seed: SeedPackage,
  collection: SeedCollectionName,
  document: JsonObject,
  path: string,
  issues: SeedValidationIssue[],
  identityProfile: SeedIdentityProfile,
): void {
  for (const field of STRING_FIELDS_BY_COLLECTION[collection]) requireString(document, field, path, issues);
  requireInteger(document, 'schemaVersion', path, issues, 1);
  requireInteger(document, collection === 'submissions' ? 'version' : 'version', path, issues, 1);
  if (document.schemaVersion !== seed.manifest.schemaVersion) add(issues, 'DOCUMENT_SCHEMA', `${path}.schemaVersion`, '必须与 manifest.schemaVersion 一致。');
  if (document.seedRunId !== seed.manifest.seedRunId) add(issues, 'DOCUMENT_SCHEMA', `${path}.seedRunId`, '必须与 manifest.seedRunId 一致。');
  if (collection !== 'organizations' && typeof document.organizationId !== 'string') add(issues, 'DOCUMENT_SCHEMA', `${path}.organizationId`, '必须声明组织。');
  if (collection === 'users') requireInteger(document, 'authorizationVersion', path, issues, 1);
  if (collection === 'classes') requireInteger(document, 'grade', path, issues, 1);
  if (collection === 'learning_resources') requireInteger(document, 'contentVersion', path, issues, 1);
  if (collection === 'task_assignments') {
    requireInteger(document, 'latestSubmissionVersion', path, issues, 0);
    requireInteger(document, 'redoCount', path, issues, 0);
    requireNumberRange(document, 'progressPercent', path, issues, 0, 100);
  }
  if (collection === 'review_feedback' && document.score !== undefined && document.score !== null) requireNumberRange(document, 'score', path, issues, 0, 100);
  validateEnums(collection, document, path, issues);
  validateArrays(collection, document, path, issues);
  validateTimeFields(document, path, issues);
  if (collection === 'auth_identities') {
    const digest = document.providerSubjectDigest;
    const validDigest = identityProfile === 'fixture'
      ? typeof digest === 'string' && /^fixture_digest_[a-z0-9_]+$/.test(digest)
      : typeof digest === 'string' && /^sd1_[A-Za-z0-9_-]{43}$/.test(digest);
    if (document.provider !== 'cloudbase_uid' || !validDigest) {
      add(
        issues,
        'DOCUMENT_SCHEMA',
        `${path}.providerSubjectDigest`,
        identityProfile === 'fixture'
          ? 'fixture 档位只能保存 fixture_digest_ 前缀的虚构 UID 摘要占位。'
          : 'runtime 档位只接受 sd1_ 前缀加 43 位 base64url 的服务端摘要。',
      );
    }
  }
  if (collection === 'learning_resources' && document.copyrightStatus !== 'demo') add(issues, 'DOCUMENT_SCHEMA', `${path}.copyrightStatus`, 'M1 虚构种子只能使用 demo 版权状态。');
}

function validateEnums(collection: SeedCollectionName, document: JsonObject, path: string, issues: SeedValidationIssue[]): void {
  const enums: Partial<Record<SeedCollectionName, Readonly<Record<string, readonly string[]>>>> = {
    organizations: { status: ['active', 'disabled'] },
    classes: { status: ['active', 'archived'] },
    users: { status: ['active', 'disabled'] },
    auth_identities: { provider: ['cloudbase_uid'], status: ['active', 'revoked'] },
    role_assignments: { role: ['student', 'parent', 'teacher', 'admin'], status: ['active', 'revoked'], scopeType: ['self', 'classes', 'organization'] },
    class_memberships: { status: ['active', 'transferred', 'inactive'] },
    teacher_class_grants: { status: ['active', 'revoked'] },
    parent_student_links: { status: ['active', 'revoked'] },
    learning_resources: { type: ['reading', 'vocabulary', 'exercise'], status: ['draft', 'published', 'offline'], copyrightStatus: ['demo'] },
    tasks: { deliveryType: ['classroom'], status: ['draft', 'scheduled', 'active', 'expired', 'withdrawn', 'closed', 'completed'], targetType: ['classes', 'students'], visibility: ['visible', 'recycled'] },
    task_assignments: { status: ['not_started', 'in_progress', 'awaiting_review', 'completed', 'redo_required', 'overdue'] },
    submissions: { status: ['draft', 'submitted', 'reviewed', 'returned', 'superseded'] },
    review_feedback: { decision: ['approved', 'returned'], source: ['manual'] },
  };
  for (const [field, allowed] of Object.entries(enums[collection] ?? {})) {
    if (typeof document[field] === 'string' && !allowed.includes(document[field] as string)) add(issues, 'DOCUMENT_SCHEMA', `${path}.${field}`, `不支持的值：${String(document[field])}。`);
  }
}

function validateArrays(collection: SeedCollectionName, document: JsonObject, path: string, issues: SeedValidationIssue[]): void {
  const fields: Partial<Record<SeedCollectionName, readonly string[]>> = {
    role_assignments: ['permissions', 'scopeIds'],
    teacher_class_grants: ['permissions'],
    tasks: ['targetClassIds', 'targetStudentIds', 'items'],
    submissions: ['answers'],
  };
  for (const field of fields[collection] ?? []) if (!Array.isArray(document[field])) add(issues, 'DOCUMENT_SCHEMA', `${path}.${field}`, '必须是数组。');
  if (collection === 'role_assignments') {
    validateEnumArray(document.permissions, SEED_ROLE_PERMISSIONS, `${path}.permissions`, issues);
    validateNonEmptyStringArray(document.scopeIds, `${path}.scopeIds`, issues);
  }
  if (collection === 'teacher_class_grants') {
    validateEnumArray(document.permissions, TEACHER_CLASS_PERMISSIONS, `${path}.permissions`, issues);
  }
  if (collection === 'tasks' && Array.isArray(document.items) && document.items.length === 0) add(issues, 'DOCUMENT_SCHEMA', `${path}.items`, '任务至少包含一个快照项。');
}

function validateEnumArray(
  value: JsonValue | undefined,
  allowed: readonly string[],
  path: string,
  issues: SeedValidationIssue[],
): void {
  if (!Array.isArray(value)) return;
  if (value.length === 0) add(issues, 'DOCUMENT_SCHEMA', path, '至少包含一项权限。');
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !allowed.includes(item)) {
      add(issues, 'DOCUMENT_SCHEMA', `${path}[${index}]`, '包含后端不支持的权限。');
    }
  });
  if (new Set(value).size !== value.length) add(issues, 'DOCUMENT_SCHEMA', path, '权限不得重复。');
}

function validateNonEmptyStringArray(
  value: JsonValue | undefined,
  path: string,
  issues: SeedValidationIssue[],
): void {
  if (!Array.isArray(value)) return;
  if (value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    add(issues, 'DOCUMENT_SCHEMA', path, '必须至少包含一个非空标识。');
  }
}

function validateReferences(seed: SeedPackage, index: DocumentIndex, issues: SeedValidationIssue[]): void {
  forEach(seed, 'auth_identities', (doc, path) => ref(doc, path, 'userId', 'users', index, issues));
  forEach(seed, 'role_assignments', (doc, path) => {
    ref(doc, path, 'userId', 'users', index, issues);
    const scopeType = doc.scopeType;
    if (scopeType === 'self') refs(doc, path, 'scopeIds', 'users', index, issues);
    if (scopeType === 'classes') refs(doc, path, 'scopeIds', 'classes', index, issues);
    if (scopeType === 'organization') refs(doc, path, 'scopeIds', 'organizations', index, issues);
  });
  forEach(seed, 'class_memberships', (doc, path) => {
    ref(doc, path, 'classId', 'classes', index, issues);
    ref(doc, path, 'studentId', 'users', index, issues, 'student');
  });
  forEach(seed, 'teacher_class_grants', (doc, path) => {
    ref(doc, path, 'teacherId', 'users', index, issues, 'teacher');
    ref(doc, path, 'classId', 'classes', index, issues);
  });
  forEach(seed, 'parent_student_links', (doc, path) => {
    ref(doc, path, 'parentId', 'users', index, issues, 'parent');
    ref(doc, path, 'studentId', 'users', index, issues, 'student');
  });
  forEach(seed, 'learning_resources', (doc, path) => {
    const visibility = doc.visibilityScope;
    if (isObject(visibility) && Array.isArray(visibility.classIds)) refs(visibility, `${path}.visibilityScope`, 'classIds', 'classes', index, issues, undefined, doc.organizationId);
    if (Array.isArray(doc.allowedStudentIds)) refs(doc, path, 'allowedStudentIds', 'users', index, issues, 'student');
  });
  forEach(seed, 'tasks', (doc, path) => {
    ref(doc, path, 'creatorTeacherId', 'users', index, issues, 'teacher');
    refs(doc, path, 'targetClassIds', 'classes', index, issues);
    refs(doc, path, 'targetStudentIds', 'users', index, issues, 'student');
    if (Array.isArray(doc.items)) doc.items.forEach((item, position) => {
      if (isObject(item)) ref(item, `${path}.items[${position}]`, 'resourceId', 'learning_resources', index, issues, undefined, doc.organizationId);
    });
  });
  forEach(seed, 'task_assignments', (doc, path) => {
    ref(doc, path, 'taskId', 'tasks', index, issues);
    ref(doc, path, 'studentId', 'users', index, issues, 'student');
    ref(doc, path, 'classId', 'classes', index, issues);
    optionalRef(doc, path, 'latestSubmissionId', 'submissions', index, issues);
  });
  forEach(seed, 'submissions', (doc, path) => {
    ref(doc, path, 'taskId', 'tasks', index, issues);
    ref(doc, path, 'assignmentId', 'task_assignments', index, issues);
    ref(doc, path, 'studentId', 'users', index, issues, 'student');
    optionalRef(doc, path, 'supersedesSubmissionId', 'submissions', index, issues);
  });
  forEach(seed, 'review_feedback', (doc, path) => {
    ref(doc, path, 'taskId', 'tasks', index, issues);
    ref(doc, path, 'assignmentId', 'task_assignments', index, issues);
    ref(doc, path, 'submissionId', 'submissions', index, issues);
    ref(doc, path, 'teacherId', 'users', index, issues, 'teacher');
  });
}

function validateAggregateConsistency(seed: SeedPackage, index: DocumentIndex, issues: SeedValidationIssue[]): void {
  forEach(seed, 'organizations', (doc, path) => {
    if (doc.organizationId !== doc._id) add(issues, 'ORGANIZATION_MISMATCH', `${path}.organizationId`, '组织文档的 organizationId 必须等于自身 _id。');
  });
  for (const collection of SEED_COLLECTION_ORDER) {
    if (collection === 'organizations') continue;
    seed.collections[collection].forEach((doc, position) => {
      if (typeof doc.organizationId === 'string' && !index.organizations.has(doc.organizationId)) add(issues, 'REFERENCE', `${collection}[${position}].organizationId`, '引用的组织不存在。');
    });
  }
  const assignmentKeys = new Set<string>();
  forEach(seed, 'task_assignments', (doc, path) => {
    const key = `${String(doc.taskId)}/${String(doc.studentId)}`;
    if (assignmentKeys.has(key)) add(issues, 'DOCUMENT_SCHEMA', path, '同一任务与学生只能有一个 assignment。');
    assignmentKeys.add(key);
    const latestId = doc.latestSubmissionId;
    if (typeof latestId === 'string') {
      const submission = index.submissions.get(latestId);
      if (submission && (submission.assignmentId !== doc._id || submission.version !== doc.latestSubmissionVersion)) add(issues, 'REFERENCE', `${path}.latestSubmissionId`, '必须指向本 assignment 声明版本的提交。');
    }
  });
  const submissionVersions = new Set<string>();
  forEach(seed, 'submissions', (doc, path) => {
    const key = `${String(doc.assignmentId)}/${String(doc.version)}`;
    if (submissionVersions.has(key)) add(issues, 'DOCUMENT_SCHEMA', path, '同一 assignment 的提交版本重复。');
    submissionVersions.add(key);
    const assignment = typeof doc.assignmentId === 'string' ? index.task_assignments.get(doc.assignmentId) : undefined;
    if (assignment && (assignment.taskId !== doc.taskId || assignment.studentId !== doc.studentId)) add(issues, 'REFERENCE', path, '提交与 assignment 的任务或学生不一致。');
  });
  const feedbackSubmissions = new Set<string>();
  forEach(seed, 'review_feedback', (doc, path) => {
    if (typeof doc.submissionId === 'string' && feedbackSubmissions.has(doc.submissionId)) add(issues, 'DOCUMENT_SCHEMA', path, '同一提交版本最多一条正式点评。');
    if (typeof doc.submissionId === 'string') feedbackSubmissions.add(doc.submissionId);
    const submission = typeof doc.submissionId === 'string' ? index.submissions.get(doc.submissionId) : undefined;
    if (submission && (submission.taskId !== doc.taskId || submission.assignmentId !== doc.assignmentId || submission.version !== doc.submissionVersion)) add(issues, 'REFERENCE', path, '点评与提交的任务、assignment 或版本不一致。');
  });
}

function ref(
  owner: JsonObject,
  ownerPath: string,
  field: string,
  targetCollection: SeedCollectionName,
  index: DocumentIndex,
  issues: SeedValidationIssue[],
  requiredRole?: string,
  ownerOrganizationId: JsonValue = owner.organizationId,
): void {
  const id = owner[field];
  if (typeof id !== 'string') return;
  const target = index[targetCollection].get(id);
  if (!target) {
    add(issues, 'REFERENCE', `${ownerPath}.${field}`, `必须引用 ${targetCollection} 中存在的对象。`);
    return;
  }
  if (target.organizationId !== ownerOrganizationId) add(issues, 'ORGANIZATION_MISMATCH', `${ownerPath}.${field}`, '引用对象必须属于同一组织。');
  if (requiredRole && !hasActiveRole(index.role_assignments, id, requiredRole)) add(issues, 'REFERENCE', `${ownerPath}.${field}`, `目标用户缺少 active ${requiredRole} 角色。`);
}

function refs(
  owner: JsonObject,
  ownerPath: string,
  field: string,
  targetCollection: SeedCollectionName,
  index: DocumentIndex,
  issues: SeedValidationIssue[],
  requiredRole?: string,
  ownerOrganizationId: JsonValue = owner.organizationId,
): void {
  const values = owner[field];
  if (!Array.isArray(values)) return;
  const seen = new Set<string>();
  values.forEach((value, position) => {
    if (typeof value !== 'string') {
      add(issues, 'DOCUMENT_SCHEMA', `${ownerPath}.${field}[${position}]`, '引用必须是字符串 ID。');
      return;
    }
    if (seen.has(value)) add(issues, 'DOCUMENT_SCHEMA', `${ownerPath}.${field}[${position}]`, '引用数组不能重复。');
    seen.add(value);
    ref({ ...owner, [field]: value }, ownerPath, field, targetCollection, index, issues, requiredRole, ownerOrganizationId);
  });
}

function optionalRef(owner: JsonObject, ownerPath: string, field: string, targetCollection: SeedCollectionName, index: DocumentIndex, issues: SeedValidationIssue[]): void {
  if (owner[field] === undefined || owner[field] === null) return;
  ref(owner, ownerPath, field, targetCollection, index, issues);
}

function hasActiveRole(roles: ReadonlyMap<string, JsonObject>, userId: string, role: string): boolean {
  return [...roles.values()].some((assignment) => assignment.userId === userId && assignment.role === role && assignment.status === 'active');
}

function scanSensitiveValue(value: JsonValue, path: string, issues: SeedValidationIssue[]): void {
  if (typeof value === 'string') {
    for (const [label, pattern] of SENSITIVE_VALUE_PATTERNS) if (pattern.test(value)) add(issues, 'SENSITIVE_VALUE', path, `检测到疑似${label}，虚构种子不得包含凭据或真实联系方式。`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => scanSensitiveValue(child, `${path}[${index}]`, issues));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part))) add(issues, 'SENSITIVE_FIELD', `${path}.${key}`, '敏感字段名不允许出现在虚构种子中。');
    scanSensitiveValue(child, `${path}.${key}`, issues);
  }
}

function validateTimeFields(document: JsonObject, path: string, issues: SeedValidationIssue[]): void {
  for (const [field, value] of Object.entries(document)) {
    if (!field.endsWith('At') || value === null || value === undefined) continue;
    if (typeof value !== 'string' || !isIsoWithZone(value)) add(issues, 'DOCUMENT_SCHEMA', `${path}.${field}`, '时间必须是带时区的 ISO 8601 字符串或 null。');
  }
}

function requireString(document: JsonObject, field: string, path: string, issues: SeedValidationIssue[]): void {
  if (typeof document[field] !== 'string' || document[field].length === 0) add(issues, 'DOCUMENT_SCHEMA', `${path}.${field}`, '必须是非空字符串。');
}

function requireInteger(document: JsonObject, field: string, path: string, issues: SeedValidationIssue[], minimum: number): void {
  const value = document[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) add(issues, 'DOCUMENT_SCHEMA', `${path}.${field}`, `必须是大于等于 ${minimum} 的整数。`);
}

function requireNumberRange(document: JsonObject, field: string, path: string, issues: SeedValidationIssue[], minimum: number, maximum: number): void {
  const value = document[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) add(issues, 'DOCUMENT_SCHEMA', `${path}.${field}`, `必须在 ${minimum} 到 ${maximum} 之间。`);
}

function forEach(seed: SeedPackage, collection: SeedCollectionName, visit: (document: JsonObject, path: string) => void): void {
  seed.collections[collection].forEach((document, position) => visit(document, `${collection}[${position}]`));
}

function add(issues: SeedValidationIssue[], code: SeedValidationIssue['code'], path: string, message: string): void {
  issues.push({ code, path, message });
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoWithZone(value: string): boolean {
  return ISO_WITH_ZONE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}
