import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { ActivityService } from '../activity/activity-service';
import { DocumentActivityRepository, projectActivity } from '../activity/document-repository';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { eventId } from './service';
import type { ScheduledNoticeRecord } from './types';

export interface MaintenanceReport {
  readonly scannedOrganizations: number;
  readonly scannedTasks: number;
  readonly scannedActivities: number;
  readonly createdDueReminders: number;
  readonly createdCheckinReminders: number;
  readonly finalizedActivities: number;
  readonly pendingRecoveryActivities: number;
}

interface ScanCursor {
  readonly organizationOffset: number;
  readonly taskOffset: number;
  readonly activityOffset: number;
  readonly tasksDone: boolean;
  readonly activitiesDone: boolean;
  readonly version: number;
}
const SCAN_COLLECTION = 'maintenance_scan_state';
const SCAN_ID = 'maintenance_scan_v1';
const PAGE_SIZE = 25;
const FINALIZATION_PAGES_PER_TICK = 4;

function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function localParts(at: string, timeZone: string): Readonly<{ date: string; hour: number; minute: number }> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const part = (name: string): string => parts.find(item => item.type === name)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')),
    minute: Number(part('minute')) };
}
function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
function previousDay(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
function active(document: VersionedDocument | null, org: string): document is VersionedDocument {
  return document !== null && document.organizationId === org && document.deletedAt === null;
}

/** No caller identity or organization ID comes from a timer event. */
export class NotificationMaintenance {
  private readonly activity: Pick<ActivityService, 'getMyDay' | 'finalizeActivity'>;
  public constructor(private readonly database: DocumentDatabasePort, private readonly clock: { nowIso(): string },
    identifiers: { next(prefix: string): string }, activityOverride?: Pick<ActivityService, 'getMyDay' | 'finalizeActivity'>) {
    this.activity = activityOverride ?? new ActivityService(new DocumentActivityRepository(database), clock, identifiers);
  }

  public async run(): Promise<MaintenanceReport> {
    const now = this.clock.nowIso();
    const cursor = await this.loadCursor();
    let organizationOffset = cursor.organizationOffset;
    let organizationPage = await this.database.findPage('organizations', { status: 'active', deletedAt: null },
      { limit: 1, offset: organizationOffset });
    if (!organizationPage.items.length && organizationOffset > 0) {
      organizationOffset = 0;
      organizationPage = await this.database.findPage('organizations', { status: 'active', deletedAt: null },
        { limit: 1, offset: 0 });
    }
    const organization = organizationPage.items[0];
    if (!organization) return { scannedOrganizations: 0, scannedTasks: 0, scannedActivities: 0,
      createdDueReminders: 0, createdCheckinReminders: 0, finalizedActivities: 0,
      pendingRecoveryActivities: 0 };
    const org = organization._id;
    if (organization.organizationId !== org || !text(organization.timeZone)) throw new Error('Invalid organization');
    const reset = organizationOffset !== cursor.organizationOffset;
    const taskOffset = reset ? 0 : cursor.taskOffset;
    const activityOffset = reset ? 0 : cursor.activityOffset;
    const tasksDone = reset ? false : cursor.tasksDone;
    const activitiesDone = reset ? false : cursor.activitiesDone;
    const tasks = tasksDone ? { items: [] as readonly VersionedDocument[], hasMore: false }
      : await this.database.findPage('tasks', { organizationId: org, deletedAt: null },
        { limit: PAGE_SIZE, offset: taskOffset });
    const activities = activitiesDone ? { items: [] as readonly VersionedDocument[], hasMore: false }
      : await this.database.findPage('checkin_activities', { organizationId: org, deletedAt: null },
        { limit: PAGE_SIZE, offset: activityOffset });
    let due = 0;
    let checkin = 0;
    let finalized = 0;
    let pending = 0;
    const priority = await this.scanDueFinalizations(org,
      previousDay(localParts(now, String(organization.timeZone)).date), now);
    const processed = priority.processed;
    checkin += priority.reminders;
    finalized += priority.finalized;
    pending += priority.pending;
    for (const task of tasks.items) due += await this.processDueTask(org, task, now);
    for (const activity of activities.items) {
      if (processed.has(activity._id)) continue;
      const result = await this.processActivity(org, activity, now);
      checkin += result.reminders;
      finalized += result.finalized;
      pending += result.pending;
    }
    const nextTasksDone = tasksDone || !tasks.hasMore;
    const nextActivitiesDone = activitiesDone || !activities.hasMore;
    await this.saveCursor(cursor, nextTasksDone && nextActivitiesDone
      ? { organizationOffset: organizationOffset + 1, taskOffset: 0, activityOffset: 0,
          tasksDone: false, activitiesDone: false, version: cursor.version + 1 }
      : { organizationOffset, taskOffset: nextTasksDone ? taskOffset : taskOffset + tasks.items.length,
          activityOffset: nextActivitiesDone ? activityOffset : activityOffset + activities.items.length,
          tasksDone: nextTasksDone, activitiesDone: nextActivitiesDone, version: cursor.version + 1 });
    return { scannedOrganizations: 1, scannedTasks: tasks.items.length,
      scannedActivities: processed.size + activities.items.filter(item => !processed.has(item._id)).length,
      createdDueReminders: due,
      createdCheckinReminders: checkin, finalizedActivities: finalized, pendingRecoveryActivities: pending };
  }

  /** The ending-day index is scanned ahead of the general cursor so a busy organization cannot miss midnight. */
  private async scanDueFinalizations(org: string, endsOn: string, now: string): Promise<Readonly<{
    processed: Set<string>; reminders: number; finalized: number; pending: number }>> {
    const id = `maintenance_finalization:${org}:${endsOn}`;
    const state = await this.database.get(SCAN_COLLECTION, id);
    if (state && (state.organizationId !== org || state.deletedAt !== null
      || !Number.isSafeInteger(state.offset) || Number(state.offset) < 0)) throw new Error('Invalid finalization cursor');
    let offset = state ? Number(state.offset) : 0;
    let cursorVersion = state?.version ?? 0;
    const processed = new Set<string>();
    let reminders = 0;
    let finalized = 0;
    let pending = 0;
    for (let page = 0; page < FINALIZATION_PAGES_PER_TICK; page += 1) {
      const next = await this.database.findPage('checkin_activities', { organizationId: org,
        endsOn, deletedAt: null }, { limit: PAGE_SIZE, offset });
      if (!next.items.length && !state && page === 0) break;
      if (!next.items.length) {
        await this.saveFinalizationCursor(org, id, endsOn, cursorVersion, 0);
        break;
      }
      const pageOffset = offset;
      for (const [index, activity] of next.items.entries()) {
        const result = await this.processActivity(org, activity, now);
        processed.add(activity._id);
        reminders += result.reminders;
        finalized += result.finalized;
        pending += result.pending;
        offset = !next.hasMore && index === next.items.length - 1 ? 0 : pageOffset + index + 1;
        await this.saveFinalizationCursor(org, id, endsOn, cursorVersion, offset);
        cursorVersion += 1;
      }
      if (!next.hasMore) break;
    }
    return { processed, reminders, finalized, pending };
  }

  private async saveFinalizationCursor(org: string, id: string, endsOn: string,
    expectedVersion: number, offset: number): Promise<void> {
    await this.database.runTransaction(async tx => {
      const existing = await tx.get(SCAN_COLLECTION, id);
      if ((existing?.version ?? 0) !== expectedVersion) throw new Error('Concurrent finalization scan');
      const document = { _id: id, organizationId: org, schemaVersion: 1 as const,
        version: expectedVersion + 1, deletedAt: null, endsOn, offset };
      const saved = existing ? await tx.replace(SCAN_COLLECTION, id, existing.version, document)
        : await tx.create(SCAN_COLLECTION, document);
      if (!saved) throw new Error('Finalization scan cursor conflict');
    });
  }

  private async loadCursor(): Promise<ScanCursor> {
    const state = await this.database.get(SCAN_COLLECTION, SCAN_ID);
    if (!state) return { organizationOffset: 0, taskOffset: 0, activityOffset: 0,
      tasksDone: false, activitiesDone: false, version: 0 };
    if (state.organizationId !== 'org_maintenance' || state.deletedAt !== null
      || !Number.isSafeInteger(state.organizationOffset) || Number(state.organizationOffset) < 0
      || !Number.isSafeInteger(state.taskOffset) || Number(state.taskOffset) < 0
      || !Number.isSafeInteger(state.activityOffset) || Number(state.activityOffset) < 0
      || typeof state.tasksDone !== 'boolean' || typeof state.activitiesDone !== 'boolean') {
      throw new Error('Invalid maintenance scan cursor');
    }
    return { organizationOffset: Number(state.organizationOffset), taskOffset: Number(state.taskOffset),
      activityOffset: Number(state.activityOffset), tasksDone: state.tasksDone,
      activitiesDone: state.activitiesDone, version: state.version };
  }

  private async saveCursor(previous: ScanCursor, next: ScanCursor): Promise<void> {
    await this.database.runTransaction(async tx => {
      const existing = await tx.get(SCAN_COLLECTION, SCAN_ID);
      if ((existing?.version ?? 0) !== previous.version) throw new Error('Concurrent maintenance scan');
      const document = { _id: SCAN_ID, organizationId: 'org_maintenance', schemaVersion: 1 as const,
        version: next.version, deletedAt: null, organizationOffset: next.organizationOffset,
        taskOffset: next.taskOffset, activityOffset: next.activityOffset,
        tasksDone: next.tasksDone, activitiesDone: next.activitiesDone };
      const saved = previous.version === 0
        ? await tx.create(SCAN_COLLECTION, document)
        : await tx.replace(SCAN_COLLECTION, SCAN_ID, previous.version, document);
      if (!saved) throw new Error('Maintenance scan cursor conflict');
    });
  }

  private async processDueTask(org: string, task: VersionedDocument, now: string): Promise<number> {
    const taskId = text(task.id) ?? text(task._id);
    const dueAt = text(task.dueAt);
    const title = text(task.title);
    const publishedAt = text(task.publishedAt);
    if (!taskId || !dueAt || !title || !publishedAt || task.visibility !== 'visible'
      || !['scheduled', 'active'].includes(String(task.status))) return 0;
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due) || !Number.isFinite(Date.parse(publishedAt))
      || Date.parse(publishedAt) > Date.parse(now)
      || Date.parse(now) < due - 86400000 || Date.parse(now) >= due) return 0;
    const assignments = await this.database.find('task_assignments', { organizationId: org, taskId, deletedAt: null });
    let created = 0;
    for (const assignment of assignments) {
      const studentId = text(assignment.studentId);
      const classId = text(assignment.classId);
      if (!studentId || !classId || ['awaiting_review', 'completed'].includes(String(assignment.status))) continue;
      if (!await this.activeStudentInClass(org, studentId, classId)) continue;
      const sourceId = `${taskId}:${studentId}:${dueAt}`;
      const occurrence = now;
      if (await this.createEvent({ organizationId: org, recipientUserId: studentId, recipientRole: 'student',
        sourceStudentId: studentId, id: eventId(org, 'student', studentId, 'task_due', sourceId),
        kind: 'task_due', title: '任务即将截止', summary: title, occurredAt: occurrence,
        target: { kind: 'student_task', id: taskId }, readAt: null })) created++;
      const links = await this.database.find('parent_student_links', { organizationId: org, studentId,
        status: 'active', deletedAt: null });
      for (const link of links) {
        const parentId = text(link.parentId);
        if (!parentId) continue;
        const parent = await this.database.get('users', parentId);
        if (!active(parent, org) || parent.status !== 'active') continue;
        if (await this.createEvent({ organizationId: org, recipientUserId: parentId, recipientRole: 'parent',
          sourceStudentId: studentId, id: eventId(org, 'parent', parentId, 'task_due', sourceId),
          kind: 'task_due', title: '孩子任务即将截止', summary: title, occurredAt: occurrence,
          target: { kind: 'parent_task', id: taskId, childId: studentId }, readAt: null })) created++;
      }
    }
    return created;
  }

  private async processActivity(org: string, activity: VersionedDocument,
    now: string): Promise<Readonly<{ reminders: number; finalized: number; pending: number }>> {
    const zero = { reminders: 0, finalized: 0, pending: 0 };
    const entity = projectActivity(activity.payload);
    if (!entity || entity.id !== activity._id || entity.organizationId !== org
      || entity.version !== activity.version || entity.status !== activity.status
      || entity.schedule.classId !== activity.classId) return zero;
    if ((entity.status !== 'published' && entity.status !== 'closed') || entity.publishedAt === null) return zero;
    const activityId = entity.id;
    const title = entity.title;
    const { schoolTimeZone: timeZone, classId, startsOn, endsOn, restDates } = entity.schedule;
    const local = localParts(now, timeZone);
    if (local.date > endsOn) {
      const existing = await this.database.get('checkin_final_boards', `activity_final_${activityId}`);
      if (existing && existing.organizationId === org && existing.deletedAt === null) {
        await this.resolveRecovery(org, activityId, now);
        return zero;
      }
      if (local.date === nextDay(endsOn) && local.hour === 0 && local.minute <= 5) {
        try {
          await this.activity.finalizeActivity(org, activityId);
          await this.resolveRecovery(org, activityId, now);
          return { ...zero, finalized: 1 };
        }
        catch { return { ...zero, pending: await this.recordRecovery(org, activityId, now, 'finalization_failed') ? 1 : 0 }; }
      }
      return { ...zero, pending: await this.recordRecovery(org, activityId, now, 'window_missed') ? 1 : 0 };
    }
    if (entity.status !== 'published' || local.date < startsOn || restDates.includes(local.date)
      || local.hour < 20) return zero;
    const activeStudents = await this.activeStudentsForClass(org, classId);
    let created = 0;
    for (const participant of entity.participants) {
      const studentId = participant.studentId;
      if (!activeStudents.has(studentId)) continue;
      const actor: TrustedActorContext = { actorRole: 'student', actorUserId: studentId,
        organizationId: org, requestId: `maintenance:${activityId}:${local.date}`, sessionId: 'server-maintenance',
        platformSubjectDigest: 'server-maintenance', permissions: [], scopeIds: [], authzVersion: 1 };
      let complete: boolean | null;
      try { complete = (await this.activity.getMyDay(actor, activityId, local.date)).complete; }
      catch { continue; }
      if (complete !== false) continue;
      if (await this.createEvent({ organizationId: org, recipientUserId: studentId, recipientRole: 'student',
        sourceStudentId: studentId, id: eventId(org, 'student', studentId, 'checkin_reminder', `${activityId}:${local.date}`),
        kind: 'checkin_reminder', title: '今日打卡提醒', summary: title,
        occurredAt: now, target: { kind: 'student_activity', id: activityId }, readAt: null })) created++;
    }
    return { ...zero, reminders: created };
  }

  private async activeStudentsForClass(org: string, classId: string): Promise<ReadonlySet<string>> {
    const [memberships, users] = await Promise.all([
      this.database.find('class_memberships', { organizationId: org, classId,
        status: 'active', deletedAt: null }),
      this.database.find('users', { organizationId: org, status: 'active', deletedAt: null }),
    ]);
    const activeUsers = new Set(users.filter(user => active(user, org) && user.status === 'active')
      .map(user => user._id));
    return new Set(memberships.filter(member => active(member, org)
      && member.status === 'active' && typeof member.studentId === 'string'
      && activeUsers.has(member.studentId)).map(member => String(member.studentId)));
  }

  private async activeStudentInClass(org: string, studentId: string, classId: string): Promise<boolean> {
    const user = await this.database.get('users', studentId);
    if (!active(user, org) || user.status !== 'active') return false;
    const memberships = await this.database.find('class_memberships', { organizationId: org, studentId,
      classId, status: 'active', deletedAt: null });
    return memberships.length > 0;
  }

  private async createEvent(event: ScheduledNoticeRecord): Promise<boolean> {
    return this.database.runTransaction(async tx => {
      const existing = await tx.get('notification_events', event.id);
      if (existing) return false;
      return tx.create('notification_events', { _id: event.id, organizationId: event.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, id: event.id, recipientUserId: event.recipientUserId,
        recipientRole: event.recipientRole, sourceStudentId: event.sourceStudentId, kind: event.kind,
        title: event.title, summary: event.summary, occurredAt: event.occurredAt, target: event.target });
    });
  }

  private async recordRecovery(org: string, activityId: string, detectedAt: string, reason: string): Promise<boolean> {
    return this.database.runTransaction(async tx => {
      const id = `activity_recovery:${org}:${activityId}`;
      if (await tx.get('checkin_finalization_recovery', id)) return false;
      return tx.create('checkin_finalization_recovery', { _id: id, organizationId: org,
        schemaVersion: 1, version: 1, deletedAt: null, activityId, status: 'pending', reason, detectedAt });
    });
  }

  private async resolveRecovery(org: string, activityId: string, resolvedAt: string): Promise<void> {
    await this.database.runTransaction(async tx => {
      const id = `activity_recovery:${org}:${activityId}`;
      const existing = await tx.get('checkin_finalization_recovery', id);
      if (!existing || existing.status === 'resolved') return;
      if (existing.organizationId !== org || existing.deletedAt !== null) throw new Error('Invalid recovery record');
      const saved = await tx.replace('checkin_finalization_recovery', id, existing.version,
        { ...existing, version: existing.version + 1, status: 'resolved', resolvedAt });
      if (!saved) throw new Error('Recovery state conflict');
    });
  }
}
