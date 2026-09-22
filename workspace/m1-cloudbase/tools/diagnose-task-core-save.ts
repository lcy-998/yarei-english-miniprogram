import { createTaskCoreDocumentRepository } from '../src/repositories/task-core-document-adapter';
import { createIdentityDocumentRepository } from '../src/repositories/identity-session-document-adapter';
import type { CloudBaseNativeDatabasePort } from '../src/repositories/cloudbase-document-database';
import { createCloudBaseDocumentDatabase } from '../src/repositories/cloudbase-document-database';
import { TaskCoreService } from '../src/task-core/task-core-service';
import type { TrustedActorContext } from '../src/auth/trusted-actor';
import type { IdempotencyRecord, TaskRecord } from '../src/task-core/types';

export async function diagnoseTaskCoreSave(nativeDatabase: CloudBaseNativeDatabasePort): Promise<string> {
  const database = createCloudBaseDocumentDatabase(nativeDatabase);
  const repository = createTaskCoreDocumentRepository(database);
  const organizationId = 'org_qihang_demo';
  const teacherId = 'usr_teacher_demo_01';
  const studentId = 'usr_student_g3_01';
  const memberships = await repository.listActiveStudentMemberships(organizationId, [studentId]);
  const grants = await repository.listActiveTeacherGrants(organizationId, teacherId, memberships.map((item) => item.classId));
  if (memberships.length !== 1 || grants.length < 1) return 'prerequisite-unavailable';
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const task: TaskRecord = {
    id: `diag_task_${suffix}`, organizationId, creatorTeacherId: teacherId, title: '诊断任务',
    deliveryType: 'classroom', status: 'draft', targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
    startsAt: '2026-09-20T00:00:00.000Z', dueAt: '2026-09-21T00:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
    description: null, teacherNote: null, itemRefs: [], items: [], publishedAt: null, deadlineExtendedAt: null,
    visibility: 'visible', withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null,
    recycledBy: null, recycleReason: null, recoverableUntil: null, version: 1,
  };
  const idempotency: IdempotencyRecord = {
    id: `diag_idempotency_${suffix}`, organizationId, actorUserId: teacherId, functionName: 'task-command',
    action: 'saveDraft', operationId: `diag_${suffix}`, requestHash: 'diagnostic', status: 'processing', result: null,
  };
  const scope = { organizationId, resourceIds: [], membershipIds: memberships.map((item) => item.id), teacherGrantIds: grants.map((item) => item._id), assignmentIds: [], submissionIds: [], classMembershipGuards: [] };
  const idempotencyProbe = await probe(async () => repository.runTransaction(scope, async (transaction) => {
    if (!await transaction.createIdempotencyRecord(idempotency)) throw new Error('idempotency-conflict');
    return undefined;
  }));
  const taskProbe = await probe(async () => repository.runTransaction(scope, async (transaction) => {
    await transaction.saveTask(task);
    return undefined;
  }));
  let stage = 'start';
  try {
    await repository.runTransaction(scope, async (transaction) => {
      stage = 'idempotency-read'; await transaction.findIdempotencyRecord(idempotency.id);
      stage = 'idempotency-create'; await transaction.createIdempotencyRecord(idempotency);
      stage = 'membership-read'; await transaction.listActiveStudentMemberships(organizationId, [studentId]);
      stage = 'grant-read'; await transaction.findActiveTeacherGrant(organizationId, teacherId, memberships[0]!.classId);
      stage = 'task-write'; await transaction.saveTask(task);
      stage = 'idempotency-finalize'; await transaction.replaceIdempotencyRecord({ ...idempotency, status: 'succeeded', result: { ok: true, data: { taskId: task.id }, meta: { requestId: `diag_request_${suffix}`, serverTime: '2026-09-20T12:00:00.000Z', apiVersion: 'm1.v1' } } });
      stage = 'rollback'; throw new Error('diagnostic-rollback');
    });
  } catch { /* The stage is intentionally retained after the forced rollback. */ }
  if (idempotencyProbe === 'committed') await removeDocument(nativeDatabase, 'idempotency_records', idempotency.id);
  if (taskProbe === 'committed') await removeDocument(nativeDatabase, 'tasks', task.id);
  const operationId = `diag_service_${suffix}`;
  const actor: TrustedActorContext = {
    requestId: `diag_request_${suffix}`, sessionId: `diag_session_${suffix}`, actorUserId: teacherId, actorRole: 'teacher',
    organizationId, platformSubjectDigest: 'diagnostic', permissions: ['task.publish', 'content.read', 'submission.review'],
    scopeIds: memberships.map((item) => item.classId), authzVersion: 1,
  };
  const service = new TaskCoreService(repository, createIdentityDocumentRepository(database),
    { nowIso: () => '2026-09-20T12:00:00.000Z' }, { next: (prefix) => `${prefix}_${suffix}` }, { next: () => `diag_request_${suffix}` });
  let serviceResult;
  let serviceFailure: unknown = null;
  try { serviceResult = await service.saveTaskDraft(actor, {
    title: '诊断任务', itemRefs: [{ id: `item_${suffix}`, resourceId: 'res_reading_zoo_demo', completionRule: { kind: 'reading_pages', requiredPageCount: 1 }, scoringRule: { kind: 'completion_only' }, order: 1 }], targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
    startsAt: '2026-09-20T00:00:00.000Z', dueAt: '2026-09-21T00:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
  }, 0, operationId); } catch (error) { serviceFailure = error; }
  if (serviceFailure !== null) return `idempotency:${idempotencyProbe};task:${taskProbe};sequence:${stage};service:threw-${safeCause(serviceFailure)}`;
  if (serviceResult.ok && typeof serviceResult.data.taskId === 'string') {
    await removeDocument(nativeDatabase, 'tasks', serviceResult.data.taskId);
    const records = await nativeDatabase.collection('idempotency_records').where({ organizationId, actorUserId: teacherId, functionName: 'task-command', action: 'saveDraft', operationId }).get();
    const data = Array.isArray(records.data) ? records.data : [];
    for (const record of data) if (record && typeof record._id === 'string') await removeDocument(nativeDatabase, 'idempotency_records', record._id);
  }
  return `idempotency:${idempotencyProbe};task:${taskProbe};sequence:${stage};service:${serviceResult.ok ? 'succeeded' : `failed-${serviceResult.error.code}`}`;
}

function safeCause(error: unknown): string {
  const cause = error !== null && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  const nested = cause !== null && typeof cause === 'object' ? (cause as { cause?: unknown }).cause : undefined;
  const value = nested !== null && typeof nested === 'object' ? (nested as { errCode?: unknown; code?: unknown; name?: unknown }).errCode ?? (nested as { code?: unknown }).code ?? (nested as { name?: unknown }).name : undefined;
  if ((typeof value === 'string' || typeof value === 'number') && value !== 'Error') return String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const message = nested !== null && typeof nested === 'object' ? (nested as { message?: unknown }).message : undefined;
  if (typeof message !== 'string') return 'unknown';
  if (/transaction/i.test(message)) return 'transaction';
  if (/duplicate|already exists/i.test(message)) return 'duplicate';
  if (/permission|forbidden/i.test(message)) return 'permission';
  if (/undefined|null|property/i.test(message)) return 'runtime-shape';
  return `sdk-${message.replace(/[^A-Za-z0-9 _.:/-]/g, '_').slice(0, 120)}`;
}

async function probe(work: () => Promise<void>): Promise<string> {
  try { await work(); return 'committed'; } catch (error: unknown) {
    const candidate = error as Readonly<{ code?: unknown; name?: unknown }>;
    const code = typeof candidate.code === 'string' ? candidate.code : typeof candidate.name === 'string' ? candidate.name : 'unknown';
    return `failed-${code.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)}`;
  }
}

async function removeDocument(database: CloudBaseNativeDatabasePort, collection: string, id: string): Promise<void> {
  await database.runTransaction(async (transaction) => {
    await transaction.collection(collection).doc(id).remove();
  });
}
