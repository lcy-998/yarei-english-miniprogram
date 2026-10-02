import type { TrustedActorContext } from '../auth/trusted-actor';
import { hashHex } from '../shared/request-summary';
import type { NotificationRepository } from './repository';
import { NotificationError, type InboxNotice, type InboxPage, type NotificationKind, type NotificationTarget } from './types';

export interface NotificationClock { nowIso(): string }
export type NotificationFilter = 'all' | 'task' | 'feedback' | 'checkin';

export function eventId(organizationId: string, role: string, userId: string, kind: NotificationKind, sourceId: string): string {
  return `notice_${hashHex(JSON.stringify([organizationId, role, userId, kind, sourceId]))}`;
}

function validIso(value: string): boolean { return Number.isFinite(Date.parse(value)); }

export class NotificationService {
  public constructor(private readonly repository: NotificationRepository, private readonly clock: NotificationClock) {}

  public async list(actor: TrustedActorContext, filter: NotificationFilter, offset: number, limit: number,
    days = 30): Promise<InboxPage> {
    if (!['all', 'task', 'feedback', 'checkin'].includes(filter) || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || ![7, 30, 90].includes(days)) {
      throw new NotificationError('VALIDATION_ERROR');
    }
    const now = this.clock.nowIso();
    const visible = (await this.visible(actor, now, days));
    const readAt = await this.repository.getReadAt(actor.organizationId, actor.actorUserId, actor.actorRole,
      visible.map(item => item.id));
    const readAllAt = await this.repository.getReadAllAt(actor.organizationId, actor.actorUserId, actor.actorRole);
    const marked = visible.map(item => ({ ...item,
      readAt: readAt[item.id] ?? (readAllAt && item.occurredAt <= readAllAt ? readAllAt : null) }));
    const filtered = marked.filter(item => filter === 'all' || filter === 'task' && (item.kind === 'task_published' || item.kind === 'task_due')
      || filter === 'feedback' && (item.kind === 'task_returned' || item.kind === 'task_reviewed')
      || filter === 'checkin' && (item.kind === 'activity_published' || item.kind === 'checkin_reminder'));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length,
      unreadCount: marked.filter(item => item.readAt === null).length, hasMore: offset + limit < filtered.length };
  }

  public async markRead(actor: TrustedActorContext, noticeId: string): Promise<InboxNotice> {
    if (!/^notice_[0-9a-f]{16}$/.test(noticeId)) throw new NotificationError('VALIDATION_ERROR');
    const notice = (await this.visible(actor, this.clock.nowIso(), 90)).find(item => item.id === noticeId);
    if (!notice) throw new NotificationError('NOT_FOUND');
    const at = await this.repository.markRead(actor.organizationId, actor.actorUserId, actor.actorRole,
      noticeId, this.clock.nowIso());
    return { ...notice, readAt: at };
  }

  public async markAllRead(actor: TrustedActorContext): Promise<Readonly<{ readAt: string }>> {
    await this.visible(actor, this.clock.nowIso(), 90);
    const readAt = await this.repository.markAllRead(actor.organizationId, actor.actorUserId, actor.actorRole,
      this.clock.nowIso());
    return { readAt };
  }

  private async visible(actor: TrustedActorContext, now: string, days: number): Promise<InboxNotice[]> {
    if (!['student', 'parent', 'teacher'].includes(actor.actorRole)) throw new NotificationError('FORBIDDEN');
    const facts = await this.repository.loadFacts(actor);
    const scheduled = await this.repository.listScheduledEvents(actor);
    const output: InboxNotice[] = [];
    const put = (kind: NotificationKind, sourceId: string, title: string, summary: string,
      occurredAt: string, target: NotificationTarget) => {
      if (!validIso(occurredAt) || Date.parse(occurredAt) > Date.parse(now)) return;
      output.push({ id: eventId(actor.organizationId, actor.actorRole, actor.actorUserId, kind, sourceId),
        kind, title, summary, occurredAt, target, readAt: null });
    };
    const cutoff = Date.parse(now) - days * 86400000;
    for (const fact of facts.tasks) {
      const target = { kind: actor.actorRole === 'parent' ? 'parent_task' : actor.actorRole === 'teacher'
        ? 'teacher_task' : 'student_task', id: fact.taskId,
        ...(actor.actorRole === 'parent' ? { childId: fact.studentId } : {}) } as const;
      if (Date.parse(fact.publishedAt) >= cutoff) put('task_published', `${fact.taskId}:${fact.studentId}:${fact.publishedAt}`,
        '新任务已发布', fact.title, fact.publishedAt, target);
      for (const feedback of fact.feedback) {
        if (Date.parse(feedback.publishedAt) < cutoff) continue;
        const returned = feedback.decision === 'returned';
        put(returned ? 'task_returned' : 'task_reviewed', feedback.id,
          returned ? '任务需要重做' : '任务已点评', fact.title, feedback.publishedAt, target);
      }
    }
    if (actor.actorRole === 'student') for (const activity of facts.activities) {
      if (Date.parse(activity.publishedAt) >= cutoff) put('activity_published',
        `${activity.id}:${activity.studentId}:${activity.publishedAt}`, '新打卡活动已发布',
        activity.title, activity.publishedAt, { kind: 'student_activity', id: activity.id });
    }
    for (const event of scheduled) {
      if (Date.parse(event.occurredAt) < cutoff || Date.parse(event.occurredAt) > Date.parse(now)) continue;
      if (event.kind === 'task_due' && !facts.tasks.some(task => task.taskId === event.target.id
        && task.studentId === event.sourceStudentId)) continue;
      if (event.kind === 'checkin_reminder' && (actor.actorRole !== 'student'
        || !facts.activities.some(activity => activity.id === event.target.id
          && activity.studentId === event.sourceStudentId))) continue;
      output.push({ id: event.id, kind: event.kind, title: event.title, summary: event.summary,
        occurredAt: event.occurredAt, target: event.target, readAt: null });
    }
    return [...new Map(output.map(item => [item.id, item])).values()]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  }
}
