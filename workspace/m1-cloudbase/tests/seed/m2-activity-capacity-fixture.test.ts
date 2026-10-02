import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { createM2ActivityCapacityFixtureOperator } from '../../src/seed/m2-activity-capacity-fixture';

const org = 'org_qihang_demo';
const classId = 'cls_grade3_2';
const now = '2026-09-27T13:00:00Z';
const capacityId = (index: number) => `usr_m2_capacity_${String(index).padStart(4, '0')}`;
function fixture() {
  const users: VersionedDocument[] = [];
  const memberships: VersionedDocument[] = Array.from({ length: 36 }, (_, index) => ({
    _id: `base_member_${index}`, organizationId: org, schemaVersion: 1, version: 1,
    deletedAt: null, classId, studentId: `base_student_${index}`, status: 'active',
  }));
  for (let index = 1; index <= 464; index += 1) {
    users.push({ _id: capacityId(index), organizationId: org, schemaVersion: 1, version: 2,
      deletedAt: null, status: 'disabled', authorizationVersion: 2,
      seedRunId: 'seed_m2_capacity_500_v1' });
    memberships.push({ _id: `mem_m2_capacity_${String(index).padStart(4, '0')}`,
      organizationId: org, schemaVersion: 1, version: 2, deletedAt: null,
      classId, studentId: capacityId(index), status: 'inactive',
      seedRunId: 'seed_m2_capacity_500_v1' });
  }
  return new FakeDocumentDatabase({
    classes: [{ _id: classId, organizationId: org, schemaVersion: 1, version: 95,
      deletedAt: null, status: 'active' }],
    class_memberships: memberships, users,
    migration_runs: [{ _id: 'seed_m2_capacity_500_v1', organizationId: org, schemaVersion: 1,
      version: 96, deletedAt: null, status: 'retired', nextIndex: 464, retiredIndex: 464 }],
  });
}

describe('M2 500-person activity capacity cohort', () => {
  it('reactivates only the retired synthetic members and retires them after a published 500-person snapshot', async () => {
    const db = fixture();
    const operator = createM2ActivityCapacityFixtureOperator(db);
    expect(await operator.plan(now)).toMatchObject({ status: 'planned', classVersion: 95 });
    let state = await operator.advance(now);
    for (let step = 0; state.status !== 'ready' && step < 50; step += 1) state = await operator.advance(now);
    expect(state).toMatchObject({ status: 'ready', active: 464, classVersion: 142 });
    expect((await db.find('class_memberships', { organizationId: org, classId,
      status: 'active', deletedAt: null })).length).toBe(500);
    const activityId = 'activity_m2_capacity_test';
    await db.runTransaction(tx => tx.create('checkin_activities', {
      _id: activityId, organizationId: org, schemaVersion: 1, version: 2,
      deletedAt: null, classId, status: 'published', payload: { participants: [
        ...Array.from({ length: 36 }, (_, index) => ({ studentId: `base_student_${index}` })),
        ...Array.from({ length: 464 }, (_, index) => ({ studentId: capacityId(index + 1) })),
      ] },
    }));
    expect(await operator.beginRetire(activityId, now)).toMatchObject({ status: 'retiring', activityId });
    state = await operator.retire(now);
    for (let step = 0; state.status !== 'retired' && step < 50; step += 1) state = await operator.retire(now);
    expect(state).toMatchObject({ status: 'retired', retired: 464, classVersion: 189 });
    expect((await db.find('class_memberships', { organizationId: org, classId,
      status: 'active', deletedAt: null })).length).toBe(36);
    expect((await db.find('users', { organizationId: org, status: 'disabled' })).length).toBe(464);
  }, 60_000);

  it('stops a changed synthetic member before any batch writes', async () => {
    const db = fixture();
    const operator = createM2ActivityCapacityFixtureOperator(db);
    await operator.plan(now);
    const first = await db.get('users', capacityId(1));
    await db.runTransaction(tx => tx.replace('users', capacityId(1), 2, { ...first!, version: 3 }));
    await expect(operator.advance(now)).rejects.toThrow('drift');
    expect(await operator.inspect()).toMatchObject({ status: 'planned', active: 0, classVersion: 95 });
  });
});
