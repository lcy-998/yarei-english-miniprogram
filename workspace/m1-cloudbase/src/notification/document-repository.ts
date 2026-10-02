import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { hashHex } from '../shared/request-summary';
import { projectActivity } from '../activity/document-repository';
import type { NotificationFacts, NotificationRepository } from './repository';
import { NotificationError, type ActivityNoticeFact, type ScheduledNoticeRecord, type TaskNoticeFact } from './types';

export const NOTIFICATION_COLLECTIONS = {
  organizations: 'organizations', users: 'users', memberships: 'class_memberships',
  links: 'parent_student_links', grants: 'teacher_class_grants', tasks: 'tasks',
  assignments: 'task_assignments', feedback: 'review_feedback', activities: 'checkin_activities',
  readStates: 'notification_read_states',
  events: 'notification_events',
} as const;

function stateId(org: string, user: string, role: string, suffix: string): string {
  return `notification_read_${hashHex(JSON.stringify([org, user, role, suffix]))}`;
}

function active(document: VersionedDocument | null, organizationId: string): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}

function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function documentId(document: VersionedDocument): string | null { return text(document.id) ?? text(document._id); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DocumentNotificationRepository implements NotificationRepository {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async loadFacts(actor: TrustedActorContext): Promise<NotificationFacts> {
    const org = actor.organizationId;
    const organization = await this.database.get(NOTIFICATION_COLLECTIONS.organizations, org);
    const user = await this.database.get(NOTIFICATION_COLLECTIONS.users, actor.actorUserId);
    if (!active(organization, org) || organization.status !== 'active' || !active(user, org)
      || user.status !== 'active') throw new NotificationError('FORBIDDEN');
    if (actor.actorRole === 'teacher') return this.teacherFacts(actor);
    const studentIds = actor.actorRole === 'student' ? [actor.actorUserId]
      : actor.actorRole === 'parent' ? await this.parentStudentIds(actor) : null;
    if (studentIds === null) throw new NotificationError('FORBIDDEN');
    const tasks: TaskNoticeFact[] = [];
    const activities: ActivityNoticeFact[] = [];
    for (const studentId of studentIds) {
      const memberships = await this.database.find(NOTIFICATION_COLLECTIONS.memberships,
        { organizationId: org, studentId, status: 'active', deletedAt: null });
      const classIds = new Set(memberships.map(item => item.classId).filter((id): id is string => typeof id === 'string'));
      if (!classIds.size) continue;
      const assignmentDocs = await this.database.find(NOTIFICATION_COLLECTIONS.assignments,
        { organizationId: org, studentId, deletedAt: null });
      for (const assignment of assignmentDocs) {
        const taskId = text(assignment.taskId);
        const assignmentId = documentId(assignment);
        if (!classIds.has(String(assignment.classId)) || !taskId || !assignmentId) continue;
        const task = await this.database.get(NOTIFICATION_COLLECTIONS.tasks, taskId);
        const title = text(task?.title);
        const publishedAt = text(task?.publishedAt);
        const dueAt = text(task?.dueAt);
        if (!active(task, org) || !['scheduled', 'active', 'expired', 'completed'].includes(String(task.status))
          || task.visibility !== 'visible' || !publishedAt || !title || !dueAt) continue;
        const feedback = await this.database.find(NOTIFICATION_COLLECTIONS.feedback,
          { organizationId: org, assignmentId, deletedAt: null });
        tasks.push({ taskId, title, publishedAt, dueAt, studentId, assignmentStatus: String(assignment.status),
          feedback: feedback.flatMap(item => {
            const feedbackId = documentId(item);
            return feedbackId && text(item.publishedAt)
              && (item.decision === 'approved' || item.decision === 'returned')
              ? [{ id: feedbackId, publishedAt: String(item.publishedAt), decision: item.decision }] : [];
          }) });
      }
      if (actor.actorRole === 'student') {
        const activityDocs = await this.database.find(NOTIFICATION_COLLECTIONS.activities,
          { organizationId: org, deletedAt: null });
        for (const activity of activityDocs) {
          const entity = projectActivity(activity.payload);
          if (!entity || entity.organizationId !== org || entity.id !== activity._id
            || entity.version !== activity.version || (entity.status !== 'published' && entity.status !== 'closed')
            || !entity.participants.some(item => item.studentId === studentId)
            || !classIds.has(entity.schedule.classId) || !entity.publishedAt) continue;
          activities.push({ id: entity.id, title: entity.title, studentId,
            schoolTimeZone: entity.schedule.schoolTimeZone, startsOn: entity.schedule.startsOn,
            endsOn: entity.schedule.endsOn, restDates: entity.schedule.restDates,
            publishedAt: entity.publishedAt });
        }
      }
    }
    return { tasks, activities };
  }

  public async listScheduledEvents(actor: TrustedActorContext): Promise<readonly ScheduledNoticeRecord[]> {
    if (actor.actorRole !== 'student' && actor.actorRole !== 'parent') return [];
    const documents = await this.database.find(NOTIFICATION_COLLECTIONS.events, { organizationId: actor.organizationId,
      recipientUserId: actor.actorUserId, recipientRole: actor.actorRole, deletedAt: null });
    return documents.map(document => {
      const target = record(document.target) ? document.target : null;
      if (document.organizationId !== actor.organizationId || document.recipientUserId !== actor.actorUserId
        || document.recipientRole !== actor.actorRole || document.deletedAt !== null
        || (document.kind !== 'task_due' && document.kind !== 'checkin_reminder')
        || !documentId(document) || !text(document.sourceStudentId)
        || !text(document.title) || typeof document.summary !== 'string' || !text(document.occurredAt)
        || target === null
        || typeof target.id !== 'string' || !['student_task', 'parent_task', 'student_activity'].includes(String(target.kind))) {
        throw new NotificationError('SERVICE_UNAVAILABLE');
      }
      return { id: documentId(document)!, organizationId: actor.organizationId,
        recipientUserId: actor.actorUserId, recipientRole: actor.actorRole as 'student' | 'parent',
        sourceStudentId: document.sourceStudentId as string,
        kind: document.kind as 'task_due' | 'checkin_reminder', title: document.title as string,
        summary: document.summary as string, occurredAt: document.occurredAt as string,
        target: { kind: target.kind as ScheduledNoticeRecord['target']['kind'], id: target.id,
          ...(typeof target.childId === 'string' ? { childId: target.childId } : {}) },
        readAt: null };
    });
  }

  private async parentStudentIds(actor: TrustedActorContext): Promise<string[]> {
    const links = await this.database.find(NOTIFICATION_COLLECTIONS.links, { organizationId: actor.organizationId,
      parentId: actor.actorUserId, status: 'active', deletedAt: null });
    const ids: string[] = [];
    for (const link of links) {
      const studentId = text(link.studentId);
      if (!studentId) continue;
      const student = await this.database.get(NOTIFICATION_COLLECTIONS.users, studentId);
      if (active(student, actor.organizationId) && student.status === 'active') ids.push(studentId);
    }
    return [...new Set(ids)];
  }

  private async teacherFacts(actor: TrustedActorContext): Promise<NotificationFacts> {
    const org = actor.organizationId;
    if (!actor.permissions.includes('task.read')) throw new NotificationError('FORBIDDEN');
    const tasks: TaskNoticeFact[] = [];
    const docs = await this.database.find(NOTIFICATION_COLLECTIONS.tasks,
      { organizationId: org, creatorTeacherId: actor.actorUserId, deletedAt: null });
    for (const task of docs) {
      const taskId = documentId(task);
      const title = text(task.title);
      const publishedAt = text(task.publishedAt);
      const dueAt = text(task.dueAt);
      if (!taskId || !title || !publishedAt || !dueAt
        || !['scheduled', 'active', 'expired', 'completed'].includes(String(task.status))
        || task.visibility !== 'visible' || !Array.isArray(task.targetClassIds)) continue;
      let allowed = false;
      for (const classId of task.targetClassIds) {
        if (typeof classId !== 'string' || !actor.scopeIds.includes(classId)) continue;
        const grants = await this.database.find(NOTIFICATION_COLLECTIONS.grants,
          { organizationId: org, teacherId: actor.actorUserId, classId, status: 'active', deletedAt: null });
        if (grants.some(item => Array.isArray(item.permissions) && item.permissions.includes('task.read'))) {
          allowed = true; break;
        }
      }
      if (allowed) tasks.push({ taskId, title, publishedAt, dueAt, studentId: '', assignmentStatus: '', feedback: [] });
    }
    return { tasks, activities: [] };
  }

  public async getReadAt(org: string, user: string, role: string, noticeIds: readonly string[]): Promise<Readonly<Record<string, string>>> {
    const result: Record<string, string> = {};
    const documents = await this.database.find(NOTIFICATION_COLLECTIONS.readStates,
      { organizationId: org, userId: user, role, kind: 'notice', deletedAt: null });
    const wanted = new Set(noticeIds);
    for (const document of documents) {
      if (typeof document.noticeId === 'string' && wanted.has(document.noticeId)
        && typeof document.readAt === 'string') result[document.noticeId] = document.readAt;
    }
    return result;
  }

  public async getReadAllAt(org: string, user: string, role: string): Promise<string | null> {
    const current = await this.database.get(NOTIFICATION_COLLECTIONS.readStates, stateId(org, user, role, 'all'));
    return active(current, org) && current.userId === user && current.role === role
      && typeof current.readAt === 'string' ? current.readAt : null;
  }

  public async markRead(org: string, user: string, role: string, noticeId: string, at: string): Promise<string> {
    return this.write(org, user, role, noticeId, at);
  }

  public async markAllRead(org: string, user: string, role: string, at: string): Promise<string> {
    return this.write(org, user, role, 'all', at);
  }

  private async write(org: string, user: string, role: string, suffix: string, at: string): Promise<string> {
    return this.database.runTransaction(async tx => {
      const id = stateId(org, user, role, suffix);
      const existing = await tx.get(NOTIFICATION_COLLECTIONS.readStates, id);
      if (existing) {
        if (!active(existing, org) || existing.userId !== user || existing.role !== role
          || existing.kind !== (suffix === 'all' ? 'all' : 'notice')
          || existing.noticeId !== (suffix === 'all' ? null : suffix)
          || typeof existing.readAt !== 'string') throw new NotificationError('SERVICE_UNAVAILABLE');
        if (suffix === 'all' && at > existing.readAt) {
          const updated = await tx.replace(NOTIFICATION_COLLECTIONS.readStates, id, existing.version,
            { ...existing, version: existing.version + 1, readAt: at });
          if (!updated) throw new NotificationError('SERVICE_UNAVAILABLE');
          return at;
        }
        return existing.readAt;
      }
      const created = await tx.create(NOTIFICATION_COLLECTIONS.readStates, {
        _id: id, organizationId: org, schemaVersion: 1, version: 1, deletedAt: null,
        userId: user, role, kind: suffix === 'all' ? 'all' : 'notice', noticeId: suffix === 'all' ? null : suffix, readAt: at,
      });
      if (!created) throw new NotificationError('SERVICE_UNAVAILABLE');
      return at;
    });
  }
}
