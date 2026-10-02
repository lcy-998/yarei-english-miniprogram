import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryTemplateRepository } from '../../src/task-template/memory-repository';
import { TaskTemplateService } from '../../src/task-template/service';
import type { TaskTemplate } from '../../src/task-template/types';
import type { LearningResourceRecord, TaskItemReference } from '../../src/task-core/types';

const organizationId = 'org_template_demo';
const teacherId = 'teacher_template_demo';
const classId = 'class_template_demo';
const teacher: TrustedActorContext = { requestId: 'request_template', sessionId: 'session_template',
  actorUserId: teacherId, actorRole: 'teacher', organizationId,
  platformSubjectDigest: 'digest_template', permissions: ['task.publish', 'content.read'],
  scopeIds: [classId], authzVersion: 1 };
const resource: LearningResourceRecord = { id: 'resource_reading', organizationId,
  type: 'reading', title: '虚构绘本', contentVersion: 1, status: 'published',
  visibility: 'classes', allowedClassIds: [classId], payload: { pages: [{ id: 'page_1' }] } };
const reference: TaskItemReference = { id: 'item_reading', resourceId: resource.id,
  completionRule: { kind: 'reading_pages', requiredPageCount: 1 }, scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };
let sequence = 0;
function fixture(systemTemplates: readonly TaskTemplate[] = []) {
  const repository = new InMemoryTemplateRepository({ grants: [{ organizationId, teacherId, classId,
    permissions: ['task.publish', 'content.read'], status: 'active' },
    { organizationId, teacherId: 'teacher_other', classId,
      permissions: ['task.publish', 'content.read'], status: 'active' }],
  resources: [resource], templates: systemTemplates });
  const service = new TaskTemplateService(repository, clock,
    { next: prefix => `${prefix}_demo_${++sequence}` });
  return { repository, service };
}
const input = { title: '动物阅读模板', description: '完成一页阅读', itemRefs: [reference] };

describe('M2 task template service', () => {
  it('freezes content and rules while keeping student targets, dates and notes out of the template', async () => {
    const { repository, service } = fixture();
    const saved = await service.save(teacher, input, 0, 'operation_template_save_first');
    expect(saved).toMatchObject({ scope: 'personal', ownerTeacherId: teacherId,
      status: 'active', version: 1, items: [{ resourceSnapshot: { title: '虚构绘本', payload: { pages: [{ id: 'page_1' }] } },
        completionRule: { requiredPageCount: 1 } }] });
    expect(JSON.stringify(saved)).not.toMatch(/targetStudentIds|targetClassIds|startsAt|dueAt|teacherNote|submissions/);
    expect(await service.save(teacher, input, 0, 'operation_template_save_first')).toEqual(saved);
    expect(repository.snapshot().templates).toHaveLength(1);
    await expect(service.save(teacher, { ...input, title: '不同标题' }, 0, 'operation_template_save_first'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    const changedResource = new InMemoryTemplateRepository({ ...repository.snapshot(), resources: [{ ...resource,
      title: '资源新标题', payload: { pages: [{ id: 'page_2' }] } }] });
    const changedService = new TaskTemplateService(changedResource, clock, { next: prefix => `${prefix}_changed_${++sequence}` });
    expect(await changedService.get(teacher, saved.id)).toMatchObject({ items: [{ resourceSnapshot: {
      title: '虚构绘本', payload: { pages: [{ id: 'page_1' }] } } }] });
  });

  it('copies, renames, uses and soft-deletes personal templates without altering an independent copy', async () => {
    const { service } = fixture();
    const first = await service.save(teacher, input, 0, 'operation_template_create_second');
    const copied = await service.copyPersonal(teacher, first.id, '阅读模板副本', 1, 'operation_template_copy');
    expect(copied).toMatchObject({ title: '阅读模板副本', useCount: 0, version: 1 });
    expect(copied.id).not.toBe(first.id);
    const renamed = await service.rename(teacher, first.id, '新版动物阅读', 1, 'operation_template_rename');
    expect(renamed.title).toBe('新版动物阅读');
    const used = await service.use(teacher, copied.id, 1, 'operation_template_use');
    expect(used).toMatchObject({ useCount: 0, version: 1 });
    expect(await service.use(teacher, copied.id, 1, 'operation_template_use')).toEqual(used);
    await service.remove(teacher, first.id, 2, 'operation_template_delete');
    expect((await service.list(teacher)).map(item => item.id)).toEqual([copied.id]);
    expect(await service.get(teacher, copied.id)).toMatchObject({ title: '阅读模板副本', status: 'active' });
  });

  it('keeps system templates read-only and other teachers private', async () => {
    const system: TaskTemplate = { id: 'template_system_demo', organizationId,
      ownerTeacherId: null, scope: 'system', title: '系统阅读模板', description: '只读',
      itemRefs: [reference], items: [{ id: reference.id, resourceId: resource.id, resourceVersion: 1,
        snapshotSchemaVersion: 1, resourceSnapshot: { title: resource.title, type: resource.type,
          payload: resource.payload }, completionRule: reference.completionRule!,
        scoringRule: reference.scoringRule!, order: 1 }], status: 'active', useCount: 0,
      version: 1, createdAt: clock.nowIso(), updatedAt: clock.nowIso() };
    const { service } = fixture([system]);
    expect(await service.list(teacher)).toMatchObject([{ id: system.id, scope: 'system' }]);
    await expect(service.rename(teacher, system.id, '修改系统模板', 1, 'operation_template_system_rename'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const personal = await service.copyPersonal(teacher, system.id, '我的系统副本', 1, 'operation_template_system_copy');
    expect(personal).toMatchObject({ scope: 'personal', ownerTeacherId: teacherId });
    const other = { ...teacher, actorUserId: 'teacher_other' };
    await expect(service.get(other, personal.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.list(other)).map(item => item.id)).toEqual([system.id]);
  });

  it('rolls template creation back when its receipt cannot be stored', async () => {
    const { repository, service } = fixture();
    vi.spyOn(repository, 'saveReceipt').mockResolvedValueOnce(false);
    await expect(service.save(teacher, input, 0, 'operation_template_receipt_failed'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.snapshot().templates).toHaveLength(0);
  });

  it('rejects templates whose content has no single class that can use every item', async () => {
    const secondClassId = 'class_template_second';
    const secondResource: LearningResourceRecord = { ...resource, id: 'resource_second',
      allowedClassIds: [secondClassId] };
    const repository = new InMemoryTemplateRepository({ grants: [classId, secondClassId].map(id => ({
      organizationId, teacherId, classId: id, permissions: ['task.publish', 'content.read'], status: 'active' as const,
    })), resources: [resource, secondResource] });
    const service = new TaskTemplateService(repository, clock, { next: prefix => `${prefix}_disjoint` });
    const bothClasses = { ...teacher, scopeIds: [classId, secondClassId] };
    await expect(service.save(bothClasses, { ...input,
      itemRefs: [reference, { ...reference, id: 'item_second', resourceId: secondResource.id, order: 2 }] },
    0, 'operation_template_disjoint')).rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    expect(repository.snapshot().templates).toHaveLength(0);
  });

  it('rejects unsupported scoring rules before saving a template', async () => {
    const { service } = fixture();
    await expect(service.save(teacher, { ...input, itemRefs: [{ ...reference,
      scoringRule: { kind: 'invented', maxScore: 100 } }] }, 0, 'operation_template_invalid_score'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('does not reveal a system template when its resources are outside teacher authorization', async () => {
    const restricted: TaskTemplate = { id: 'template_restricted_system', organizationId,
      ownerTeacherId: null, scope: 'system', title: '其他班级模板', description: '',
      itemRefs: [{ ...reference, resourceId: 'resource_restricted' }], items: [], status: 'active',
      useCount: 0, version: 1, createdAt: clock.nowIso(), updatedAt: clock.nowIso() };
    const { service } = fixture([restricted]);
    expect(await service.list(teacher)).toEqual([]);
    await expect(service.get(teacher, restricted.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.copyPersonal(teacher, restricted.id, '副本', 1, 'operation_copy_restricted'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
