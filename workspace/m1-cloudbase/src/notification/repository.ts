import type { TrustedActorContext } from '../auth/trusted-actor';
import type { ActivityNoticeFact, ScheduledNoticeRecord, TaskNoticeFact } from './types';

export interface NotificationFacts {
  readonly tasks: readonly TaskNoticeFact[];
  readonly activities: readonly ActivityNoticeFact[];
}

export interface NotificationRepository {
  /** Recheck active account, parent binding and student class membership on every request. */
  loadFacts(actor: TrustedActorContext): Promise<NotificationFacts>;
  listScheduledEvents(actor: TrustedActorContext): Promise<readonly ScheduledNoticeRecord[]>;
  getReadAt(organizationId: string, userId: string, role: string, noticeIds: readonly string[]): Promise<Readonly<Record<string, string>>>;
  getReadAllAt(organizationId: string, userId: string, role: string): Promise<string | null>;
  markRead(organizationId: string, userId: string, role: string, noticeId: string, at: string): Promise<string>;
  markAllRead(organizationId: string, userId: string, role: string, at: string): Promise<string>;
}
