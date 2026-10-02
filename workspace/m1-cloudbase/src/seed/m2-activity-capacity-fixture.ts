import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';

const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const RUN_ID = 'seed_m2_activity_capacity_500_v1';
const PREVIOUS_RUN_ID = 'seed_m2_capacity_500_v1';
const EXTRA = 464;
const BASE_COUNT = 36;
const BASE_CLASS_VERSION = 95;
const BATCH = 10;
type Status = 'not_planned' | 'planned' | 'applying' | 'ready' | 'retiring' | 'retired';
export interface M2ActivityCapacityState { readonly status: Status; readonly active: number;
  readonly retired: number; readonly classVersion: number | null; readonly activityId: string | null }
function suffix(index: number): string { return String(index).padStart(4, '0'); }
function userId(index: number): string { return `usr_m2_capacity_${suffix(index)}`; }
function memberId(index: number): string { return `mem_m2_capacity_${suffix(index)}`; }
function validTime(now: string): boolean { return Number.isFinite(Date.parse(now)) && now.endsWith('Z'); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function expectedClassVersion(run: VersionedDocument): number {
  return BASE_CLASS_VERSION + Math.ceil(Number(run.nextIndex) / BATCH)
    + Math.ceil(Number(run.retiredIndex) / BATCH);
}
function state(run: VersionedDocument | null, cls: VersionedDocument | null): M2ActivityCapacityState {
  if (!run) return { status: 'not_planned', active: 0, retired: 0,
    classVersion: cls?.version ?? null, activityId: null };
  if (run._id !== RUN_ID || run.organizationId !== ORG || run.source !== 'synthetic-m2-activity-capacity'
    || !['planned', 'applying', 'ready', 'retiring', 'retired'].includes(String(run.status))
    || !Number.isSafeInteger(run.nextIndex) || !Number.isSafeInteger(run.retiredIndex)
    || Number(run.nextIndex) < 0 || Number(run.nextIndex) > EXTRA
    || Number(run.retiredIndex) < 0 || Number(run.retiredIndex) > Number(run.nextIndex)
    || run.baseClassVersion !== BASE_CLASS_VERSION) throw new Error('Activity capacity run invalid.');
  return { status: run.status as Status, active: Number(run.nextIndex),
    retired: Number(run.retiredIndex), classVersion: cls?.version ?? null,
    activityId: typeof run.activityId === 'string' ? run.activityId : null };
}
function revisedClass(cls: VersionedDocument, now: string): VersionedDocument {
  return { ...cls, version: cls.version + 1, updatedAt: now, updatedBy: 'system_m2_activity_capacity' };
}

/** Reactivates only the exact disabled M2 capacity cohort, then retires it again. */
export function createM2ActivityCapacityFixtureOperator(database: DocumentDatabasePort): Readonly<{
  inspect(): Promise<M2ActivityCapacityState>;
  plan(now: string): Promise<M2ActivityCapacityState>;
  advance(now: string): Promise<M2ActivityCapacityState>;
  beginRetire(activityId: string | null, now: string): Promise<M2ActivityCapacityState>;
  retire(now: string): Promise<M2ActivityCapacityState>;
}> {
  const requireTime = (now: string) => { if (!validTime(now)) throw new Error('Invalid activity capacity time.'); };
  return {
    inspect: async () => state(await database.get('migration_runs', RUN_ID), await database.get('classes', CLASS)),
    plan: async now => {
      requireTime(now);
      return database.runTransaction(async tx => {
        const cls = await tx.get('classes', CLASS);
        const existing = await tx.get('migration_runs', RUN_ID);
        if (existing) return state(existing, cls);
        const previous = await tx.get('migration_runs', PREVIOUS_RUN_ID);
        const active = await tx.find('class_memberships', { organizationId: ORG,
          classId: CLASS, status: 'active', deletedAt: null });
        const first = await tx.get('users', userId(1));
        const last = await tx.get('users', userId(EXTRA));
        if (!cls || cls.organizationId !== ORG || cls.status !== 'active'
          || cls.version !== BASE_CLASS_VERSION || active.length !== BASE_COUNT
          || previous?.status !== 'retired' || previous.nextIndex !== EXTRA
          || previous.retiredIndex !== EXTRA || first?.status !== 'disabled'
          || last?.status !== 'disabled' || first.version !== 2 || last.version !== 2) {
          throw new Error('Activity capacity baseline unavailable.');
        }
        const run: VersionedDocument = { _id: RUN_ID, organizationId: ORG, schemaVersion: 1,
          version: 1, deletedAt: null, source: 'synthetic-m2-activity-capacity',
          status: 'planned', baseClassVersion: BASE_CLASS_VERSION, nextIndex: 0,
          retiredIndex: 0, activityId: null, createdAt: now, updatedAt: now };
        if (!await tx.create('migration_runs', run)) throw new Error('Activity capacity run conflict.');
        return state(run, cls);
      });
    },
    advance: async now => {
      requireTime(now);
      return database.runTransaction(async tx => {
        const run = await tx.get('migration_runs', RUN_ID);
        const cls = await tx.get('classes', CLASS);
        if (!run || !cls) throw new Error('Activity capacity run unavailable.');
        const current = state(run, cls);
        if (current.status === 'ready') return current;
        if ((current.status !== 'planned' && current.status !== 'applying')
          || current.retired !== 0 || cls.version !== expectedClassVersion(run)) {
          throw new Error('Activity capacity preparation drift.');
        }
        const end = Math.min(EXTRA, current.active + BATCH);
        for (let index = current.active + 1; index <= end; index += 1) {
          const user = await tx.get('users', userId(index));
          const membership = await tx.get('class_memberships', memberId(index));
          if (!user || !membership || user.version !== 2 || membership.version !== 2
            || user.status !== 'disabled' || membership.status !== 'inactive'
            || user.seedRunId !== PREVIOUS_RUN_ID || membership.seedRunId !== PREVIOUS_RUN_ID
            || membership.studentId !== user._id || membership.classId !== CLASS) {
            throw new Error('Activity capacity reactivation target drift.');
          }
          if (!await tx.replace('users', user._id, 2,
            { ...user, version: 3, authorizationVersion: 3, status: 'active', updatedAt: now })
            || !await tx.replace('class_memberships', membership._id, 2,
              { ...membership, version: 3, status: 'active', leftAt: null, updatedAt: now })) {
            throw new Error('Activity capacity reactivation conflict.');
          }
        }
        const nextClass = revisedClass(cls, now);
        const nextRun: VersionedDocument = { ...run, version: run.version + 1,
          status: end === EXTRA ? 'ready' : 'applying', nextIndex: end, updatedAt: now };
        if (!await tx.replace('classes', CLASS, cls.version, nextClass)
          || !await tx.replace('migration_runs', RUN_ID, run.version, nextRun)) {
          throw new Error('Activity capacity cursor conflict.');
        }
        return state(nextRun, nextClass);
      });
    },
    beginRetire: async (activityId, now) => {
      requireTime(now);
      return database.runTransaction(async tx => {
        const run = await tx.get('migration_runs', RUN_ID);
        const cls = await tx.get('classes', CLASS);
        if (!run || !cls) throw new Error('Activity capacity run unavailable.');
        const current = state(run, cls);
        if (current.status === 'retiring' || current.status === 'retired') return current;
        if (!['planned', 'applying', 'ready'].includes(current.status)
          || cls.version !== expectedClassVersion(run)) throw new Error('Activity capacity retirement drift.');
        if (current.status === 'ready') {
          if (!activityId) throw new Error('Published capacity activity required.');
          const activity = await tx.get('checkin_activities', activityId);
          const payload = activity?.payload;
          const participants = record(payload) ? payload.participants : null;
          const ids = Array.isArray(participants) ? participants.map(item => record(item) ? item.studentId : null) : [];
          if (!activity || activity.organizationId !== ORG || activity.status !== 'published'
            || activity.classId !== CLASS || ids.length !== 500
            || new Set(ids).size !== 500
            || Array.from({ length: EXTRA }, (_, index) => userId(index + 1))
              .some(id => !ids.includes(id))) {
            throw new Error('Activity capacity snapshot incomplete.');
          }
        } else if (activityId !== null) throw new Error('Partial activity capacity has no published activity.');
        const next: VersionedDocument = { ...run, version: run.version + 1,
          status: 'retiring', activityId, updatedAt: now };
        if (!await tx.replace('migration_runs', RUN_ID, run.version, next)) {
          throw new Error('Activity capacity retirement conflict.');
        }
        return state(next, cls);
      });
    },
    retire: async now => {
      requireTime(now);
      return database.runTransaction(async tx => {
        const run = await tx.get('migration_runs', RUN_ID);
        const cls = await tx.get('classes', CLASS);
        if (!run || !cls) throw new Error('Activity capacity run unavailable.');
        const current = state(run, cls);
        if (current.status === 'retired') return current;
        if (current.status !== 'retiring' || cls.version !== expectedClassVersion(run)) {
          throw new Error('Activity capacity retirement drift.');
        }
        const end = Math.min(current.active, current.retired + BATCH);
        for (let index = current.retired + 1; index <= end; index += 1) {
          const user = await tx.get('users', userId(index));
          const membership = await tx.get('class_memberships', memberId(index));
          if (!user || !membership || user.version !== 3 || membership.version !== 3
            || user.status !== 'active' || membership.status !== 'active'
            || user.seedRunId !== PREVIOUS_RUN_ID || membership.seedRunId !== PREVIOUS_RUN_ID) {
            throw new Error('Activity capacity retirement target drift.');
          }
          if (!await tx.replace('users', user._id, 3,
            { ...user, version: 4, authorizationVersion: 4, status: 'disabled', updatedAt: now })
            || !await tx.replace('class_memberships', membership._id, 3,
              { ...membership, version: 4, status: 'inactive', leftAt: now, updatedAt: now })) {
            throw new Error('Activity capacity retirement update conflict.');
          }
        }
        const nextClass = end > current.retired ? revisedClass(cls, now) : cls;
        const nextRun: VersionedDocument = { ...run, version: run.version + 1,
          status: end === current.active ? 'retired' : 'retiring', retiredIndex: end,
          updatedAt: now };
        if (end > current.retired && !await tx.replace('classes', CLASS, cls.version, nextClass)
          || !await tx.replace('migration_runs', RUN_ID, run.version, nextRun)) {
          throw new Error('Activity capacity retirement cursor conflict.');
        }
        return state(nextRun, nextClass);
      });
    },
  };
}
