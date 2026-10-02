import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { createM2CapacityFixtureOperator } from '../../src/seed/m2-capacity-fixture';

const org = 'org_qihang_demo';
const classId = 'cls_grade3_2';
const now = '2026-09-27T12:00:00Z';
const cls: VersionedDocument = { _id: classId, organizationId: org, schemaVersion: 1,
  version: 1, deletedAt: null, status: 'active', name: '虚构三年级二班', grade: 3, term: '演示学期' };
const existing = Array.from({ length: 36 }, (_, index): VersionedDocument => ({
  _id: `mem_existing_${index + 1}`, organizationId: org, schemaVersion: 1, version: 1,
  deletedAt: null, classId, studentId: `usr_existing_${index + 1}`, status: 'active',
}));
function database() { return new FakeDocumentDatabase({ classes: [cls], class_memberships: existing }); }

describe('M2 500-target nonproduction fixture', () => {
  it('adds 464 fictitious members in bounded transactions and retires them after a recycled 500-person task', async () => {
    const db = database();
    const operator = createM2CapacityFixtureOperator(db);
    expect(await operator.inspect()).toMatchObject({ status: 'not_planned', classVersion: 1 });
    expect(await operator.plan(now)).toMatchObject({ status: 'planned', created: 0 });
    let state = await operator.advance(now);
    for (let step = 0; state.status !== 'ready' && step < 50; step += 1) state = await operator.advance(now);
    expect(state).toMatchObject({ status: 'ready', created: 464, retired: 0, classVersion: 48 });
    expect((await db.find('class_memberships', { organizationId: org, classId,
      status: 'active', deletedAt: null })).length).toBe(500);
    expect(await operator.advance(now)).toEqual(state);
    const taskId = 'task_m2_capacity_test';
    const targets = [...existing.map(row => String(row.studentId)),
      ...Array.from({ length: 464 }, (_, index) => `usr_m2_capacity_${String(index + 1).padStart(4, '0')}`)];
    await db.runTransaction(async tx => {
      await tx.create('tasks', { _id: taskId, organizationId: org, schemaVersion: 1, version: 1,
        deletedAt: null, visibility: 'recycled', targetStudentIds: targets });
      for (const [index, studentId] of targets.entries()) {
        await tx.create('task_assignments', { _id: `assignment_capacity_${index}`, organizationId: org,
          schemaVersion: 1, version: 1, deletedAt: null, taskId, studentId });
      }
    });
    expect(await operator.beginRetire(taskId, now)).toMatchObject({ status: 'retiring', taskId });
    state = await operator.retire(now);
    for (let step = 0; state.status !== 'retired' && step < 50; step += 1) state = await operator.retire(now);
    expect(state).toMatchObject({ status: 'retired', created: 464, retired: 464,
      taskId, classVersion: 95 });
    expect((await db.find('class_memberships', { organizationId: org, classId,
      status: 'active', deletedAt: null })).length).toBe(36);
    expect((await db.find('users', { organizationId: org, status: 'disabled' })).length).toBe(464);
    expect(await operator.retire(now)).toEqual(state);
  }, 60_000);

  it('rolls back a collided batch without changing the class guard or cursor', async () => {
    const db = database();
    const operator = createM2CapacityFixtureOperator(db);
    await operator.plan(now);
    await db.runTransaction(tx => tx.create('users', { _id: 'usr_m2_capacity_0001',
      organizationId: org, schemaVersion: 1, version: 1, deletedAt: null, status: 'active' }));
    await expect(operator.advance(now)).rejects.toThrow('collision');
    expect(await operator.inspect()).toMatchObject({ status: 'planned', created: 0, classVersion: 1 });
    expect((await db.find('class_memberships', { organizationId: org, classId,
      status: 'active', deletedAt: null })).length).toBe(36);
  });
});
