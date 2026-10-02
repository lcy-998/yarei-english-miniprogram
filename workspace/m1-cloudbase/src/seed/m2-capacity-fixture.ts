import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';

const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const RUN_ID = 'seed_m2_capacity_500_v1';
const BASE_MEMBERS = 36;
const EXTRA_STUDENTS = 464;
const BATCH = 10;
type CapacityStatus = 'not_planned' | 'planned' | 'applying' | 'ready' | 'retiring' | 'retired';
export interface M2CapacityState { readonly status: CapacityStatus; readonly created: number;
  readonly retired: number; readonly classVersion: number | null; readonly taskId: string | null }

function id(index: number): string { return String(index).padStart(4, '0'); }
function userId(index: number): string { return `usr_m2_capacity_${id(index)}`; }
function membershipId(index: number): string { return `mem_m2_capacity_${id(index)}`; }
function validDate(value: string): boolean { return Number.isFinite(Date.parse(value)) && value.endsWith('Z'); }
function state(run: VersionedDocument | null, cls: VersionedDocument | null): M2CapacityState {
  if (run === null) return { status: 'not_planned', created: 0, retired: 0,
    classVersion: cls?.version ?? null, taskId: null };
  if (run._id !== RUN_ID || run.organizationId !== ORG || run.source !== 'synthetic-m2-capacity'
    || !['planned', 'applying', 'ready', 'retiring', 'retired'].includes(String(run.status))
    || !Number.isSafeInteger(run.nextIndex) || !Number.isSafeInteger(run.retiredIndex)
    || Number(run.nextIndex) < 0 || Number(run.nextIndex) > EXTRA_STUDENTS
    || Number(run.retiredIndex) < 0 || Number(run.retiredIndex) > Number(run.nextIndex)
    || !Number.isSafeInteger(run.baseClassVersion) || run.baseClassVersion !== 1) {
    throw new Error('Capacity run state is invalid.');
  }
  return { status: run.status as CapacityStatus, created: Number(run.nextIndex),
    retired: Number(run.retiredIndex), classVersion: cls?.version ?? null,
    taskId: typeof run.taskId === 'string' ? run.taskId : null };
}
function expectedClassVersion(run: VersionedDocument): number {
  return Number(run.baseClassVersion) + Math.ceil(Number(run.nextIndex) / BATCH)
    + Math.ceil(Number(run.retiredIndex) / BATCH);
}
function revisedClass(cls: VersionedDocument, now: string): VersionedDocument {
  const { seedRunId: _seedRunId, seedVersion: _seedVersion,
    seedDocumentContentHash: _seedHash, ...current } = cls;
  return { ...current, version: cls.version + 1, updatedAt: now,
    updatedBy: 'system_m2_capacity' } as VersionedDocument;
}
function capacityUser(index: number, now: string): VersionedDocument {
  return { _id: userId(index), organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null,
    authorizationVersion: 1, status: 'active', displayName: `虚构容量学员${id(index)}`,
    displayNameMasked: `虚构学员${id(index)}`, seedRunId: RUN_ID, seedVersion: 'm2-capacity-v1',
    createdAt: now, updatedAt: now };
}
function capacityMembership(index: number, now: string): VersionedDocument {
  return { _id: membershipId(index), organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, classId: CLASS, studentId: userId(index), status: 'active',
    joinedAt: now, seedRunId: RUN_ID, seedVersion: 'm2-capacity-v1', createdAt: now,
    updatedAt: now };
}

/** Isolated, resumable 500-target fixture. It never removes existing M1 records. */
export function createM2CapacityFixtureOperator(database: DocumentDatabasePort): Readonly<{
  inspect(): Promise<M2CapacityState>;
  plan(now: string): Promise<M2CapacityState>;
  advance(now: string): Promise<M2CapacityState>;
  beginRetire(taskId: string | null, now: string): Promise<M2CapacityState>;
  retire(now: string): Promise<M2CapacityState>;
}> {
  const requireNow = (now: string) => { if (!validDate(now)) throw new Error('Invalid capacity time.'); };
  return {
    inspect: async () => state(await database.get('migration_runs', RUN_ID), await database.get('classes', CLASS)),
    plan: async now => {
      requireNow(now);
      return database.runTransaction(async tx => {
        const cls = await tx.get('classes', CLASS);
        const existing = await tx.get('migration_runs', RUN_ID);
        if (existing) return state(existing, cls);
        const active = await tx.find('class_memberships', { organizationId: ORG,
          classId: CLASS, status: 'active', deletedAt: null });
        if (!cls || cls.organizationId !== ORG || cls.status !== 'active' || cls.version !== 1
          || active.length !== BASE_MEMBERS
          || await tx.get('users', userId(1)) || await tx.get('users', userId(EXTRA_STUDENTS))
          || await tx.get('class_memberships', membershipId(1))
          || await tx.get('class_memberships', membershipId(EXTRA_STUDENTS))) {
          throw new Error('Capacity fixture precondition failed.');
        }
        const run: VersionedDocument = { _id: RUN_ID, organizationId: ORG, schemaVersion: 1,
          version: 1, deletedAt: null, source: 'synthetic-m2-capacity', status: 'planned',
          baseClassVersion: cls.version, expectedBaseMembers: BASE_MEMBERS,
          expectedCapacity: BASE_MEMBERS + EXTRA_STUDENTS, nextIndex: 0, retiredIndex: 0,
          taskId: null, createdAt: now, updatedAt: now };
        if (!await tx.create('migration_runs', run)) throw new Error('Capacity run conflict.');
        return state(run, cls);
      });
    },
    advance: async now => {
      requireNow(now);
      return database.runTransaction(async tx => {
        const run = await tx.get('migration_runs', RUN_ID);
        const cls = await tx.get('classes', CLASS);
        if (!run || !cls || cls.organizationId !== ORG || cls.status !== 'active') {
          throw new Error('Capacity run or class unavailable.');
        }
        const current = state(run, cls);
        if (current.status === 'ready') return current;
        if (current.status !== 'planned' && current.status !== 'applying'
          || cls.version !== expectedClassVersion(run) || current.retired !== 0) {
          throw new Error('Capacity preparation drift.');
        }
        const end = Math.min(EXTRA_STUDENTS, current.created + BATCH);
        for (let index = current.created + 1; index <= end; index += 1) {
          if (await tx.get('users', userId(index)) || await tx.get('class_memberships', membershipId(index))) {
            throw new Error('Capacity candidate ID collision.');
          }
        }
        for (let index = current.created + 1; index <= end; index += 1) {
          if (!await tx.create('users', capacityUser(index, now))
            || !await tx.create('class_memberships', capacityMembership(index, now))) {
            throw new Error('Capacity batch create conflict.');
          }
        }
        const nextClass = revisedClass(cls, now);
        const nextRun: VersionedDocument = { ...run, version: run.version + 1,
          status: end === EXTRA_STUDENTS ? 'ready' : 'applying', nextIndex: end, updatedAt: now };
        if (!await tx.replace('classes', CLASS, cls.version, nextClass)
          || !await tx.replace('migration_runs', RUN_ID, run.version, nextRun)) {
          throw new Error('Capacity cursor conflict.');
        }
        return state(nextRun, nextClass);
      });
    },
    beginRetire: async (taskId, now) => {
      requireNow(now);
      return database.runTransaction(async tx => {
        const run = await tx.get('migration_runs', RUN_ID);
        const cls = await tx.get('classes', CLASS);
        if (!run || !cls) throw new Error('Capacity run unavailable.');
        const current = state(run, cls);
        if (current.status === 'retiring' || current.status === 'retired') return current;
        if ((current.status !== 'ready' && current.status !== 'applying'
          && current.status !== 'planned') || cls.version !== expectedClassVersion(run)) {
          throw new Error('Capacity retirement precondition failed.');
        }
        if (current.status === 'ready') {
          if (!taskId) throw new Error('Recycled capacity task is required.');
          const task = await tx.get('tasks', taskId);
          const assignments = await tx.find('task_assignments', { organizationId: ORG,
            taskId, deletedAt: null });
          const targetIds = Array.isArray(task?.targetStudentIds) ? task.targetStudentIds : [];
          if (!task || task.organizationId !== ORG || task.visibility !== 'recycled'
            || targetIds.length !== 500
            || assignments.length !== 500 || !targetIds.every(id => typeof id === 'string')
            || Array.from({ length: EXTRA_STUDENTS }, (_, index) => userId(index + 1))
              .some(id => !targetIds.includes(id))) {
            throw new Error('Capacity task is not fully published and recycled.');
          }
        } else if (taskId !== null) throw new Error('Partial fixture has no capacity task.');
        const next: VersionedDocument = { ...run, version: run.version + 1,
          status: 'retiring', taskId, updatedAt: now };
        if (!await tx.replace('migration_runs', RUN_ID, run.version, next)) {
          throw new Error('Capacity retirement conflict.');
        }
        return state(next, cls);
      });
    },
    retire: async now => {
      requireNow(now);
      return database.runTransaction(async tx => {
        const run = await tx.get('migration_runs', RUN_ID);
        const cls = await tx.get('classes', CLASS);
        if (!run || !cls) throw new Error('Capacity run unavailable.');
        const current = state(run, cls);
        if (current.status === 'retired') return current;
        if (current.status !== 'retiring' || cls.version !== expectedClassVersion(run)) {
          throw new Error('Capacity retirement drift.');
        }
        const end = Math.min(current.created, current.retired + BATCH);
        for (let index = current.retired + 1; index <= end; index += 1) {
          const user = await tx.get('users', userId(index));
          const membership = await tx.get('class_memberships', membershipId(index));
          if (!user || !membership || user.version !== 1 || membership.version !== 1
            || user.status !== 'active' || membership.status !== 'active'
            || user.seedRunId !== RUN_ID || membership.seedRunId !== RUN_ID
            || membership.classId !== CLASS || membership.studentId !== user._id) {
            throw new Error('Capacity retirement target drift.');
          }
          if (!await tx.replace('users', user._id, 1,
            { ...user, version: 2, authorizationVersion: 2, status: 'disabled', updatedAt: now })
            || !await tx.replace('class_memberships', membership._id, 1,
              { ...membership, version: 2, status: 'inactive', leftAt: now, updatedAt: now })) {
            throw new Error('Capacity retirement update conflict.');
          }
        }
        const nextClass = end > current.retired ? revisedClass(cls, now) : cls;
        const nextRun: VersionedDocument = { ...run, version: run.version + 1,
          status: end === current.created ? 'retired' : 'retiring', retiredIndex: end,
          updatedAt: now };
        if (end > current.retired && !await tx.replace('classes', CLASS, cls.version, nextClass)
          || !await tx.replace('migration_runs', RUN_ID, run.version, nextRun)) {
          throw new Error('Capacity retirement cursor conflict.');
        }
        return state(nextRun, nextClass);
      });
    },
  };
}
