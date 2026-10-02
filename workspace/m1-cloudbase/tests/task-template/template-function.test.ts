import { describe, expect, it, vi } from 'vitest';
import { createTaskTemplateCommandFunction, main as unconfiguredCommand } from '../../functions/task-template-command';
import { createTaskTemplateQueryFunction, main as unconfiguredQuery } from '../../functions/task-template-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import { InMemoryTemplateRepository } from '../../src/task-template/memory-repository';
import { TaskTemplateService } from '../../src/task-template/service';

const actor: TrustedActorContext = { requestId: 'request_template_function', sessionId: 'session_template_function',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_template', permissions: ['task.publish', 'content.read'],
  scopeIds: ['class_demo'], authzVersion: 1 };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };
const requestIds = { next: () => 'request_template_result' };
let sequence = 0;
function service() {
  return new TaskTemplateService(new InMemoryTemplateRepository({
    grants: [{ organizationId: 'org_demo', teacherId: 'teacher_demo', classId: 'class_demo',
      status: 'active', permissions: ['task.publish', 'content.read'] }],
    resources: [{ id: 'resource_reading', organizationId: 'org_demo', type: 'reading', title: '虚构绘本',
      contentVersion: 1, status: 'published', visibility: 'classes', allowedClassIds: ['class_demo'],
      payload: { pages: [{ id: 'page_1' }] } }],
  }), clock, { next: prefix => `${prefix}_function_${++sequence}` });
}
function boundary(functionName: CloudBaseRuntimePort['functionName'], current: TrustedActorContext) {
  const runtime: CloudBaseRuntimePort = { functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'platform_subject', loginType: 'USERNAME' as const,
      isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'trusted_session') };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => current) };
  return { runtime, actorResolver, clock, requestIds };
}
const itemRefs = [{ id: 'item_reading', resourceId: 'resource_reading', order: 1,
  completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
  scoringRule: { kind: 'manual', maxScore: 100 } }];

describe('M2 trusted task template functions', () => {
  it('saves a personal snapshot and exposes it only to the authorized teacher', async () => {
    const handler = service();
    const command = createTaskTemplateCommandFunction({ ...boundary('task-template-command', actor), service: handler });
    const query = createTaskTemplateQueryFunction({ ...boundary('task-template-query', actor), service: handler });
    const saved = await command({ apiVersion: 'm1.v1', action: 'saveTemplate', payload: {
      title: '阅读模板', description: '完成一页', itemRefs }, expectedVersion: 0,
    operationId: 'operation_template_function_save' });
    expect(saved).toMatchObject({ ok: true, data: { scope: 'personal', items: [{ resourceId: 'resource_reading' }] } });
    if (!saved.ok) throw new Error('template expected');
    expect(await query({ apiVersion: 'm1.v1', action: 'listTemplates', payload: {} }))
      .toMatchObject({ ok: true, data: [{ id: saved.data.id }] });
    expect(await command({ apiVersion: 'm1.v1', action: 'useTemplate', payload: { templateId: saved.data.id },
      expectedVersion: 1, operationId: 'operation_template_function_use' }))
      .toMatchObject({ ok: true, data: { useCount: 0, version: 1 } });
  });
  it('rejects identity, dates, targets and answers injected into a template command', async () => {
    const command = createTaskTemplateCommandFunction({ ...boundary('task-template-command', actor), service: service() });
    expect(await command({ apiVersion: 'm1.v1', action: 'saveTemplate', payload: {
      title: '阅读模板', description: '', itemRefs, targetStudentIds: ['student_other'] },
    expectedVersion: 0, operationId: 'operation_template_forged_target' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'saveTemplate', payload: {
      title: '阅读模板', description: '', itemRefs: [{ ...itemRefs[0], answer: 'secret' }] },
    expectedVersion: 0, operationId: 'operation_template_forged_answer' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const studentCommand = createTaskTemplateCommandFunction({ ...boundary('task-template-command',
      { ...actor, actorRole: 'student' }), service: service() });
    expect(await studentCommand({ apiVersion: 'm1.v1', action: 'saveTemplate', payload: {
      title: '阅读模板', description: '', itemRefs }, expectedVersion: 0,
    operationId: 'operation_template_student' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
  it('keeps unconfigured entry points unavailable', async () => {
    expect(await unconfiguredQuery({ apiVersion: 'm1.v1', action: 'listTemplates', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredCommand({ apiVersion: 'm1.v1', action: 'removeTemplate', payload: {
      templateId: 'template_demo' }, expectedVersion: 1, operationId: 'operation_template_unconfigured' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
