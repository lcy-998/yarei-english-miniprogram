import type { JsonObject, JsonValue } from '../shared/protocol';
import { prepareSeedPackage } from './canonical-json';
import { SEED_COLLECTION_ORDER, type SeedCollections, type SeedPackage } from './model';

const SEED_RUN_ID = 'seed_m1_cross_org_security_v2';
const ORGANIZATION_ID = 'org_isolation_secondary';
const CLASS_ID = 'cls_isolation_secondary';
const STUDENT_ID = 'usr_isolation_student';
const PARENT_ID = 'usr_isolation_parent';
const TEACHER_ID = 'usr_isolation_teacher';
const ADMIN_ID = 'usr_isolation_admin';
const GENERATED_AT = '2026-09-17T15:00:00+08:00';

/**
 * Minimal second-tenant fixture for authenticated cross-organization denial tests.
 * It is intentionally independent from the 373-document authoritative demo seed.
 */
export function createCrossOrganizationSecuritySeedPackage(): SeedPackage {
  const users = [
    user(STUDENT_ID, '跨组织测试学生', '跨组*'),
    user(PARENT_ID, '跨组织测试家长', '跨组*'),
    user(TEACHER_ID, '跨组织测试教师', '跨组*'),
    user(ADMIN_ID, '跨组织测试管理员', '跨组*'),
  ];
  const collections: SeedCollections = {
    organizations: [{
      _id: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      name: '跨组织安全测试学校',
      status: 'active',
      timeZone: 'Asia/Shanghai',
      ...common(),
    }],
    classes: [{
      _id: CLASS_ID,
      organizationId: ORGANIZATION_ID,
      name: '跨组织安全测试班',
      grade: 3,
      term: '2026-autumn-security',
      status: 'active',
      ...common(),
    }],
    users,
    auth_identities: [STUDENT_ID, PARENT_ID, TEACHER_ID, ADMIN_ID].map((userId) => ({
      _id: `aid_${userId.slice(4)}`,
      organizationId: ORGANIZATION_ID,
      userId,
      provider: 'cloudbase_uid',
      providerSubjectDigest: `fixture_digest_${userId.slice(4)}`,
      status: 'active',
      verifiedAt: GENERATED_AT,
      lastUsedAt: null,
      ...common(),
    })),
    role_assignments: [
      role('student', STUDENT_ID, ['task.read.self'], 'self', [STUDENT_ID]),
      role('parent', PARENT_ID, ['child.read'], 'self', [PARENT_ID]),
      role('teacher', TEACHER_ID, ['class.read', 'student.read'], 'classes', [CLASS_ID]),
      role('admin', ADMIN_ID, [
        'organization.read', 'organization.manage', 'class.read', 'class.manage',
        'user.read', 'user.manage', 'authorization.manage', 'audit.read',
        'student.bind-code.issue',
      ], 'organization', [ORGANIZATION_ID]),
    ],
    class_memberships: [{
      _id: 'mem_isolation_secondary_student',
      organizationId: ORGANIZATION_ID,
      classId: CLASS_ID,
      studentId: STUDENT_ID,
      status: 'active',
      joinedAt: GENERATED_AT,
      leftAt: null,
      ...common(),
    }],
    teacher_class_grants: [{
      _id: 'grt_isolation_secondary_teacher',
      organizationId: ORGANIZATION_ID,
      teacherId: TEACHER_ID,
      classId: CLASS_ID,
      permissions: ['class.read', 'student.read'],
      status: 'active',
      grantedBy: ADMIN_ID,
      grantedAt: GENERATED_AT,
      revokedAt: null,
      ...common(),
    }],
    parent_student_links: [{
      _id: 'rel_isolation_secondary_parent_student',
      organizationId: ORGANIZATION_ID,
      parentId: PARENT_ID,
      studentId: STUDENT_ID,
      status: 'active',
      confirmedBy: ADMIN_ID,
      confirmedAt: GENERATED_AT,
      revokedAt: null,
      ...common(),
    }],
    learning_resources: [],
    tasks: [],
    task_assignments: [],
    submissions: [],
    review_feedback: [],
  };
  const expectedCounts = Object.fromEntries(
    SEED_COLLECTION_ORDER.map((collection) => [collection, collections[collection].length]),
  );
  return prepareSeedPackage({
    manifest: {
      seedVersion: 'm1-cross-org-security-v2',
      schemaVersion: 1,
      source: 'm0-fixture',
      generatedAt: GENERATED_AT,
      contentHash: 'RECOMPUTE_BEFORE_IMPORT',
      seedRunId: SEED_RUN_ID,
      expectedCounts,
    },
    collections,
  });
}

function user(id: string, displayName: string, displayNameMasked: string): JsonObject {
  return {
    _id: id,
    organizationId: ORGANIZATION_ID,
    displayName,
    displayNameMasked,
    status: 'active',
    authorizationVersion: 1,
    ...common(),
  };
}

function role(
  roleName: 'student' | 'parent' | 'teacher' | 'admin',
  userId: string,
  permissions: readonly string[],
  scopeType: 'self' | 'classes' | 'organization',
  scopeIds: readonly string[],
): JsonObject {
  return {
    _id: `rol_${userId.slice(4)}`,
    organizationId: ORGANIZATION_ID,
    userId,
    role: roleName,
    status: 'active',
    permissions,
    scopeType,
    scopeIds,
    grantedBy: 'sys_seed',
    grantedAt: GENERATED_AT,
    revokedAt: null,
    ...common(),
  };
}

function common(): Readonly<Record<string, JsonValue>> {
  return {
    schemaVersion: 1,
    version: 1,
    seedRunId: SEED_RUN_ID,
    createdAt: GENERATED_AT,
    updatedAt: GENERATED_AT,
    createdBy: 'sys_seed',
    updatedBy: 'sys_seed',
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
  };
}
