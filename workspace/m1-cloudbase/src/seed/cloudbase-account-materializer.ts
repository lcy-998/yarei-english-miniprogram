import { NodePepperedSubjectDigest } from '../runtime/node-crypto-capabilities';
import type { SeedPackage } from './model';
import { createCrossOrganizationSecuritySeedPackage } from './cross-organization-security-fixture';
import {
  createPrimaryCloudIntegrationSeedPackage,
  PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS,
} from './primary-cloud-integration-fixture';
import {
  materializeRuntimeIdentityDigests,
  type RuntimeIdentityDigestBinding,
} from './runtime-identity-materialization';

export type CloudBaseAccountType = 'externalUser' | 'internalUser';

export interface CloudBaseAccountMetadata {
  readonly name: string;
  readonly uid: string;
  readonly type: CloudBaseAccountType;
  readonly status: 'ACTIVE' | 'BLOCKED';
}

export type CloudRuntimeSeedMaterializationIssueCode =
  | 'ACCOUNT_SET_INVALID'
  | 'ACCOUNT_MISSING'
  | 'ACCOUNT_DUPLICATE'
  | 'ACCOUNT_UID_DUPLICATE'
  | 'ACCOUNT_STATE_INVALID'
  | 'CRYPTOGRAPHY_UNAVAILABLE'
  | 'PRIMARY_PACKAGE_INVALID'
  | 'SECONDARY_PACKAGE_INVALID';

export interface CloudRuntimeSeedMaterializationIssue {
  readonly code: CloudRuntimeSeedMaterializationIssueCode;
  /** Known synthetic alias only; never a UID, digest, environment id or secret. */
  readonly accountName?: string;
  readonly message: string;
}

export type CloudRuntimeSeedMaterializationResult =
  | Readonly<{
    ok: true;
    primarySeed: SeedPackage;
    secondarySeed: SeedPackage;
    accountNames: readonly string[];
  }>
  | Readonly<{ ok: false; issues: readonly CloudRuntimeSeedMaterializationIssue[] }>;

interface ExpectedAccount {
  readonly name: string;
  readonly userId: string;
  readonly packageName: 'primary' | 'secondary';
  readonly type: CloudBaseAccountType;
}

const EXPECTED_ACCOUNTS: readonly ExpectedAccount[] = [
  { name: 'demo_student_01', userId: PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS[0], packageName: 'primary', type: 'externalUser' },
  { name: 'demo_parent_01', userId: PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS[1], packageName: 'primary', type: 'externalUser' },
  { name: 'demo_teacher_01', userId: PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS[2], packageName: 'primary', type: 'externalUser' },
  { name: 'demo_admin_01', userId: PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS[3], packageName: 'primary', type: 'internalUser' },
  { name: 'isolation_student_01', userId: 'usr_isolation_student', packageName: 'secondary', type: 'externalUser' },
  { name: 'isolation_parent_01', userId: 'usr_isolation_parent', packageName: 'secondary', type: 'externalUser' },
  { name: 'isolation_teacher_01', userId: 'usr_isolation_teacher', packageName: 'secondary', type: 'externalUser' },
  { name: 'isolation_admin_01', userId: 'usr_isolation_admin', packageName: 'secondary', type: 'internalUser' },
] as const;

export const CLOUD_INTEGRATION_ACCOUNT_NAMES = EXPECTED_ACCOUNTS.map(({ name }) => name);

/**
 * Converts exact synthetic CloudBase account metadata into the two runtime seed
 * packages. Raw UIDs are only used in-memory as HMAC input and are never returned.
 */
export function materializeCloudRuntimeSeedPackages(
  accountsInput: unknown,
  subjectPepper: string,
): CloudRuntimeSeedMaterializationResult {
  if (!Array.isArray(accountsInput)) {
    return failure([{ code: 'ACCOUNT_SET_INVALID', message: '账号元数据必须是数组。' }]);
  }
  const accounts = accountsInput.filter(isAccountMetadata);
  if (accounts.length !== accountsInput.length || accounts.length !== EXPECTED_ACCOUNTS.length) {
    return failure([{ code: 'ACCOUNT_SET_INVALID', message: '账号集合必须精确包含八个虚构联调账号。' }]);
  }

  const issues: CloudRuntimeSeedMaterializationIssue[] = [];
  const accountsByName = new Map<string, CloudBaseAccountMetadata[]>();
  for (const account of accounts) {
    const existing = accountsByName.get(account.name) ?? [];
    accountsByName.set(account.name, [...existing, account]);
  }
  const uidCount = new Map<string, number>();
  for (const account of accounts) uidCount.set(account.uid, (uidCount.get(account.uid) ?? 0) + 1);

  for (const expected of EXPECTED_ACCOUNTS) {
    const matches = accountsByName.get(expected.name) ?? [];
    if (matches.length === 0) {
      issues.push({ code: 'ACCOUNT_MISSING', accountName: expected.name, message: '缺少虚构联调账号。' });
      continue;
    }
    if (matches.length !== 1) {
      issues.push({ code: 'ACCOUNT_DUPLICATE', accountName: expected.name, message: '虚构联调账号必须唯一。' });
      continue;
    }
    const account = matches[0]!;
    if (uidCount.get(account.uid) !== 1) {
      issues.push({ code: 'ACCOUNT_UID_DUPLICATE', accountName: expected.name, message: '平台账号标识必须一一对应。' });
    }
    if (account.status !== 'ACTIVE' || account.type !== expected.type) {
      issues.push({ code: 'ACCOUNT_STATE_INVALID', accountName: expected.name, message: '账号类型或启用状态不符合联调约定。' });
    }
  }
  if (issues.length > 0) return failure(issues);

  let digest: NodePepperedSubjectDigest;
  try {
    digest = new NodePepperedSubjectDigest(subjectPepper);
  } catch {
    return failure([{ code: 'CRYPTOGRAPHY_UNAVAILABLE', message: '运行态身份摘要能力不可用。' }]);
  }

  const primaryBindings: RuntimeIdentityDigestBinding[] = [];
  const secondaryBindings: RuntimeIdentityDigestBinding[] = [];
  for (const expected of EXPECTED_ACCOUNTS) {
    const account = accountsByName.get(expected.name)![0]!;
    let providerSubjectDigest: string;
    try {
      providerSubjectDigest = digest.digest(`cloudbase:username:${account.uid}`);
    } catch {
      return failure([{ code: 'CRYPTOGRAPHY_UNAVAILABLE', accountName: expected.name, message: '运行态身份摘要生成失败。' }]);
    }
    const binding = { userId: expected.userId, providerSubjectDigest };
    (expected.packageName === 'primary' ? primaryBindings : secondaryBindings).push(binding);
  }

  const primary = materializeRuntimeIdentityDigests(createPrimaryCloudIntegrationSeedPackage(), primaryBindings);
  if (!primary.ok) {
    return failure([{ code: 'PRIMARY_PACKAGE_INVALID', message: '主组织运行态种子包未通过严格校验。' }]);
  }
  const secondary = materializeRuntimeIdentityDigests(createCrossOrganizationSecuritySeedPackage(), secondaryBindings);
  if (!secondary.ok) {
    return failure([{ code: 'SECONDARY_PACKAGE_INVALID', message: '隔离组织运行态种子包未通过严格校验。' }]);
  }
  return {
    ok: true,
    primarySeed: primary.seed,
    secondarySeed: secondary.seed,
    accountNames: EXPECTED_ACCOUNTS.map(({ name }) => name),
  };
}

function isAccountMetadata(value: unknown): value is CloudBaseAccountMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  return keys.length === 4
    && keys.join(',') === 'name,status,type,uid'
    && typeof candidate.name === 'string'
    && typeof candidate.uid === 'string'
    && candidate.uid.trim().length > 0
    && candidate.uid.length <= 512
    && (candidate.type === 'externalUser' || candidate.type === 'internalUser')
    && (candidate.status === 'ACTIVE' || candidate.status === 'BLOCKED');
}

function failure(issues: readonly CloudRuntimeSeedMaterializationIssue[]): Readonly<{
  ok: false;
  issues: readonly CloudRuntimeSeedMaterializationIssue[];
}> {
  return { ok: false, issues };
}
