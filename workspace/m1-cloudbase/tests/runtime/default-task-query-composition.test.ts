import { afterEach, describe, expect, it } from 'vitest';
import { createReviewQueryFunction } from '../../functions/review-query/function-entry';
import { createStudentTaskQueryFunction } from '../../functions/student-task-query/function-entry';
import {
  createDefaultCloudBaseTaskQueryFunction,
  installCloudBaseRuntimeProvider,
  type CloudBaseFunctionRuntimeCapabilities,
} from '../../functions/shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../../functions/shared/unconfigured-function';
import {
  REVIEW_QUERY_ACTIONS,
  STUDENT_TASK_QUERY_ACTIONS,
  validateReviewQueryRequest,
  validateStudentTaskQueryRequest,
} from '../../src/contracts/task-query-functions';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import type { TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import type { CursorCodec } from '../../src/task-query/types';
import {
  TASK_CORE_COLLECTIONS,
  assignmentByIdDocumentId,
  createDocument,
} from '../../src/repositories/task-core-document-adapter';
import { NativeDatabaseDouble } from '../support/native-database-double';

const ORGANIZATION_ID = 'org_demo';
const STUDENT_ID = 'usr_student';
const SUBJECT = 'cloudbase:username:uid_student';
const DIGEST = `digest:${SUBJECT}`;

afterEach(() => installCloudBaseRuntimeProvider(null));

describe('default persistent task-query composition', () => {
  it('creates the student query handler from documents and uses the injected stateless cursor codec', async () => {
    const sessions = await studentSessions();
    const database = new NativeDatabaseDouble(querySeed());
    const cursor = new RecordingStatelessCodec('cursor-signed');
    let providerCalls = 0;
    installCloudBaseRuntimeProvider((functionName) => {
      providerCalls += 1;
      expect(functionName).toBe('student-task-query');
      return capabilities(database, sessions, cursor);
    });
    const main = createStudentDefault();

    const first = await main({
      apiVersion: 'm1.v1',
      action: 'listMyTasks',
      payload: { filters: {}, page: { limit: 1 } },
      businessSessionToken: 'opaque.student.token',
    });
    expect(first).toMatchObject({
      ok: true,
      data: { total: 2, items: [{ taskId: 'task_a' }], nextCursor: expect.stringMatching(/^cursor-signed\./) },
    });
    if (!first.ok || first.data === null || typeof first.data !== 'object' || !('nextCursor' in first.data)) {
      throw new Error('first page expected');
    }
    const second = await main({
      apiVersion: 'm1.v1',
      action: 'listMyTasks',
      payload: { filters: {}, page: { limit: 1, cursor: first.data.nextCursor } },
      businessSessionToken: 'opaque.student.token',
    });
    expect(second).toMatchObject({ ok: true, data: { total: 2, items: [{ taskId: 'task_b' }], nextCursor: null } });
    expect(cursor.encodeCalls).toBe(1);
    expect(cursor.decodeCalls).toBe(1);
    expect(providerCalls).toBe(1);
  });

  it('fails closed when cursor signing or review-preview signing capability is missing', async () => {
    const sessions = await studentSessions();
    const database = new NativeDatabaseDouble(querySeed());
    const cursor = new RecordingStatelessCodec('cursor-signed');

    installCloudBaseRuntimeProvider(() => {
      const value = capabilities(database, sessions, cursor);
      const { queryCursorCodec: _queryCursorCodec, ...withoutCursor } = value;
      return withoutCursor;
    });
    await expect(createStudentDefault()({
      apiVersion: 'm1.v1', action: 'getHome', payload: { localDate: '2026-09-16' },
      businessSessionToken: 'opaque.student.token',
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });

    installCloudBaseRuntimeProvider(() => capabilities(database, sessions, cursor));
    await expect(createReviewDefault()({
      apiVersion: 'm1.v1', action: 'listReviewTasks', payload: { filters: {}, page: { limit: 10 } },
      businessSessionToken: 'opaque.student.token',
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});

function createStudentDefault() {
  const unavailable = createUnconfiguredFunction(
    'student-task-query',
    STUDENT_TASK_QUERY_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateStudentTaskQueryRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseTaskQueryFunction(
    'student-task-query',
    unavailable,
    (_capabilities, infrastructure) => createStudentTaskQueryFunction({
      ...infrastructure,
      handler: infrastructure.studentTaskHandler,
    }),
  );
}

function createReviewDefault() {
  const unavailable = createUnconfiguredFunction(
    'review-query',
    REVIEW_QUERY_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateReviewQueryRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseTaskQueryFunction(
    'review-query',
    unavailable,
    (_capabilities, infrastructure) => createReviewQueryFunction({
      ...infrastructure,
      handler: infrastructure.reviewHandler,
    }),
  );
}

function capabilities(
  database: NativeDatabaseDouble,
  sessions: InMemoryBusinessSessionRepository,
  queryCursorCodec: CursorCodec,
): CloudBaseFunctionRuntimeCapabilities {
  return {
    sdk: { getWXContext: () => ({ UID: 'uid_student' }), database: () => database },
    identities: new InMemoryIdentityRepository(identityFixture()),
    sessions,
    subjectDigest: { digest: (value) => `digest:${value}` },
    identifiers: { next: (prefix) => `${prefix}_demo` },
    businessSession: { getBusinessSessionId: (token) => token === 'opaque.student.token' ? 'session_student' : null },
    queryCursorCodec,
  };
}

async function studentSessions(): Promise<InMemoryBusinessSessionRepository> {
  const sessions = new InMemoryBusinessSessionRepository();
  await sessions.startOrResume({
    id: 'session_student', organizationId: ORGANIZATION_ID, userId: STUDENT_ID, subjectDigest: DIGEST,
    role: 'student', authzVersion: 1, recordVersion: 1, expiresAt: '2099-09-17T00:00:00.000Z', revokedAt: null,
  }, '2026-09-16T00:00:00.000Z');
  return sessions;
}

function identityFixture(): AuthorizationFixture {
  return {
    organizations: [{
      _id: ORGANIZATION_ID, organizationId: ORGANIZATION_ID, name: '启航实验学校', status: 'active',
      timeZone: 'Asia/Shanghai', version: 1, deletedAt: null,
    }],
    users: [{
      _id: STUDENT_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*',
      status: 'active', version: 1, deletedAt: null,
    }],
    identities: [{
      _id: 'identity_student', organizationId: ORGANIZATION_ID, userId: STUDENT_ID, provider: 'cloudbase_uid',
      providerSubjectDigest: DIGEST, status: 'active', version: 1, deletedAt: null,
    }],
    roles: [{
      _id: 'role_student', organizationId: ORGANIZATION_ID, userId: STUDENT_ID, role: 'student',
      status: 'active', permissions: ['content.read'], scopeIds: [STUDENT_ID], version: 1, deletedAt: null,
    }],
    teacherGrants: [], parentLinks: [],
  };
}

function querySeed() {
  const tasks = [task('task_a', '2026-09-16T18:00:00.000+08:00'), task('task_b', '2026-09-17T18:00:00.000+08:00')];
  const assignments = tasks.map((item) => assignment(item.id));
  return {
    [TASK_CORE_COLLECTIONS.tasks]: tasks.map((item) => createDocument(item.id, ORGANIZATION_ID, item.version, item)),
    [TASK_CORE_COLLECTIONS.assignments]: assignments.map((item) => createDocument(
      assignmentByIdDocumentId(ORGANIZATION_ID, item.id), ORGANIZATION_ID, item.version, item,
    )),
  };
}

function task(id: string, dueAt: string): TaskRecord {
  return {
    id, organizationId: ORGANIZATION_ID, creatorTeacherId: 'teacher_demo', title: `虚构任务 ${id}`,
    deliveryType: 'classroom', status: 'active', targetType: 'students', targetClassIds: ['class_demo'],
    targetStudentIds: [STUDENT_ID], startsAt: '2026-09-16T00:00:00.000+08:00', dueAt,
    latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null, itemRefs: [], items: [],
    publishedAt: '2026-09-15T00:00:00.000+08:00', deadlineExtendedAt: null, visibility: 'visible',
    withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null, recycledBy: null,
    recycleReason: null, recoverableUntil: null, version: 1,
  };
}

function assignment(taskId: string): TaskAssignmentRecord {
  return {
    id: `assignment_${taskId}_${STUDENT_ID}`, organizationId: ORGANIZATION_ID, taskId, studentId: STUDENT_ID,
    classId: 'class_demo', status: 'not_started', latestSubmissionId: null, latestSubmissionVersion: 0,
    redoCount: 0, redoDueAt: null, isLate: false, submittedAt: null, reviewedAt: null, version: 1,
  };
}

class RecordingStatelessCodec implements CursorCodec {
  public encodeCalls = 0;
  public decodeCalls = 0;

  public constructor(private readonly prefix: string) {}

  public encode(payload: string): string {
    this.encodeCalls += 1;
    return `${this.prefix}.${encodeURIComponent(payload)}`;
  }

  public decode(token: string): string | null {
    this.decodeCalls += 1;
    const prefix = `${this.prefix}.`;
    return token.startsWith(prefix) ? decodeURIComponent(token.slice(prefix.length)) : null;
  }
}
