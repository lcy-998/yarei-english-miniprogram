import { describe, expect, it, vi } from 'vitest';
import { createStudentWorkCommandFunction, main as unconfiguredCommand } from '../../functions/student-work-command';
import { createStudentWorkQueryFunction, main as unconfiguredQuery } from '../../functions/student-work-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import { InMemoryStudentWorkRepository } from '../../src/student-work/memory-repository';
import { StudentWorkService } from '../../src/student-work/service';

const actor: TrustedActorContext = { requestId: 'request_work', sessionId: 'session_work',
  actorUserId: 'student_work', actorRole: 'student', organizationId: 'org_work',
  platformSubjectDigest: 'digest_work', permissions: [], scopeIds: ['student_work'], authzVersion: 1 };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };
const requestIds = { next: () => 'request_work_result' };
let sequence = 0;
function service() {
  return new StudentWorkService(new InMemoryStudentWorkRepository({
    memberships: [{ organizationId: 'org_work', studentId: 'student_work', classId: 'class_work', status: 'active' }],
    materials: [{ id: 'material_work', organizationId: 'org_work', title: '虚构配音', contentVersion: 'demo-v1',
      status: 'published', visibility: { type: 'classes', classIds: ['class_work'] },
      demonstrationFileId: 'cloud://demo/materials/work.mp4', subtitle: 'Hello.' }],
  }), { async inspectAndSeal() { return { fileId: 'cloud://demo/private/work.mp3',
    contentSha256: 'b'.repeat(64), sizeBytes: 1024, durationMs: 1200, codec: 'mp3' }; } }, clock,
  { next: prefix => `${prefix}_function_${++sequence}` },
  { async temporaryUrl() { return 'https://example.test/private/work.mp3'; } });
}
function boundary(functionName: CloudBaseRuntimePort['functionName'], current: TrustedActorContext) {
  const runtime: CloudBaseRuntimePort = { functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'platform_subject', loginType: 'USERNAME' as const,
      isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'trusted_session') };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => current) };
  return { runtime, actorResolver, clock, requestIds };
}

describe('M2 trusted student work functions', () => {
  it('lists only authorized materials and commits an owned work with trusted identity', async () => {
    const handler = service();
    const query = createStudentWorkQueryFunction({ ...boundary('student-work-query', actor), service: handler });
    const command = createStudentWorkCommandFunction({ ...boundary('student-work-command', actor), service: handler });
    expect(await query({ apiVersion: 'm1.v1', action: 'listMaterials', payload: {} }))
      .toMatchObject({ ok: true, data: [{ id: 'material_work' }] });
    expect(await query({ apiVersion: 'm1.v1', action: 'searchMaterials',
      payload: { keyword: '配音', offset: 0, limit: 20 } })).toMatchObject({ ok: true,
      data: { total: 1, items: [{ id: 'material_work' }], nextOffset: null } });
    expect(await query({ apiVersion: 'm1.v1', action: 'listMaterialFacets', payload: {} }))
      .toMatchObject({ ok: true, data: [{}] });
    expect(await query({ apiVersion: 'm1.v1', action: 'getMaterial',
      payload: { materialId: 'material_work' } })).toMatchObject({ ok: true,
      data: { id: 'material_work' } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getMaterialPlayback', payload: { materialId: 'material_work' } }))
      .toMatchObject({ ok: true, data: { materialId: 'material_work', temporaryUrl: 'https://example.test/private/work.mp3' } });
    const began = await command({ apiVersion: 'm1.v1', action: 'beginDraft', payload: { materialId: 'material_work' },
      expectedVersion: 0, operationId: 'operation_work_begin_function' });
    if (!began.ok) throw new Error('draft expected');
    expect(await command({ apiVersion: 'm1.v1', action: 'submitWork', payload: { workId: began.data.id,
      stagingFileId: `cloud://demo/${began.data.stagingPath}`, note: '虚构作品' }, expectedVersion: 1,
    operationId: 'operation_work_submit_function' })).toMatchObject({ ok: true,
      data: { studentId: actor.actorUserId, status: 'submitted' } });
    expect(await query({ apiVersion: 'm1.v1', action: 'listMine', payload: {} }))
      .toMatchObject({ ok: true, data: [{ id: began.data.id, status: 'submitted' }] });
    expect(await query({ apiVersion: 'm1.v1', action: 'getPlayback', payload: { workId: began.data.id } }))
      .toMatchObject({ ok: true, data: { workId: began.data.id,
        temporaryUrl: 'https://example.test/private/work.mp3' } });
  });

  it('rejects actor injection, extra fields and teacher writes before service mutation', async () => {
    const command = createStudentWorkCommandFunction({ ...boundary('student-work-command', actor), service: service() });
    expect(await command({ apiVersion: 'm1.v1', action: 'beginDraft', payload: {
      materialId: 'material_work', studentId: 'other_student' }, expectedVersion: 0,
    operationId: 'operation_work_forged_actor' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const teacherCommand = createStudentWorkCommandFunction({
      ...boundary('student-work-command', { ...actor, actorRole: 'teacher' }), service: service(),
    });
    expect(await teacherCommand({ apiVersion: 'm1.v1', action: 'beginDraft', payload: { materialId: 'material_work' },
      expectedVersion: 0, operationId: 'operation_teacher_work' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const query = createStudentWorkQueryFunction({ ...boundary('student-work-query', actor), service: service() });
    expect(await query({ apiVersion: 'm1.v1', action: 'listMine', payload: { studentId: actor.actorUserId } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getMaterialPlayback', payload: { materialId: 'material_work',
      studentId: actor.actorUserId } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await query({ apiVersion: 'm1.v1', action: 'searchMaterials', payload: {
      keyword: '', offset: 0, limit: 20, studentId: actor.actorUserId } })).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR' },
    });
    expect(await query({ apiVersion: 'm1.v1', action: 'searchMaterials', payload: {
      keyword: '', offset: 0, limit: 20, grade: 3 } })).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('accepts only a versioned, owned draft deletion through the strict function contract', async () => {
    const handler = service();
    const command = createStudentWorkCommandFunction({ ...boundary('student-work-command', actor), service: handler });
    const began = await command({ apiVersion: 'm1.v1', action: 'beginDraft', payload: { materialId: 'material_work' },
      expectedVersion: 0, operationId: 'operation_work_delete_begin_function' });
    if (!began.ok) throw new Error('draft expected');
    const request = { apiVersion: 'm1.v1' as const, action: 'deleteDraft' as const,
      payload: { workId: began.data.id }, expectedVersion: began.data.version,
      operationId: 'operation_work_delete_function' };
    expect(await command({ ...request, payload: { workId: began.data.id, studentId: 'other_student' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ ...request, expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const deleted = await command(request);
    expect(deleted).toMatchObject({ ok: true, data: { id: began.data.id, version: 2,
      deletedByUserId: actor.actorUserId } });
    expect(await command(request)).toEqual(deleted);
    expect(await command({ ...request, operationId: 'operation_work_delete_new_function' }))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('leaves deployment mains unavailable without the reviewed runtime capabilities', async () => {
    expect(await unconfiguredCommand({ apiVersion: 'm1.v1', action: 'beginDraft', payload: {
      materialId: 'material_work' }, operationId: 'operation_work_unconfigured', expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredQuery({ apiVersion: 'm1.v1', action: 'listMine', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
