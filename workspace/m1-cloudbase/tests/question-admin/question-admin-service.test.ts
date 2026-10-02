import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { QuestionAdminService } from '../../src/question-admin/service';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { JsonValue } from '../../src/shared/protocol';
import { API_VERSION } from '../../src/shared/protocol';
import { validateOrganizationAdminRequest } from '../../src/contracts/org-content-functions';

const org = 'org_qihang_demo';
const classId = 'class_grade3_demo';
const actor: TrustedActorContext = { requestId: 'request_admin_demo', sessionId: 'session_admin_demo',
  actorUserId: 'admin_zhou_demo', actorRole: 'admin', organizationId: org,
  platformSubjectDigest: 'digest_admin', permissions: ['organization.read', 'organization.manage'],
  scopeIds: [org], authzVersion: 1 };

function document(id: string, data: Record<string, JsonValue>): VersionedDocument {
  return { _id: id, organizationId: org, schemaVersion: 1, version: 1, deletedAt: null, ...data };
}
function fixture() {
  const database = new FakeDocumentDatabase({
    classes: [document(classId, { id: classId, status: 'active' }),
      document('class_other_demo', { id: 'class_other_demo', status: 'archived' })],
    learning_resources: [
      document('question_bird_demo', { id: 'question_bird_demo', type: 'exercise', title: '动物主题选择题',
        stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'], correctAnswer: 'A. bird',
        explanation: 'Birds can fly.', grade: '三年级', unit: 'Unit 3', difficulty: '中等',
        knowledgePoint: '动物', questionType: 'single_choice', status: 'published',
        visibility: { type: 'classes', classIds: [classId] }, contentVersion: 'demo-v1' }),
      document('question_lion_demo', { id: 'question_lion_demo', type: 'exercise', title: '动物主题填空题',
        stem: 'The lion is _____.', options: [], correctAnswer: 'strong', explanation: 'The lion is strong.',
        grade: '三年级', unit: 'Unit 3', questionType: 'fill', status: 'published',
        visibility: { type: 'classes', classIds: [classId] }, contentVersion: 'demo-v1' }),
    ],
  });
  return { database, service: new QuestionAdminService(database, { nowIso: () => '2026-09-26T02:00:00.000Z' }) };
}

describe('A-06 school question administration', () => {
  it('keeps question content read-only while changing visibility with audit and idempotency', async () => {
    const { database, service } = fixture();
    expect((await service.list(actor, { keyword: 'animal' }, { limit: 20, offset: 0 })).items).toHaveLength(1);
    const before = await service.get(actor, 'question_bird_demo');
    const changed = await service.setVisibility(actor, before.id, { type: 'organization' }, before.version,
      '学校统一开放演示题', 'operation_question_visibility_1');
    expect(changed).toMatchObject({ version: 2, visibility: { type: 'organization' },
      stem: before.stem, correctAnswer: before.correctAnswer, explanation: before.explanation });
    expect(await service.setVisibility(actor, before.id, { type: 'organization' }, before.version,
      '学校统一开放演示题', 'operation_question_visibility_1')).toEqual(changed);
    await expect(service.setVisibility(actor, before.id, { type: 'classes', classIds: [classId] }, before.version,
      '重复标识', 'operation_question_visibility_1')).rejects.toMatchObject({ code: 'CONFLICT' });
    const resource = await database.get('learning_resources', before.id);
    expect(resource).toMatchObject({ contentVersion: 'demo-v1', stem: before.stem,
      correctAnswer: before.correctAnswer, explanation: before.explanation });
    expect(database.snapshot().operation_logs).toHaveLength(1);
  });

  it('applies batch status atomically and refuses stale, out-of-scope or invalid changes', async () => {
    const { database, service } = fixture();
    const items = [{ id: 'question_bird_demo', expectedVersion: 1 }, { id: 'question_lion_demo', expectedVersion: 1 }];
    const changed = await service.batchSetStatus(actor, items, 'offline', '撤下演示题', 'operation_question_batch_1');
    expect(changed.map(item => item.status)).toEqual(['offline', 'offline']);
    expect(await service.batchSetStatus(actor, items, 'offline', '撤下演示题', 'operation_question_batch_1')).toEqual(changed);
    await expect(service.batchSetStatus(actor, [{ id: 'question_bird_demo', expectedVersion: 2 },
      { id: 'question_lion_demo', expectedVersion: 1 }], 'published', '尝试部分回滚', 'operation_question_batch_2'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await database.get('learning_resources', 'question_bird_demo'))?.status).toBe('offline');
    expect(database.snapshot().operation_logs).toHaveLength(1);
    await expect(service.setVisibility(actor, 'question_bird_demo', { type: 'classes', classIds: ['class_other_demo'] },
      2, '无效班级', 'operation_question_bad_class')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.batchSetStatus({ ...actor, actorRole: 'teacher' }, items, 'published', '越权',
      'operation_question_teacher')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const scopedActor = { ...actor, scopeIds: ['class_other_demo'] };
    expect((await service.list(scopedActor, {}, { limit: 20, offset: 0 })).items).toEqual([]);
  });

  it('batch visibility is atomic and strict requests cannot alter question content', async () => {
    const { database, service } = fixture();
    const items = [{ id: 'question_bird_demo', expectedVersion: 1 }, { id: 'question_lion_demo', expectedVersion: 1 }];
    const changed = await service.batchSetVisibility(actor, items, { type: 'organization' },
      '面向全校开放', 'operation_question_bulk_visibility_1');
    expect(changed.map(item => item.visibility)).toEqual([{ type: 'organization' }, { type: 'organization' }]);
    expect(await service.batchSetVisibility(actor, items, { type: 'organization' },
      '面向全校开放', 'operation_question_bulk_visibility_1')).toEqual(changed);
    expect(database.snapshot().operation_logs).toHaveLength(1);
    const forged = validateOrganizationAdminRequest({ apiVersion: API_VERSION, action: 'setQuestionVisibility',
      payload: { id: 'question_bird_demo', visibility: { type: 'organization' }, reason: '授权', stem: 'tampered' },
      expectedVersion: 1, operationId: 'operation_question_forged_1' });
    expect(forged.ok).toBe(false);
    const duplicate = validateOrganizationAdminRequest({ apiVersion: API_VERSION, action: 'batchSetQuestionVisibility',
      payload: { items: [items[0], items[0]], visibility: { type: 'organization' }, reason: '重复题目' },
      expectedVersion: 1, operationId: 'operation_question_duplicate_1' });
    expect(duplicate.ok).toBe(false);
  });
});
