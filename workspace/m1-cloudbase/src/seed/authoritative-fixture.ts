import type { JsonObject, JsonValue } from '../shared/protocol';
import { prepareSeedPackage } from './canonical-json';
import { SEED_COLLECTION_ORDER, type SeedCollections, type SeedPackage } from './model';

const ORGANIZATION_ID = 'org_qihang_demo';
const GRADE_THREE_CLASS_ID = 'cls_grade3_2';
const GRADE_FOUR_CLASS_ID = 'cls_grade4_1';
const TEACHER_ID = 'usr_teacher_demo_01';
const PARENT_ID = 'usr_parent_demo_01';
const ADMIN_ID = 'usr_admin_demo_01';
const RESOURCE_ID = 'res_reading_zoo_demo';
const TASK_ID = 'tsk_animals_classroom_demo';
const SEED_RUN_ID = 'seed_m1_authoritative_v4';
const GENERATED_AT = '2026-09-17T08:00:00+08:00';
const JOINED_AT = '2026-09-01T08:00:00+08:00';

const GRADE_THREE_STUDENT_COUNT = 36;
const GRADE_FOUR_STUDENT_COUNT = 32;
const SUBMITTED_COUNT = 27;
const AWAITING_REVIEW_COUNT = 6;
const REVIEWED_COUNT = SUBMITTED_COUNT - AWAITING_REVIEW_COUNT;

interface FixtureUser {
  readonly id: string;
  readonly displayName: string;
  readonly role: 'student' | 'parent' | 'teacher' | 'admin';
  readonly scopeType: 'self' | 'classes' | 'organization';
  readonly scopeIds: readonly string[];
  readonly permissions: readonly string[];
}

export interface AuthoritativeM1SeedSummary {
  readonly schoolName: string;
  readonly classes: Readonly<{
    gradeThreeClass: Readonly<{ name: string; studentCount: number }>;
    gradeFourClass: Readonly<{ name: string; studentCount: number }>;
  }>;
  readonly classroomTask: Readonly<{
    title: string;
    assigned: number;
    submitted: number;
    unsubmitted: number;
    awaitingReview: number;
    reviewed: number;
  }>;
  readonly totalDocuments: number;
}

/**
 * Generates the complete M1 authoritative fictional fixture in memory.
 * All identifiers, times and ordering are fixed so the canonical hash is stable.
 */
export function createAuthoritativeM1SeedPackage(): SeedPackage {
  const gradeThreeStudents = createStudents('g3', 3, GRADE_THREE_STUDENT_COUNT);
  const gradeFourStudents = createStudents('g4', 4, GRADE_FOUR_STUDENT_COUNT);
  const students = [...gradeThreeStudents, ...gradeFourStudents];
  const users: readonly FixtureUser[] = [
    ...students,
    {
      id: TEACHER_ID,
      displayName: '测试教师01',
      role: 'teacher',
      scopeType: 'classes',
      scopeIds: [GRADE_THREE_CLASS_ID, GRADE_FOUR_CLASS_ID],
      permissions: ['task.read', 'task.publish', 'submission.review', 'student.manage', 'content.read'],
    },
    {
      id: PARENT_ID,
      displayName: '测试家长01',
      role: 'parent',
      scopeType: 'self',
      scopeIds: [PARENT_ID],
      permissions: ['child.read'],
    },
    {
      id: ADMIN_ID,
      displayName: '测试管理员01',
      role: 'admin',
      scopeType: 'organization',
      scopeIds: [ORGANIZATION_ID],
      permissions: [
        'organization.read', 'organization.manage', 'class.read', 'class.manage',
        'user.read', 'user.manage', 'authorization.manage', 'audit.read',
        'student.bind-code.issue',
      ],
    },
  ];
  const taskStudentIds = gradeThreeStudents.map((student) => student.id);

  const collections: SeedCollections = {
    organizations: [{
      _id: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      name: '启航实验学校',
      status: 'active',
      timeZone: 'Asia/Shanghai',
      ...commonDocument(),
    }],
    classes: [
      classDocument(GRADE_THREE_CLASS_ID, '三年级 2 班', 3),
      classDocument(GRADE_FOUR_CLASS_ID, '四年级 1 班', 4),
    ],
    users: users.map((user) => ({
      _id: user.id,
      organizationId: ORGANIZATION_ID,
      displayName: user.displayName,
      displayNameMasked: user.displayName,
      status: 'active',
      profileVersion: 1,
      authorizationVersion: 1,
      ...commonDocument(),
    })),
    auth_identities: users.map((user) => ({
      _id: `aid_${user.id.slice(4)}`,
      organizationId: ORGANIZATION_ID,
      userId: user.id,
      provider: 'cloudbase_uid',
      providerSubjectDigest: `fixture_digest_${user.id.slice(4)}`,
      status: 'active',
      verifiedAt: GENERATED_AT,
      lastUsedAt: null,
      ...commonDocument(),
    })),
    role_assignments: users.map((user) => ({
      _id: `rol_${user.id.slice(4)}`,
      organizationId: ORGANIZATION_ID,
      userId: user.id,
      role: user.role,
      status: 'active',
      permissions: user.permissions,
      scopeType: user.scopeType,
      scopeIds: user.scopeIds,
      grantedBy: 'sys_seed',
      grantedAt: GENERATED_AT,
      revokedAt: null,
      ...commonDocument(),
    })),
    class_memberships: [
      ...gradeThreeStudents.map((student) => membershipDocument(student.id, GRADE_THREE_CLASS_ID)),
      ...gradeFourStudents.map((student) => membershipDocument(student.id, GRADE_FOUR_CLASS_ID)),
    ],
    teacher_class_grants: [
      teacherGrantDocument(GRADE_THREE_CLASS_ID),
      teacherGrantDocument(GRADE_FOUR_CLASS_ID),
    ],
    parent_student_links: [{
      _id: 'rel_parent_demo_01_student_g3_01',
      organizationId: ORGANIZATION_ID,
      parentId: PARENT_ID,
      studentId: gradeThreeStudents[0]!.id,
      status: 'active',
      confirmedBy: ADMIN_ID,
      confirmedAt: JOINED_AT,
      revokedAt: null,
      ...commonDocument(),
    }],
    learning_resources: [{
      _id: RESOURCE_ID,
      organizationId: ORGANIZATION_ID,
      type: 'reading',
      title: 'A Day at the Zoo',
      contentVersion: 1,
      status: 'published',
      visibilityScope: { classIds: [GRADE_THREE_CLASS_ID, GRADE_FOUR_CLASS_ID] },
      allowedStudentIds: students.map((student) => student.id),
      payload: {
        demoOnly: true,
        chapterCount: 3,
        pages: [{
          id: 'page_zoo_demo_01',
          chapterId: 'chapter_zoo_demo_01',
          pageNumber: 1,
          thumbnailAssetKey: 'demo/reading/zoo/page-01-thumbnail',
          imageAssetKey: 'demo/reading/zoo/page-01-image',
          width: 1200,
          height: 1600,
          version: 1,
        }],
      },
      copyrightStatus: 'demo',
      ...commonDocument(),
    }],
    tasks: [{
      _id: TASK_ID,
      organizationId: ORGANIZATION_ID,
      creatorTeacherId: TEACHER_ID,
      title: '动物主题听说练习',
      deliveryType: 'classroom',
      status: 'active',
      targetType: 'classes',
      targetClassIds: [GRADE_THREE_CLASS_ID],
      targetStudentIds: taskStudentIds,
      startsAt: GENERATED_AT,
      dueAt: '2026-09-17T20:00:00+08:00',
      latePolicy: { allowed: true, days: 7 },
      description: '完成虚构阅读占位内容后提交。',
      teacherNote: null,
      items: [{
        id: 'tki_reading_demo',
        type: 'reading',
        resourceId: RESOURCE_ID,
        resourceVersion: 1,
        resourceSnapshot: {
          title: 'A Day at the Zoo',
          chapterCount: 3,
          demoOnly: true,
        },
        completionRule: { kind: 'submit_required_content' },
        scoringRule: { kind: 'completion_only' },
        order: 1,
        snapshotSchemaVersion: 1,
      }],
      publishedAt: GENERATED_AT,
      visibility: 'visible',
      deletedAt: null,
      ...commonDocument(),
    }],
    task_assignments: gradeThreeStudents.map((student, index) => assignmentDocument(student.id, index)),
    submissions: gradeThreeStudents.slice(0, SUBMITTED_COUNT).map((student, index) => submissionDocument(student.id, index)),
    review_feedback: gradeThreeStudents.slice(0, REVIEWED_COUNT).map((_student, index) => feedbackDocument(index)),
  };

  const expectedCounts = Object.fromEntries(
    SEED_COLLECTION_ORDER.map((collection) => [collection, collections[collection].length]),
  );
  return prepareSeedPackage({
    manifest: {
      seedVersion: 'm1-authoritative-v4',
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

export function summarizeAuthoritativeM1Seed(seed: SeedPackage): AuthoritativeM1SeedSummary {
  const task = seed.collections.tasks.find((document) => document._id === TASK_ID);
  if (!task) throw new Error('权威种子缺少课堂任务。');
  const assignments = seed.collections.task_assignments.filter((document) => document.taskId === TASK_ID);
  const submissions = seed.collections.submissions.filter((document) => document.taskId === TASK_ID);
  const feedbackSubmissionIds = new Set(
    seed.collections.review_feedback
      .filter((document) => document.taskId === TASK_ID)
      .map((document) => String(document.submissionId)),
  );
  const classStudentCount = (classId: string): number => seed.collections.class_memberships.filter(
    (document) => document.classId === classId && document.status === 'active',
  ).length;

  return {
    schoolName: String(seed.collections.organizations[0]?.name ?? ''),
    classes: {
      gradeThreeClass: { name: '三年级 2 班', studentCount: classStudentCount(GRADE_THREE_CLASS_ID) },
      gradeFourClass: { name: '四年级 1 班', studentCount: classStudentCount(GRADE_FOUR_CLASS_ID) },
    },
    classroomTask: {
      title: String(task.title),
      assigned: assignments.length,
      submitted: submissions.length,
      unsubmitted: assignments.length - submissions.length,
      awaitingReview: submissions.filter((document) => !feedbackSubmissionIds.has(String(document._id))).length,
      reviewed: feedbackSubmissionIds.size,
    },
    totalDocuments: SEED_COLLECTION_ORDER.reduce(
      (total, collection) => total + seed.collections[collection].length,
      0,
    ),
  };
}

function createStudents(prefix: 'g3' | 'g4', grade: 3 | 4, count: number): readonly FixtureUser[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = pad(index + 1);
    const id = `usr_student_${prefix}_${sequence}`;
    return {
      id,
      displayName: `${grade === 3 ? '三' : '四'}年级测试学生${sequence}`,
      role: 'student',
      scopeType: 'self',
      scopeIds: [id],
      permissions: ['task.read.self', 'submission.write.self', 'learning.read.self'],
    };
  });
}

function classDocument(id: string, name: string, grade: number): JsonObject {
  return {
    _id: id,
    organizationId: ORGANIZATION_ID,
    name,
    grade,
    term: '2026-autumn-demo',
    status: 'active',
    ...commonDocument(),
  };
}

function membershipDocument(studentId: string, classId: string): JsonObject {
  return {
    _id: `mem_${classId.slice(4)}_${studentId.slice(12)}`,
    organizationId: ORGANIZATION_ID,
    classId,
    studentId,
    status: 'active',
    joinedAt: JOINED_AT,
    leftAt: null,
    ...commonDocument(),
  };
}

function teacherGrantDocument(classId: string): JsonObject {
  return {
    _id: `grt_teacher_demo_01_${classId.slice(4)}`,
    organizationId: ORGANIZATION_ID,
    teacherId: TEACHER_ID,
    classId,
    permissions: ['task.read', 'task.publish', 'submission.review', 'student.manage', 'content.read'],
    status: 'active',
    grantedBy: ADMIN_ID,
    grantedAt: JOINED_AT,
    revokedAt: null,
    ...commonDocument(),
  };
}

function assignmentDocument(studentId: string, index: number): JsonObject {
  const sequence = pad(index + 1);
  const submitted = index < SUBMITTED_COUNT;
  const reviewed = index < REVIEWED_COUNT;
  return {
    _id: `asn_animals_g3_${sequence}`,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    studentId,
    classId: GRADE_THREE_CLASS_ID,
    status: reviewed ? 'completed' : submitted ? 'awaiting_review' : 'not_started',
    progressPercent: submitted ? 100 : 0,
    latestSubmissionId: submitted ? `sub_animals_g3_${sequence}_v1` : null,
    latestSubmissionVersion: submitted ? 1 : 0,
    redoCount: 0,
    redoDueAt: null,
    isLate: false,
    submittedAt: submitted ? submissionTime(index) : null,
    reviewedAt: reviewed ? feedbackTime(index) : null,
    ...commonDocument(submitted ? 2 : 1),
  };
}

function submissionDocument(studentId: string, index: number): JsonObject {
  const sequence = pad(index + 1);
  const reviewed = index < REVIEWED_COUNT;
  return {
    _id: `sub_animals_g3_${sequence}_v1`,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    assignmentId: `asn_animals_g3_${sequence}`,
    studentId,
    ...commonDocument(),
    version: 1,
    recordVersion: 1,
    status: reviewed ? 'reviewed' : 'submitted',
    answers: [{ taskItemId: 'tki_reading_demo', value: `虚构测试作答${sequence}` }],
    isLate: false,
    submittedAt: submissionTime(index),
    supersedesSubmissionId: null,
  };
}

function feedbackDocument(index: number): JsonObject {
  const sequence = pad(index + 1);
  return {
    _id: `fbk_animals_g3_${sequence}_v1`,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    assignmentId: `asn_animals_g3_${sequence}`,
    submissionId: `sub_animals_g3_${sequence}_v1`,
    submissionVersion: 1,
    teacherId: TEACHER_ID,
    decision: 'approved',
    score: 80 + (index % 11),
    textComment: `虚构人工点评${sequence}`,
    returnReason: null,
    publishedAt: feedbackTime(index),
    source: 'manual',
    ...commonDocument(),
  };
}

function commonDocument(version = 1): Readonly<Record<string, JsonValue>> {
  return {
    schemaVersion: 1,
    version,
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

function submissionTime(index: number): string {
  return `2026-09-17T09:${pad(index + 1)}:00+08:00`;
}

function feedbackTime(index: number): string {
  return `2026-09-17T10:${pad(index + 1)}:00+08:00`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
