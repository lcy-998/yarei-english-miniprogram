import type { JsonObject } from '../shared/protocol';
import { prepareSeedPackage } from './canonical-json';
import type { SeedPackage } from './model';
import { validateSeedPackage } from './validator';

const RUNTIME_DIGEST_PATTERN = /^sd1_[A-Za-z0-9_-]{43}$/;
const BINDING_KEYS = ['providerSubjectDigest', 'userId'] as const;

export interface RuntimeIdentityDigestBinding {
  readonly userId: string;
  readonly providerSubjectDigest: string;
}

export type RuntimeIdentityMaterializationIssueCode =
  | 'INVALID_FIXTURE_PACKAGE'
  | 'INVALID_BINDINGS'
  | 'DUPLICATE_USER_ID'
  | 'DUPLICATE_DIGEST'
  | 'MISSING_USER_ID'
  | 'EXTRA_USER_ID'
  | 'INVALID_RUNTIME_DIGEST'
  | 'INVALID_RUNTIME_PACKAGE';

export interface RuntimeIdentityMaterializationIssue {
  readonly code: RuntimeIdentityMaterializationIssueCode;
  readonly path: string;
  /** Deliberately never includes a supplied identifier or digest value. */
  readonly message: string;
}

export type RuntimeIdentityMaterializationResult =
  | Readonly<{ ok: true; seed: SeedPackage }>
  | Readonly<{ ok: false; issues: readonly RuntimeIdentityMaterializationIssue[] }>;

/**
 * Replaces fixture-only identity placeholders with already-computed server digests.
 * The boundary accepts no raw platform UID, contact field or password field.
 */
export function materializeRuntimeIdentityDigests(
  fixtureSeed: SeedPackage,
  bindingsInput: unknown,
): RuntimeIdentityMaterializationResult {
  const fixtureValidation = validateSeedPackage(fixtureSeed, { identityProfile: 'fixture' });
  if (!fixtureValidation.ok) {
    return failure([issue('INVALID_FIXTURE_PACKAGE', 'seed', '输入必须是通过 fixture 档位校验的权威种子包。')]);
  }

  const parsed = parseBindings(bindingsInput);
  if (!parsed.ok) return parsed;

  const issues: RuntimeIdentityMaterializationIssue[] = [];
  const fixtureUserIds = new Map<string, number>();
  const fixtureDigests = new Map<string, number>();
  fixtureSeed.collections.auth_identities.forEach((identity, index) => {
    const userId = String(identity.userId);
    const digest = String(identity.providerSubjectDigest);
    if (fixtureUserIds.has(userId)) {
      issues.push(issue('DUPLICATE_USER_ID', `seed.collections.auth_identities[${index}].userId`, '权威身份记录的 userId 不得重复。'));
    } else {
      fixtureUserIds.set(userId, index);
    }
    if (fixtureDigests.has(digest)) {
      issues.push(issue('DUPLICATE_DIGEST', `seed.collections.auth_identities[${index}].providerSubjectDigest`, '权威身份记录的摘要占位不得重复。'));
    } else {
      fixtureDigests.set(digest, index);
    }
  });

  const bindingsByUserId = new Map<string, RuntimeIdentityDigestBinding>();
  const runtimeDigests = new Map<string, number>();
  parsed.bindings.forEach((binding, index) => {
    if (bindingsByUserId.has(binding.userId)) {
      issues.push(issue('DUPLICATE_USER_ID', `bindings[${index}].userId`, '摘要绑定的 userId 不得重复。'));
    } else {
      bindingsByUserId.set(binding.userId, binding);
    }
    if (runtimeDigests.has(binding.providerSubjectDigest)) {
      issues.push(issue('DUPLICATE_DIGEST', `bindings[${index}].providerSubjectDigest`, '服务端摘要不得重复。'));
    } else {
      runtimeDigests.set(binding.providerSubjectDigest, index);
    }
    if (!fixtureUserIds.has(binding.userId)) {
      issues.push(issue('EXTRA_USER_ID', `bindings[${index}].userId`, '摘要绑定包含权威身份集合之外的 userId。'));
    }
  });
  fixtureSeed.collections.auth_identities.forEach((identity, index) => {
    if (!bindingsByUserId.has(String(identity.userId))) {
      issues.push(issue('MISSING_USER_ID', `seed.collections.auth_identities[${index}].userId`, '该权威身份记录缺少唯一的服务端摘要绑定。'));
    }
  });
  if (issues.length > 0) return failure(issues);

  const identities = fixtureSeed.collections.auth_identities.map((identity) => ({
    ...identity,
    providerSubjectDigest: bindingsByUserId.get(String(identity.userId))!.providerSubjectDigest,
  } satisfies JsonObject));
  const materialized = prepareSeedPackage({
    manifest: { ...fixtureSeed.manifest },
    collections: {
      ...fixtureSeed.collections,
      auth_identities: identities,
    },
  });
  const runtimeValidation = validateSeedPackage(materialized, { identityProfile: 'runtime' });
  if (!runtimeValidation.ok) {
    return failure([issue('INVALID_RUNTIME_PACKAGE', 'seed', '替换后的种子包未通过 runtime 档位校验。')]);
  }
  return { ok: true, seed: materialized };
}

type ParsedBindings =
  | Readonly<{ ok: true; bindings: readonly RuntimeIdentityDigestBinding[] }>
  | Readonly<{ ok: false; issues: readonly RuntimeIdentityMaterializationIssue[] }>;

function parseBindings(input: unknown): ParsedBindings {
  if (!Array.isArray(input)) {
    return failure([issue('INVALID_BINDINGS', 'bindings', '摘要绑定必须是数组。')]);
  }
  const issues: RuntimeIdentityMaterializationIssue[] = [];
  const bindings: RuntimeIdentityDigestBinding[] = [];
  input.forEach((value, index) => {
    const path = `bindings[${index}]`;
    if (!isRecord(value) || !hasExactKeys(value)) {
      issues.push(issue('INVALID_BINDINGS', path, '每项只能包含 userId 与 providerSubjectDigest。'));
      return;
    }
    if (typeof value.userId !== 'string' || value.userId.length === 0) {
      issues.push(issue('INVALID_BINDINGS', `${path}.userId`, 'userId 必须是非空字符串。'));
      return;
    }
    if (typeof value.providerSubjectDigest !== 'string' || !RUNTIME_DIGEST_PATTERN.test(value.providerSubjectDigest)) {
      issues.push(issue('INVALID_RUNTIME_DIGEST', `${path}.providerSubjectDigest`, '摘要必须是 sd1_ 前缀加 43 位 base64url。'));
      return;
    }
    bindings.push({ userId: value.userId, providerSubjectDigest: value.providerSubjectDigest });
  });
  return issues.length > 0 ? failure(issues) : { ok: true, bindings };
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === BINDING_KEYS.length && keys.every((key, index) => key === BINDING_KEYS[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  code: RuntimeIdentityMaterializationIssueCode,
  path: string,
  message: string,
): RuntimeIdentityMaterializationIssue {
  return { code, path, message };
}

function failure(issues: readonly RuntimeIdentityMaterializationIssue[]): Readonly<{
  ok: false;
  issues: readonly RuntimeIdentityMaterializationIssue[];
}> {
  return { ok: false, issues };
}
