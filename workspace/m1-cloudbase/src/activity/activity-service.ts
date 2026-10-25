import type { TrustedActorContext } from '../auth/trusted-actor';
import { activityDays, isEffectiveActivityDay, localDateAt, rankActivity, validateActivitySchedule,
  type ActivityDailyRecord, type ActivityLeaderboard, type ActivityParticipant, type ActivitySchedule,
  type DailyCondition, type DailyEvidence, type TeacherCheckInOverride } from '../task-core/activity-rules';
import { exerciseEvidenceFromSubmission, exerciseSubmissionNeedsReview, readingEvidenceFromPageEvents, vocabularyEvidenceFromAttempts, workEvidenceFromStudentWork } from './activity-evidence';
import type { ActivityTransaction, ActivityUnitOfWork } from './repository';
import { ActivityError, type ActivityConditionSnapshot, type ActivityDayView, type ActivityDraftInput,
  type ActivityExerciseOpportunity,
  type ActivityEntity, type ActivityFinalSnapshot, type ActivityLeaderboardView, type ActivityOperationReceipt, type ActivityOverrideRecord,
  type ActivityOverrideState, type TeacherActivityProgressView, type VerifiedActivityDayPage } from './types';

export interface ActivityClock { nowIso(): string }
export interface ActivityIds { next(prefix: string): string }

// Keep the whole published activity, including its dated occurrences and roster, below the
// CloudBase single-response budget with ample space for document metadata and later versions.
const MAX_ACTIVITY_SNAPSHOT_BYTES = 1_000_000;
const MAX_FINAL_CONDITION_DETAIL_BYTES = 400_000;

function finalConditionDetails(statuses: Readonly<Record<string, readonly boolean[]>>):
  Pick<ActivityFinalSnapshot, 'conditionDetailComplete' | 'conditionStatusByStudentDay'> {
  const partial = Object.fromEntries(Object.entries(statuses)
    .filter(([_key, values]) => values.some(Boolean) && values.some(value => !value)));
  return Buffer.byteLength(JSON.stringify(partial), 'utf8') <= MAX_FINAL_CONDITION_DETAIL_BYTES
    ? { conditionDetailComplete: true, conditionStatusByStudentDay: partial } : {};
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function operationKeyValid(operationId: string, expectedVersion: number): boolean {
  return operationId.trim().length >= 8 && Number.isSafeInteger(expectedVersion) && expectedVersion >= 0;
}

function payloadFingerprint(value: object): string { return JSON.stringify(value); }

function validLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function activityHasEnded(nowIso: string, timeZone: string, endsOn: string): boolean {
  return localDateAt(nowIso, timeZone) > endsOn;
}

function exerciseDaysAreReachable(days: readonly string[], participants: readonly ActivityParticipant[],
  opportunities: readonly ActivityExerciseOpportunity[], contentVersion: string,
  timeZone: string, nowIso: string): boolean {
  for (const participant of participants) {
    const usable = opportunities.filter(entry => entry.resourceVersion === contentVersion
      && entry.studentIds.includes(participant.studentId)
      && Date.parse(entry.dueAt) + entry.lateDays * 86400000 > Date.parse(nowIso));
    const assigned = new Map<string, string>();
    const match = (day: string, visited: Set<string>): boolean => {
      for (const task of usable) {
        const deadline = Date.parse(task.dueAt) + task.lateDays * 86400000;
        const lastDate = localDateAt(new Date(deadline - 1).toISOString(), timeZone);
        if (Date.parse(task.startsAt) >= deadline || localDateAt(task.startsAt, timeZone) > day
          || lastDate < day || visited.has(task.taskId)) continue;
        visited.add(task.taskId);
        const priorDay = assigned.get(task.taskId);
        if (!priorDay || match(priorDay, visited)) { assigned.set(task.taskId, day); return true; }
      }
      return false;
    };
    if (days.some(day => !match(day, new Set<string>()))) return false;
  }
  return true;
}

function normalizedCondition(value: unknown): DailyCondition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const condition = value as Record<string, unknown>;
  if (typeof condition.resourceId !== 'string' || !condition.resourceId.trim()) return null;
  const allowed = condition.kind === 'reading' || condition.kind === 'work'
    ? ['kind', 'resourceId'] : condition.kind === 'vocabulary'
      ? ['kind', 'resourceId', 'requiredWordCount'] : condition.kind === 'exercise'
        ? ['kind', 'resourceId', 'minimumScore'] : null;
  if (allowed === null || Object.keys(condition).some(key => !allowed.includes(key))) return null;
  if (condition.kind === 'reading') return { kind: 'reading', resourceId: condition.resourceId };
  if (condition.kind === 'work') return { kind: 'work', resourceId: condition.resourceId };
  if (condition.kind === 'vocabulary' && Number.isSafeInteger(condition.requiredWordCount)
    && Number(condition.requiredWordCount) > 0) return { kind: 'vocabulary', resourceId: condition.resourceId,
      requiredWordCount: Number(condition.requiredWordCount) };
  if (condition.kind === 'exercise' && typeof condition.minimumScore === 'number'
    && Number.isFinite(condition.minimumScore) && condition.minimumScore >= 0 && condition.minimumScore <= 100) {
    return { kind: 'exercise', resourceId: condition.resourceId, minimumScore: condition.minimumScore };
  }
  return null;
}

export class ActivityService {
  public constructor(private readonly repository: ActivityUnitOfWork, private readonly clock: ActivityClock,
    private readonly ids: ActivityIds) {}

  public async saveDraft(actor: TrustedActorContext, input: ActivityDraftInput, expectedVersion: number,
    operationId: string): Promise<ActivityEntity> {
    if (!operationKeyValid(operationId, expectedVersion)) throw new ActivityError('VALIDATION_ERROR');
    if (typeof input.title !== 'string' || (input.description !== undefined && typeof input.description !== 'string')
      || typeof input.classId !== 'string' || !Array.isArray(input.restDates) || !Array.isArray(input.conditions)) {
      throw new ActivityError('VALIDATION_ERROR');
    }
    const title = input.title.trim();
    const description = input.description?.trim() ?? '';
    const conditions = input.conditions.map(normalizedCondition);
    if (!title || title.length > 50 || description.length > 300 || !input.classId.trim()
      || conditions.some(condition => condition === null)) throw new ActivityError('VALIDATION_ERROR');
    const validConditions = conditions.filter((condition): condition is DailyCondition => condition !== null);
    if (new Set(validConditions.map(condition => JSON.stringify(condition))).size !== validConditions.length) {
      throw new ActivityError('VALIDATION_ERROR');
    }
    const fingerprint = payloadFingerprint({ activityId: input.activityId ?? null, title, description,
      classId: input.classId, startsOn: input.startsOn, endsOn: input.endsOn,
      restDates: input.restDates, conditions: validConditions, expectedVersion });
    return this.repository.transaction(async (transaction) => {
      const schoolTimeZone = await this.authorizeTeacher(transaction, actor, input.classId);
      const schedule: ActivitySchedule = { classId: input.classId, startsOn: input.startsOn, endsOn: input.endsOn,
        restDates: [...input.restDates], conditions: validConditions, schoolTimeZone };
      if (!validateActivitySchedule(schedule)) throw new ActivityError('VALIDATION_ERROR');
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, 'saveDraft', operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      const existing = input.activityId ? await transaction.findActivity(actor.organizationId, input.activityId) : null;
      if (input.activityId && !existing) throw new ActivityError('NOT_FOUND');
      if (existing && (existing.creatorTeacherId !== actor.actorUserId || existing.status !== 'draft'
        || existing.schedule.classId !== input.classId)) throw new ActivityError('FORBIDDEN');
      if ((existing?.version ?? 0) !== expectedVersion) throw new ActivityError('CONFLICT');
      const now = this.clock.nowIso();
      const activity: ActivityEntity = { id: existing?.id ?? this.ids.next('activity'), organizationId: actor.organizationId,
        creatorTeacherId: actor.actorUserId, title, description, schedule, status: 'draft', participants: [], conditionSnapshots: [],
        dailyInstances: [], restDayChanges: [],
        version: expectedVersion + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
        publishedAt: null, closedAt: null };
      if (!await transaction.saveActivity(activity, expectedVersion)) throw new ActivityError('CONFLICT');
      await this.receipt(transaction, actor, 'saveDraft', operationId, fingerprint, activity);
      return clone(activity);
    });
  }

  public async publish(actor: TrustedActorContext, activityId: string, expectedVersion: number,
    operationId: string): Promise<ActivityEntity> {
    if (!activityId.trim() || !operationKeyValid(operationId, expectedVersion)) throw new ActivityError('VALIDATION_ERROR');
    const fingerprint = payloadFingerprint({ activityId, expectedVersion });
    return this.repository.transaction(async (transaction) => {
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity) throw new ActivityError('NOT_FOUND');
      const schoolTimeZone = await this.authorizeTeacher(transaction, actor, activity.schedule.classId);
      if (activity.creatorTeacherId !== actor.actorUserId) throw new ActivityError('FORBIDDEN');
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, 'publish', operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      if (activity.status !== 'draft' || activity.version !== expectedVersion) throw new ActivityError('CONFLICT');
      const schedule = { ...activity.schedule, schoolTimeZone };
      if (!validateActivitySchedule(schedule)) throw new ActivityError('VALIDATION_ERROR');
      const conditionSnapshots: ActivityConditionSnapshot[] = [];
      for (const condition of schedule.conditions) {
        const resource = await transaction.findConditionResource(actor.organizationId, condition.resourceId);
        if (!resource || resource.status !== 'published' || resource.type !== condition.kind
          || !resource.contentVersion.trim()
          || (resource.visibility.type === 'classes' && !resource.visibility.classIds.includes(schedule.classId))) {
          throw new ActivityError('RESOURCE_OFFLINE');
        }
        if (condition.kind === 'reading' && (!resource.pageIds?.length
          || new Set(resource.pageIds).size !== resource.pageIds.length)) throw new ActivityError('RESOURCE_OFFLINE');
        if (condition.kind === 'vocabulary' && (!resource.wordIds?.length
          || new Set(resource.wordIds).size !== resource.wordIds.length
          || condition.requiredWordCount > resource.wordIds.length)) throw new ActivityError('RESOURCE_OFFLINE');
        if (condition.kind === 'exercise' && (!resource.questionIds?.length
          || !resource.questionIds.includes(condition.resourceId))) throw new ActivityError('RESOURCE_OFFLINE');
        conditionSnapshots.push({ kind: condition.kind, resourceId: condition.resourceId,
          contentVersion: resource.contentVersion,
          ...(condition.kind === 'reading' ? { pageIds: [...resource.pageIds!] } : {}),
          ...(condition.kind === 'vocabulary' ? { wordIds: [...resource.wordIds!] } : {}),
          ...(condition.kind === 'exercise' ? { questionIds: [...resource.questionIds!] } : {}) });
      }
      const memberships = await transaction.listClassMemberships(actor.organizationId, schedule.classId);
      const activeUsers = new Map((await transaction.listActiveUsers(actor.organizationId))
        .map(user => [user.id, user]));
      const participants: ActivityParticipant[] = [];
      const seen = new Set<string>();
      for (const membership of memberships) {
        if (seen.has(membership.studentId)) continue;
        const student = activeUsers.get(membership.studentId);
        if (student?.status !== 'active' || !student.displayNameMasked.trim()) continue;
        seen.add(student.id);
        participants.push({ studentId: student.id, displayNameMasked: student.displayNameMasked });
      }
      if (!participants.length) throw new ActivityError('VALIDATION_ERROR');
      const effectiveDays = activityDays(schedule);
      const now = this.clock.nowIso();
      for (const [index, condition] of schedule.conditions.entries()) {
        if (condition.kind !== 'exercise') continue;
        const snapshot = conditionSnapshots[index]!;
        const opportunities = await transaction.listExerciseOpportunities(actor.organizationId,
          schedule.classId, condition.resourceId);
        if (!exerciseDaysAreReachable(effectiveDays, participants, opportunities,
          snapshot.contentVersion, schedule.schoolTimeZone, now)) throw new ActivityError('RESOURCE_OFFLINE');
      }
      const calendarDays = Math.floor((Date.parse(`${schedule.endsOn}T00:00:00.000Z`)
        - Date.parse(`${schedule.startsOn}T00:00:00.000Z`)) / 86400000) + 1;
      const instanceSample = { id: `${activity.id}:${schedule.startsOn}`, date: schedule.startsOn,
        classId: schedule.classId, activityVersion: activity.version + 1, createdAt: now };
      const baseBytes = Buffer.byteLength(JSON.stringify({ ...activity, schedule, participants,
        conditionSnapshots, status: 'published', publishedAt: now }), 'utf8');
      const instanceBytes = Buffer.byteLength(JSON.stringify(instanceSample), 'utf8') + 1;
      if (baseBytes + (calendarDays - schedule.restDates.length) * instanceBytes > MAX_ACTIVITY_SNAPSHOT_BYTES) {
        throw new ActivityError('VALIDATION_ERROR');
      }
      const dailyInstances = activityDays(schedule).map(date => ({ id: `${activity.id}:${date}`, date,
        classId: schedule.classId, activityVersion: activity.version + 1, createdAt: now }));
      const published: ActivityEntity = { ...activity, schedule, status: 'published', participants, conditionSnapshots,
        dailyInstances, restDayChanges: [],
        version: activity.version + 1, updatedAt: now, publishedAt: now };
      if (Buffer.byteLength(JSON.stringify(published), 'utf8') > MAX_ACTIVITY_SNAPSHOT_BYTES) {
        throw new ActivityError('VALIDATION_ERROR');
      }
      if (!await transaction.saveActivity(published, expectedVersion)) throw new ActivityError('CONFLICT');
      await this.receipt(transaction, actor, 'publish', operationId, fingerprint, published);
      return clone(published);
    });
  }

  public async close(actor: TrustedActorContext, activityId: string, expectedVersion: number,
    reason: string, operationId: string): Promise<ActivityEntity> {
    if (!activityId.trim() || !operationKeyValid(operationId, expectedVersion)
      || !reason.trim() || reason.length > 200) throw new ActivityError('VALIDATION_ERROR');
    const cleanReason = reason.trim();
    const fingerprint = payloadFingerprint({ activityId, expectedVersion, reason: cleanReason });
    return this.repository.transaction(async transaction => {
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity || activity.publishedAt === null) throw new ActivityError('NOT_FOUND');
      await this.authorizeTeacher(transaction, actor, activity.schedule.classId);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, 'close', operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      if (activity.status !== 'published' || activity.version !== expectedVersion) throw new ActivityError('CONFLICT');
      const now = this.clock.nowIso();
      const schoolToday = localDateAt(now, activity.schedule.schoolTimeZone);
      if (schoolToday < activity.schedule.startsOn) throw new ActivityError('CONFLICT');
      const cutoff = schoolToday < activity.schedule.endsOn ? schoolToday : activity.schedule.endsOn;
      const existing = await transaction.findFinalSnapshot(actor.organizationId, activityId);
      if (!existing) {
        const calculated = await this.calculateLeaderboard(transaction, activity, now, cutoff);
        if (calculated.pendingManualSubmissionIds.length) throw new ActivityError('ACTIVITY_PENDING_REVIEW');
        const final: ActivityFinalSnapshot = { organizationId: actor.organizationId, activityId,
          activityVersion: expectedVersion + 1, lockedAt: now,
          leaderboard: { ...calculated.leaderboard, finalized: true },
          completedDatesByStudent: calculated.completedDatesByStudent,
          supplementedDatesByStudent: calculated.supplementedDatesByStudent,
          ...finalConditionDetails(calculated.conditionStatusByStudentDay) };
        if (!await transaction.createFinalSnapshot(final)) throw new ActivityError('CONFLICT');
      }
      const closed: ActivityEntity = { ...activity, status: 'closed', closedAt: now,
        updatedAt: now, version: expectedVersion + 1 };
      if (!await transaction.saveActivity(closed, expectedVersion)) throw new ActivityError('CONFLICT');
      await this.receipt(transaction, actor, 'close', operationId, fingerprint, closed);
      await transaction.appendAudit({ id: this.ids.next('checkin_audit'), organizationId: actor.organizationId,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
        action: 'checkin.close', targetType: 'checkin_activity', targetId: activityId,
        result: 'succeeded', errorCode: null, occurredAt: now,
        metadata: { operationId, classId: activity.schedule.classId, reason: cleanReason,
          previousVersion: expectedVersion, nextVersion: closed.version } });
      return clone(closed);
    });
  }

  public async deleteDraft(actor: TrustedActorContext, activityId: string, expectedVersion: number,
    reason: string, operationId: string): Promise<ActivityEntity> {
    if (!activityId.trim() || !operationKeyValid(operationId, expectedVersion)
      || !reason.trim() || reason.length > 200) throw new ActivityError('VALIDATION_ERROR');
    const cleanReason = reason.trim();
    const fingerprint = payloadFingerprint({ activityId, expectedVersion, reason: cleanReason });
    return this.repository.transaction(async transaction => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId,
        'deleteDraft', operationId);
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      const target = activity ?? prior?.result;
      if (!target) throw new ActivityError('NOT_FOUND');
      await this.authorizeTeacher(transaction, actor, target.schedule.classId);
      if (target.creatorTeacherId !== actor.actorUserId) throw new ActivityError('FORBIDDEN');
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      if (!activity || activity.status !== 'draft' || activity.publishedAt !== null
        || activity.version !== expectedVersion || activity.participants.length > 0
        || activity.dailyInstances.length > 0
        || (await transaction.listActivityOverrides(actor.organizationId, activityId)).length > 0
        || await transaction.findFinalSnapshot(actor.organizationId, activityId) !== null) {
        throw new ActivityError('CONFLICT');
      }
      if (!await transaction.deleteActivity(activity)) throw new ActivityError('CONFLICT');
      await this.receipt(transaction, actor, 'deleteDraft', operationId, fingerprint, activity);
      await transaction.appendAudit({ id: this.ids.next('checkin_audit'), organizationId: actor.organizationId,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
        action: 'checkin.draft.deleted', targetType: 'checkin_activity', targetId: activityId,
        result: 'succeeded', errorCode: null, occurredAt: this.clock.nowIso(),
        metadata: { operationId, classId: activity.schedule.classId,
          reason: cleanReason, taskVersion: activity.version } });
      return clone(activity);
    });
  }

  public async recycle(actor: TrustedActorContext, activityId: string, expectedVersion: number,
    reason: string, operationId: string): Promise<ActivityEntity> {
    if (!activityId.trim() || !operationKeyValid(operationId, expectedVersion)
      || !reason.trim() || reason.length > 200) throw new ActivityError('VALIDATION_ERROR');
    const cleanReason = reason.trim();
    const fingerprint = payloadFingerprint({ activityId, expectedVersion, reason: cleanReason });
    return this.repository.transaction(async transaction => {
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity) throw new ActivityError('NOT_FOUND');
      await this.authorizeTeacher(transaction, actor, activity.schedule.classId);
      if (activity.creatorTeacherId !== actor.actorUserId) throw new ActivityError('FORBIDDEN');
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, 'recycle', operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      if (activity.visibility === 'recycled' || activity.version !== expectedVersion
        || activity.status === 'draft' || activity.publishedAt === null) throw new ActivityError('CONFLICT');
      const now = this.clock.nowIso();
      const today = localDateAt(now, activity.schedule.schoolTimeZone);
      if (activity.status === 'published' && today >= activity.schedule.startsOn
        && today <= activity.schedule.endsOn) throw new ActivityError('CONFLICT');
      if (today > activity.schedule.endsOn && await transaction.findFinalSnapshot(
        actor.organizationId, activityId) === null) throw new ActivityError('CONFLICT');
      const recycled: ActivityEntity = { ...activity, visibility: 'recycled', recycledAt: now,
        recycledBy: actor.actorUserId, recycleReason: cleanReason,
        recoverableUntil: new Date(Date.parse(now) + 7 * 86400000).toISOString(),
        updatedAt: now, version: expectedVersion + 1 };
      if (!await transaction.saveActivity(recycled, expectedVersion)) throw new ActivityError('CONFLICT');
      await this.receipt(transaction, actor, 'recycle', operationId, fingerprint, recycled);
      await transaction.appendAudit({ id: this.ids.next('checkin_audit'), organizationId: actor.organizationId,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
        action: 'checkin.recycle', targetType: 'checkin_activity', targetId: activityId,
        result: 'succeeded', errorCode: null, occurredAt: now,
        metadata: { operationId, classId: activity.schedule.classId,
          reason: cleanReason, recoverableUntil: recycled.recoverableUntil ?? null,
          previousVersion: expectedVersion, nextVersion: recycled.version } });
      return clone(recycled);
    });
  }

  public async addFutureRestDay(actor: TrustedActorContext, activityId: string, date: string,
    reasonInput: string, expectedVersion: number, operationId: string): Promise<ActivityEntity> {
    if (!activityId.trim() || !validLocalDate(date) || typeof reasonInput !== 'string'
      || !reasonInput.trim() || reasonInput.length > 300 || !operationKeyValid(operationId, expectedVersion)) {
      throw new ActivityError('VALIDATION_ERROR');
    }
    const reason = reasonInput.trim();
    const fingerprint = payloadFingerprint({ activityId, date, reason, expectedVersion });
    return this.repository.transaction(async transaction => {
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity) throw new ActivityError('NOT_FOUND');
      await this.authorizeTeacher(transaction, actor, activity.schedule.classId);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, 'addFutureRestDay', operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      if (activity.status !== 'published' || activity.version !== expectedVersion
        || await transaction.findFinalSnapshot(actor.organizationId, activityId)) throw new ActivityError('CONFLICT');
      const today = localDateAt(this.clock.nowIso(), activity.schedule.schoolTimeZone);
      if (date <= today || date < activity.schedule.startsOn || date > activity.schedule.endsOn
        || activity.schedule.restDates.includes(date)) throw new ActivityError('VALIDATION_ERROR');
      if (!activity.dailyInstances.some(instance => instance.date === date && instance.classId === activity.schedule.classId)) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      const now = this.clock.nowIso();
      const updated: ActivityEntity = { ...activity,
        schedule: { ...activity.schedule, restDates: [...activity.schedule.restDates, date].sort() },
        dailyInstances: activity.dailyInstances.filter(instance => instance.date !== date),
        restDayChanges: [...(activity.restDayChanges ?? []), { id: this.ids.next('checkin_rest_change'), date,
          reason, teacherId: actor.actorUserId, changedAt: now, activityVersion: expectedVersion + 1 }],
        version: expectedVersion + 1, updatedAt: now };
      if (Buffer.byteLength(JSON.stringify(updated), 'utf8') > MAX_ACTIVITY_SNAPSHOT_BYTES) {
        throw new ActivityError('VALIDATION_ERROR');
      }
      if (!await transaction.saveActivity(updated, expectedVersion)) throw new ActivityError('CONFLICT');
      await this.receipt(transaction, actor, 'addFutureRestDay', operationId, fingerprint, updated);
      return clone(updated);
    });
  }

  public async listForTeacher(actor: TrustedActorContext): Promise<readonly ActivityEntity[]> {
    return this.repository.transaction(async (transaction) => {
      if (actor.actorRole !== 'teacher' || !actor.permissions.includes('task.read')) throw new ActivityError('FORBIDDEN');
      const organization = await transaction.findOrganization(actor.organizationId);
      if (organization?.status !== 'active') throw new ActivityError('FORBIDDEN');
      const activities = await transaction.listActivities(actor.organizationId);
      const visible: ActivityEntity[] = [];
      for (const activity of activities) {
        const grant = await transaction.findTeacherGrant(actor.organizationId, actor.actorUserId, activity.schedule.classId);
        if (!grant?.permissions.includes('task.read') || !actor.scopeIds.includes(activity.schedule.classId)) continue;
        if (activity.visibility === 'recycled') continue;
        if (activity.publishedAt === null && activity.creatorTeacherId !== actor.actorUserId) continue;
        visible.push(clone(activity));
      }
      return visible.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  }

  public async getTeacherProgress(actor: TrustedActorContext, activityId: string, date: string,
    page: Readonly<{ limit: number; offset: number }>, keyword = '',
    completion: 'all' | 'complete' | 'incomplete' = 'all'): Promise<TeacherActivityProgressView> {
    if (!activityId.trim() || !validLocalDate(date) || !Number.isSafeInteger(page.limit)
      || page.limit < 1 || page.limit > 50 || !Number.isSafeInteger(page.offset)
      || page.offset < 0 || page.offset > 10000 || keyword.length > 50
      || !['all', 'complete', 'incomplete'].includes(completion)) throw new ActivityError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      if (actor.actorRole !== 'teacher' || !actor.permissions.includes('task.read')) throw new ActivityError('FORBIDDEN');
      const organization = await transaction.findOrganization(actor.organizationId);
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (organization?.status !== 'active' || !activity || activity.publishedAt === null) throw new ActivityError('NOT_FOUND');
      const grant = await transaction.findTeacherGrant(actor.organizationId, actor.actorUserId, activity.schedule.classId);
      if (!actor.scopeIds.includes(activity.schedule.classId) || !grant?.permissions.includes('task.read')) {
        throw new ActivityError('FORBIDDEN');
      }
      const now = this.clock.nowIso();
      const schoolToday = localDateAt(now, activity.schedule.schoolTimeZone);
      if (date < activity.schedule.startsOn || date > activity.schedule.endsOn || date > schoolToday) {
        throw new ActivityError('VALIDATION_ERROR');
      }
      if (activity.status === 'closed' && activity.closedAt
        && date > localDateAt(activity.closedAt, activity.schedule.schoolTimeZone)) throw new ActivityError('NOT_FOUND');
      const restDay = activity.schedule.restDates.includes(date);
      const ended = schoolToday > activity.schedule.endsOn || activity.status === 'closed';
      const final = ended ? await transaction.findFinalSnapshot(actor.organizationId, activityId) : null;
      if (ended && final === null) return { activityId, date, schoolToday, restDay,
        evidenceStatus: 'not_available', completedCount: null, participantCount: activity.participants.length,
        updatedAt: now, rows: [], nextOffset: null };
      const calculated = final ?? await this.calculateLeaderboard(transaction, activity, now);
      const effectiveDates = activityDays(activity.schedule).filter(day => day <= date
        && (activity.status !== 'closed' || !activity.closedAt
          || day <= localDateAt(activity.closedAt, activity.schedule.schoolTimeZone)));
      const query = keyword.trim().toLocaleLowerCase();
      const allRows = activity.participants.map(person => {
        const dates = new Set(calculated.completedDatesByStudent[person.studentId] ?? []);
        const supplemented = new Set(calculated.supplementedDatesByStudent[person.studentId] ?? []);
        let consecutiveDays = 0;
        for (const day of [...effectiveDates].reverse()) {
          if (!dates.has(day)) break;
          consecutiveDays += 1;
        }
        const conditionStatus = final
          ? final.conditionDetailComplete === true
            ? final.conditionStatusByStudentDay?.[`${person.studentId}:${date}`]
              ?? activity.schedule.conditions.map(() => false) : undefined
          : calculated.conditionStatusByStudentDay?.[`${person.studentId}:${date}`];
        const missingConditions = restDay || dates.has(date) || conditionStatus === undefined ? []
          : activity.schedule.conditions.filter((_condition, index) => conditionStatus[index] !== true)
            .map(condition => condition.kind);
        return { studentId: person.studentId, displayNameMasked: person.displayNameMasked,
          complete: restDay ? null : dates.has(date), supplemented: supplemented.has(date),
          completedDays: [...dates].filter(day => day <= date).length, consecutiveDays, missingConditions,
          evidenceDetailAvailable: conditionStatus !== undefined };
      }).filter(person => !query || person.displayNameMasked.toLocaleLowerCase().includes(query)
        || person.studentId.toLocaleLowerCase().includes(query))
        .filter(person => completion === 'all' || (completion === 'complete' ? person.complete === true : person.complete === false))
        .sort((left, right) => left.displayNameMasked.localeCompare(right.displayNameMasked, 'zh-CN')
          || left.studentId.localeCompare(right.studentId));
      const rows = allRows.slice(page.offset, page.offset + page.limit);
      return { activityId, date, schoolToday, restDay, evidenceStatus: 'available',
        completedCount: restDay ? null : activity.participants.filter(person =>
          (calculated.completedDatesByStudent[person.studentId] ?? []).includes(date)).length,
        participantCount: activity.participants.length, updatedAt: final?.lockedAt ?? now,
        rows, nextOffset: page.offset + page.limit < allRows.length ? page.offset + page.limit : null };
    });
  }

  public async getForStudent(actor: TrustedActorContext, activityId: string): Promise<ActivityEntity> {
    return this.repository.transaction(async (transaction) => {
      if (actor.actorRole !== 'student') throw new ActivityError('FORBIDDEN');
      const organization = await transaction.findOrganization(actor.organizationId);
      if (organization?.status !== 'active') throw new ActivityError('FORBIDDEN');
      const student = await transaction.findUser(actor.organizationId, actor.actorUserId);
      if (student?.status !== 'active') throw new ActivityError('FORBIDDEN');
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity || activity.publishedAt === null
        || !activity.participants.some(person => person.studentId === actor.actorUserId)) {
        throw new ActivityError('NOT_FOUND');
      }
      const memberships = await transaction.listClassMemberships(actor.organizationId, activity.schedule.classId);
      if (!memberships.some(item => item.studentId === actor.actorUserId)) throw new ActivityError('NOT_FOUND');
      if (activity.visibility === 'recycled') {
        const final = await transaction.findFinalSnapshot(actor.organizationId, activityId);
        if (!final?.completedDatesByStudent[actor.actorUserId]?.length) throw new ActivityError('NOT_FOUND');
      }
      const { restDayChanges: hiddenAudit, ...studentView } = activity;
      void hiddenAudit;
      return clone(studentView);
    });
  }

  public async listForStudent(actor: TrustedActorContext): Promise<readonly ActivityEntity[]> {
    return this.repository.transaction(async transaction => {
      if (actor.actorRole !== 'student') throw new ActivityError('FORBIDDEN');
      const organization = await transaction.findOrganization(actor.organizationId);
      const student = await transaction.findUser(actor.organizationId, actor.actorUserId);
      if (organization?.status !== 'active' || student?.status !== 'active') throw new ActivityError('FORBIDDEN');
      const activities = await transaction.listActivities(actor.organizationId);
      const classMemberships = new Map<string, boolean>();
      const visible: ActivityEntity[] = [];
      for (const activity of activities) {
        if (activity.publishedAt === null
          || !activity.participants.some(person => person.studentId === actor.actorUserId)) continue;
        let currentClass = classMemberships.get(activity.schedule.classId);
        if (currentClass === undefined) {
          const memberships = await transaction.listClassMemberships(actor.organizationId, activity.schedule.classId);
          currentClass = memberships.some(item => item.studentId === actor.actorUserId);
          classMemberships.set(activity.schedule.classId, currentClass);
        }
        if (currentClass) {
          if (activity.visibility === 'recycled') {
            const final = await transaction.findFinalSnapshot(actor.organizationId, activity.id);
            if (!final?.completedDatesByStudent[actor.actorUserId]?.length) continue;
          }
          const { restDayChanges: hiddenAudit, ...studentView } = activity;
          void hiddenAudit;
          visible.push(clone(studentView));
        }
      }
      return visible.sort((left, right) => right.schedule.startsOn.localeCompare(left.schedule.startsOn));
    });
  }

  public async getMyDay(actor: TrustedActorContext, activityId: string, date: string): Promise<ActivityDayView> {
    if (!validLocalDate(date)) throw new ActivityError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      if (actor.actorRole !== 'student') throw new ActivityError('FORBIDDEN');
      const organization = await transaction.findOrganization(actor.organizationId);
      const student = await transaction.findUser(actor.organizationId, actor.actorUserId);
      if (organization?.status !== 'active' || student?.status !== 'active') throw new ActivityError('FORBIDDEN');
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity || activity.publishedAt === null || !activity.participants.some(person => person.studentId === actor.actorUserId)
        || date < activity.schedule.startsOn || date > activity.schedule.endsOn) throw new ActivityError('NOT_FOUND');
      if (activity.status === 'closed' && activity.closedAt
        && date > localDateAt(activity.closedAt, activity.schedule.schoolTimeZone)) throw new ActivityError('NOT_FOUND');
      const memberships = await transaction.listClassMemberships(actor.organizationId, activity.schedule.classId);
      if (!memberships.some(item => item.studentId === actor.actorUserId)) throw new ActivityError('NOT_FOUND');
      if (activity.visibility === 'recycled') {
        const final = await transaction.findFinalSnapshot(actor.organizationId, activityId);
        if (!final?.completedDatesByStudent[actor.actorUserId]?.length) throw new ActivityError('NOT_FOUND');
      }
      const publishedAt = activity.publishedAt;
      if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) throw new ActivityError('SERVICE_UNAVAILABLE');
      const totalConditions = activity.schedule.conditions.length;
      if (activity.schedule.restDates.includes(date)) return { activityId, date, restDay: true, complete: null,
        evidenceStatus: 'available', verifiedConditions: 0, totalConditions, completedAt: null, supplemented: false };
      if (!activity.dailyInstances.some(instance => instance.date === date && instance.classId === activity.schedule.classId)) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      if (activity.conditionSnapshots.length !== totalConditions) throw new ActivityError('SERVICE_UNAVAILABLE');
      if (activity.status === 'closed'
        || localDateAt(this.clock.nowIso(), activity.schedule.schoolTimeZone) > activity.schedule.endsOn) {
        const finalSnapshot = await transaction.findFinalSnapshot(actor.organizationId, activityId);
        if (!finalSnapshot) return { activityId, date, restDay: false, complete: null,
          evidenceStatus: 'not_available', verifiedConditions: 0, totalConditions, completedAt: null, supplemented: false };
        const complete = finalSnapshot.completedDatesByStudent[actor.actorUserId]?.includes(date) ?? false;
        return { activityId, date, restDay: false, complete, evidenceStatus: 'available',
          verifiedConditions: complete ? totalConditions : 0, totalConditions, completedAt: null,
          supplemented: finalSnapshot.supplementedDatesByStudent[actor.actorUserId]?.includes(date) ?? false };
      }
      const overrides = await transaction.listOverrides(actor.organizationId, activityId, actor.actorUserId, date);
      const latestOverride = [...overrides].sort((left, right) => right.version - left.version)[0];
      if (latestOverride?.active && latestOverride.reason.trim()) return { activityId, date, restDay: false,
        complete: true, evidenceStatus: 'available', verifiedConditions: totalConditions, totalConditions,
        completedAt: latestOverride.changedAt, supplemented: true };
      let verifiedConditions = 0;
      let completedAt: string | null = null;
      const conditionProgress: NonNullable<ActivityDayView['conditionProgress']>[number][] = [];
      for (const [index, condition] of activity.schedule.conditions.entries()) {
        const snapshot = activity.conditionSnapshots[index];
        if (!snapshot || snapshot.kind !== condition.kind || snapshot.resourceId !== condition.resourceId) {
          throw new ActivityError('SERVICE_UNAVAILABLE');
        }
        let completedAtForCondition: string | null = null;
        if (snapshot.kind === 'reading') {
          const events = await transaction.listReadingPageEvents(actor.organizationId, actor.actorUserId, snapshot.resourceId);
          const eligibleEvents = events.filter(event => Date.parse(event.visitedAt) >= Date.parse(publishedAt));
          const evidence = readingEvidenceFromPageEvents({ snapshot, events: eligibleEvents, organizationId: actor.organizationId,
            studentId: actor.actorUserId, date, schoolTimeZone: activity.schedule.schoolTimeZone });
          if (evidence?.kind === 'reading') completedAtForCondition = evidence.submittedAt;
        } else if (snapshot.kind === 'vocabulary' && condition.kind === 'vocabulary') {
          if (!snapshot.wordIds?.length) throw new ActivityError('SERVICE_UNAVAILABLE');
          const attempts = await transaction.listVocabularyAttempts(actor.organizationId, actor.actorUserId,
            snapshot.resourceId, snapshot.contentVersion);
          const evidence = vocabularyEvidenceFromAttempts({ snapshot, attempts,
            organizationId: actor.organizationId, studentId: actor.actorUserId,
            date, schoolTimeZone: activity.schedule.schoolTimeZone, publishedAt,
            requiredWordCount: condition.requiredWordCount });
          if (evidence?.kind === 'vocabulary') completedAtForCondition = evidence.submittedAt;
        } else if (snapshot.kind === 'work' && condition.kind === 'work') {
          const works = await transaction.listSubmittedWorks(actor.organizationId, actor.actorUserId,
            snapshot.resourceId);
          for (const work of works) {
            const evidence = workEvidenceFromStudentWork({ snapshot, work,
              organizationId: actor.organizationId, studentId: actor.actorUserId,
              date, schoolTimeZone: activity.schedule.schoolTimeZone, publishedAt });
            if (evidence?.kind === 'work' && (completedAtForCondition === null
              || Date.parse(evidence.submittedAt) < Date.parse(completedAtForCondition))) {
              completedAtForCondition = evidence.submittedAt;
            }
          }
        } else if (condition.kind === 'exercise') {
          if (!snapshot.questionIds?.includes(snapshot.resourceId)) throw new ActivityError('SERVICE_UNAVAILABLE');
          const sources = await transaction.listExerciseSources(actor.organizationId, actor.actorUserId,
            activity.schedule.classId, snapshot.resourceId);
          for (const source of sources) {
            const evidence = exerciseEvidenceFromSubmission({ ...source, resourceId: snapshot.resourceId,
              requiredContentVersion: snapshot.contentVersion, studentId: actor.actorUserId, classId: activity.schedule.classId });
            if (evidence?.kind !== 'exercise' || evidence.score === null || evidence.score < condition.minimumScore
              || Date.parse(evidence.submittedAt) < Date.parse(publishedAt)
              || localDateAt(evidence.submittedAt, activity.schedule.schoolTimeZone) !== date) continue;
            if (completedAtForCondition === null || Date.parse(evidence.submittedAt) > Date.parse(completedAtForCondition)) {
              completedAtForCondition = evidence.submittedAt;
            }
          }
        }
        conditionProgress.push({ index, kind: snapshot.kind, resourceId: snapshot.resourceId,
          complete: completedAtForCondition !== null, completedAt: completedAtForCondition });
        if (completedAtForCondition !== null) {
          verifiedConditions += 1;
          if (completedAt === null || Date.parse(completedAtForCondition) > Date.parse(completedAt)) completedAt = completedAtForCondition;
        }
      }
      return { activityId, date, restDay: false, complete: verifiedConditions === totalConditions,
        evidenceStatus: 'available', verifiedConditions, totalConditions,
        completedAt: verifiedConditions !== totalConditions ? null : completedAt, supplemented: false,
        conditionProgress };
    });
  }

  public async setOverride(actor: TrustedActorContext, input: Readonly<{ activityId: string; studentId: string;
    date: string; active: boolean; reason: string }>, expectedVersion: number,
  operationId: string): Promise<ActivityOverrideRecord> {
    if (!operationKeyValid(operationId, expectedVersion) || !input.activityId.trim() || !input.studentId.trim()
      || !validLocalDate(input.date) || typeof input.active !== 'boolean' || typeof input.reason !== 'string'
      || !input.reason.trim() || input.reason.length > 300) throw new ActivityError('VALIDATION_ERROR');
    const reason = input.reason.trim();
    const fingerprint = payloadFingerprint({ activityId: input.activityId, studentId: input.studentId,
      date: input.date, active: input.active, reason, expectedVersion });
    return this.repository.transaction(async transaction => {
      const activity = await transaction.findActivity(actor.organizationId, input.activityId);
      if (!activity || activity.status !== 'published') throw new ActivityError('NOT_FOUND');
      await this.authorizeTeacher(transaction, actor, activity.schedule.classId);
      if (!activity.participants.some(person => person.studentId === input.studentId)) throw new ActivityError('NOT_FOUND');
      if (input.date < activity.schedule.startsOn || input.date > activity.schedule.endsOn
        || activity.schedule.restDates.includes(input.date)) throw new ActivityError('VALIDATION_ERROR');
      const prior = await transaction.findOverrideReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ActivityError('CONFLICT');
        return clone(prior.result);
      }
      const today = localDateAt(this.clock.nowIso(), activity.schedule.schoolTimeZone);
      if (input.date > today) throw new ActivityError('VALIDATION_ERROR');
      if (today > activity.schedule.endsOn) {
        throw new ActivityError('CONFLICT');
      }
      const overrides = await transaction.listOverrides(actor.organizationId, input.activityId, input.studentId, input.date);
      const latest = [...overrides].sort((left, right) => right.version - left.version)[0];
      if ((latest?.version ?? 0) !== expectedVersion) throw new ActivityError('CONFLICT');
      if (!input.active && latest?.active !== true) throw new ActivityError('NOT_FOUND');
      const record: ActivityOverrideRecord = { id: this.ids.next('checkin_override'),
        organizationId: actor.organizationId, activityId: input.activityId, studentId: input.studentId,
        classId: activity.schedule.classId, date: input.date, active: input.active,
        reason, teacherId: actor.actorUserId, changedAt: this.clock.nowIso(), version: expectedVersion + 1 };
      if (!await transaction.appendOverride(record)) throw new ActivityError('CONFLICT');
      if (!await transaction.saveOverrideReceipt({ organizationId: actor.organizationId,
        actorUserId: actor.actorUserId, operationId, fingerprint, result: record })) throw new ActivityError('CONFLICT');
      return clone(record);
    });
  }

  public async getOverrideForTeacher(actor: TrustedActorContext, activityId: string,
    studentId: string, date: string): Promise<ActivityOverrideState> {
    if (!activityId.trim() || !studentId.trim() || !validLocalDate(date)) throw new ActivityError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      if (actor.actorRole !== 'teacher' || !actor.permissions.includes('task.read')) throw new ActivityError('FORBIDDEN');
      const organization = await transaction.findOrganization(actor.organizationId);
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (organization?.status !== 'active' || !activity || activity.status === 'draft') throw new ActivityError('NOT_FOUND');
      const grant = await transaction.findTeacherGrant(actor.organizationId, actor.actorUserId, activity.schedule.classId);
      if (!actor.scopeIds.includes(activity.schedule.classId) || !grant?.permissions.includes('task.read')) {
        throw new ActivityError('FORBIDDEN');
      }
      if (!activity.participants.some(person => person.studentId === studentId)
        || date < activity.schedule.startsOn || date > activity.schedule.endsOn
        || activity.schedule.restDates.includes(date)) throw new ActivityError('NOT_FOUND');
      const overrides = await transaction.listOverrides(actor.organizationId, activityId, studentId, date);
      const latest = [...overrides].sort((left, right) => right.version - left.version)[0];
      return { activityId, studentId, date, version: latest?.version ?? 0,
        active: latest?.active ?? false, reason: latest?.reason ?? null, changedAt: latest?.changedAt ?? null };
    });
  }

  public async getLeaderboard(actor: TrustedActorContext, activityId: string): Promise<ActivityLeaderboardView> {
    if (!activityId.trim()) throw new ActivityError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      const organization = await transaction.findOrganization(actor.organizationId);
      if (organization?.status !== 'active') throw new ActivityError('FORBIDDEN');
      const activity = await transaction.findActivity(actor.organizationId, activityId);
      if (!activity || activity.publishedAt === null) throw new ActivityError('NOT_FOUND');
      if (actor.actorRole === 'student') {
        const student = await transaction.findUser(actor.organizationId, actor.actorUserId);
        const memberships = await transaction.listClassMemberships(actor.organizationId, activity.schedule.classId);
        if (student?.status !== 'active' || !activity.participants.some(person => person.studentId === actor.actorUserId)
          || !memberships.some(item => item.studentId === actor.actorUserId)) {
          throw new ActivityError('FORBIDDEN');
        }
        if (activity.visibility === 'recycled') {
          const final = await transaction.findFinalSnapshot(actor.organizationId, activityId);
          if (!final?.completedDatesByStudent[actor.actorUserId]?.length) throw new ActivityError('FORBIDDEN');
        }
      } else if (actor.actorRole === 'teacher') {
        const grant = await transaction.findTeacherGrant(actor.organizationId, actor.actorUserId, activity.schedule.classId);
        if (!actor.permissions.includes('task.read') || !actor.scopeIds.includes(activity.schedule.classId)
          || !grant?.permissions.includes('task.read')) throw new ActivityError('FORBIDDEN');
      } else throw new ActivityError('FORBIDDEN');
      const now = this.clock.nowIso();
      const base = { activityId, title: activity.title, startsOn: activity.schedule.startsOn,
        endsOn: activity.schedule.endsOn, schoolToday: localDateAt(now, activity.schedule.schoolTimeZone),
        restDayCount: activity.schedule.restDates.length, updatedAt: now };
      if (!activity.publishedAt || !Number.isFinite(Date.parse(activity.publishedAt))
        || activity.conditionSnapshots.length !== activity.schedule.conditions.length) throw new ActivityError('SERVICE_UNAVAILABLE');
      if (activity.status === 'closed' || localDateAt(now, activity.schedule.schoolTimeZone) > activity.schedule.endsOn) {
        const snapshot = await transaction.findFinalSnapshot(actor.organizationId, activityId);
        if (!snapshot) return { ...base, evidenceStatus: 'not_available', leaderboard: null, myRank: null };
        return { ...base, updatedAt: snapshot.lockedAt, evidenceStatus: 'available', leaderboard: snapshot.leaderboard,
          myRank: actor.actorRole === 'student'
            ? snapshot.leaderboard.ranks.find(item => item.studentId === actor.actorUserId) ?? null : null };
      }
      const calculated = await this.calculateLeaderboard(transaction, activity, now);
      return { ...base, evidenceStatus: 'available', leaderboard: calculated.leaderboard,
        myRank: actor.actorRole === 'student'
          ? calculated.leaderboard.ranks.find(item => item.studentId === actor.actorUserId) ?? null : null };
    });
  }

  /** Retried by trusted maintenance after the activity ends until submitted manual work is graded. */
  public async finalizeActivity(organizationId: string, activityId: string): Promise<ActivityFinalSnapshot> {
    return this.repository.transaction(async transaction => {
      const activity = await transaction.findActivity(organizationId, activityId);
      if (!activity || activity.publishedAt === null) throw new ActivityError('NOT_FOUND');
      const existing = await transaction.findFinalSnapshot(organizationId, activityId);
      if (existing) return existing;
      const now = this.clock.nowIso();
      if (!activityHasEnded(now, activity.schedule.schoolTimeZone, activity.schedule.endsOn)) {
        throw new ActivityError('CONFLICT');
      }
      const calculated = await this.calculateLeaderboard(transaction, activity, now);
      if (!calculated.leaderboard.finalized) throw new ActivityError('SERVICE_UNAVAILABLE');
      if (calculated.pendingManualSubmissionIds.length) throw new ActivityError('ACTIVITY_PENDING_REVIEW');
      const snapshot: ActivityFinalSnapshot = { organizationId, activityId, activityVersion: activity.version,
        lockedAt: now, leaderboard: calculated.leaderboard,
        completedDatesByStudent: calculated.completedDatesByStudent,
        supplementedDatesByStudent: calculated.supplementedDatesByStudent,
        ...finalConditionDetails(calculated.conditionStatusByStudentDay) };
      if (!await transaction.createFinalSnapshot(snapshot)) throw new ActivityError('CONFLICT');
      return snapshot;
    });
  }

  /** Internal statistics source. Callers must authorize classes and students first. */
  public async listVerifiedDaysForStatistics(organizationId: string, classIds: readonly string[],
    studentIds: readonly string[], startsOn: string, endsOn: string): Promise<VerifiedActivityDayPage> {
    if (!validLocalDate(startsOn) || !validLocalDate(endsOn) || startsOn > endsOn) {
      throw new ActivityError('VALIDATION_ERROR');
    }
    return this.repository.transaction(async transaction => {
      const classes = new Set(classIds);
      const students = new Set(studentIds);
      const events: VerifiedActivityDayPage['events'][number][] = [];
      let partial = false;
      for (const activity of await transaction.listActivities(organizationId)) {
        if (activity.publishedAt === null || !classes.has(activity.schedule.classId)
          || activity.schedule.endsOn < startsOn || activity.schedule.startsOn > endsOn) continue;
        const now = this.clock.nowIso();
        const ended = localDateAt(now, activity.schedule.schoolTimeZone) > activity.schedule.endsOn
          || activity.status === 'closed';
        const result = ended ? await transaction.findFinalSnapshot(organizationId, activity.id) : null;
        if (ended && result === null) { partial = true; continue; }
        const calculated = result ?? await this.calculateLeaderboard(transaction, activity, now);
        for (const participant of activity.participants) {
          if (!students.has(participant.studentId)) continue;
          const supplemented = new Set(calculated.supplementedDatesByStudent[participant.studentId] ?? []);
          for (const date of calculated.completedDatesByStudent[participant.studentId] ?? []) {
            if (date < startsOn || date > endsOn) continue;
            events.push({ activityId: activity.id, activityTitle: activity.title,
              classId: activity.schedule.classId, studentId: participant.studentId,
              date, supplemented: supplemented.has(date) });
          }
        }
      }
      return { evidenceStatus: partial ? 'partial' : 'available', events };
    });
  }

  private async calculateLeaderboard(transaction: ActivityTransaction, activity: ActivityEntity,
    now: string, endsOnOverride?: string): Promise<Readonly<{ leaderboard: ActivityLeaderboard;
      completedDatesByStudent: Record<string, string[]>;
      supplementedDatesByStudent: Record<string, string[]>;
      conditionStatusByStudentDay: Record<string, readonly boolean[]>;
      pendingManualSubmissionIds: readonly string[] }>> {
    const schedule: ActivitySchedule = endsOnOverride === undefined ? activity.schedule : {
      ...activity.schedule, endsOn: endsOnOverride,
      restDates: activity.schedule.restDates.filter(date => date <= endsOnOverride),
    };
    const days = activityDays(schedule);
    const records: ActivityDailyRecord[] = [];
    const pendingManualSubmissionIds = new Set<string>();
    const publishedAt = activity.publishedAt;
    if (!publishedAt) throw new ActivityError('SERVICE_UNAVAILABLE');
    const exerciseSources = new Map<string, Readonly<Record<string, readonly import('./types').ActivityExerciseSource[]>>>();
    for (const snapshot of activity.conditionSnapshots) {
      if (snapshot.kind === 'exercise' && !exerciseSources.has(snapshot.resourceId)) {
        exerciseSources.set(snapshot.resourceId, await transaction.listExerciseSourcesForStudents(
          activity.organizationId, activity.schedule.classId, snapshot.resourceId,
          activity.participants.map(person => person.studentId)));
      }
    }
    for (const participant of activity.participants) {
      const byDay = new Map<string, DailyEvidence[]>();
      for (const [index, condition] of activity.schedule.conditions.entries()) {
        const snapshot = activity.conditionSnapshots[index];
        if (!snapshot || snapshot.kind !== condition.kind || snapshot.resourceId !== condition.resourceId) {
          throw new ActivityError('SERVICE_UNAVAILABLE');
        }
        if (snapshot.kind === 'reading') {
          const events = await transaction.listReadingPageEvents(activity.organizationId, participant.studentId, snapshot.resourceId);
          const eligible = events.filter(event => Date.parse(event.visitedAt) >= Date.parse(publishedAt));
          for (const date of days) {
            const evidence = readingEvidenceFromPageEvents({ snapshot, events: eligible,
              organizationId: activity.organizationId, studentId: participant.studentId,
              date, schoolTimeZone: schedule.schoolTimeZone });
            if (evidence) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        } else if (snapshot.kind === 'vocabulary' && condition.kind === 'vocabulary') {
          if (!snapshot.wordIds?.length) throw new ActivityError('SERVICE_UNAVAILABLE');
          const attempts = await transaction.listVocabularyAttempts(activity.organizationId, participant.studentId,
            snapshot.resourceId, snapshot.contentVersion);
          for (const date of days) {
            const evidence = vocabularyEvidenceFromAttempts({ snapshot, attempts,
              organizationId: activity.organizationId, studentId: participant.studentId,
              date, schoolTimeZone: schedule.schoolTimeZone, publishedAt,
              requiredWordCount: condition.requiredWordCount });
            if (evidence) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        } else if (snapshot.kind === 'work') {
          const works = await transaction.listSubmittedWorks(activity.organizationId, participant.studentId,
            snapshot.resourceId);
          for (const work of works) {
            if (!work.submittedAt) continue;
            const date = localDateAt(work.submittedAt, schedule.schoolTimeZone);
            if (!days.includes(date)) continue;
            const evidence = workEvidenceFromStudentWork({ snapshot, work,
              organizationId: activity.organizationId, studentId: participant.studentId,
              date, schoolTimeZone: schedule.schoolTimeZone, publishedAt });
            if (evidence) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        } else if (snapshot.kind === 'exercise') {
          const sources = exerciseSources.get(snapshot.resourceId)?.[participant.studentId] ?? [];
          for (const source of sources) {
            if (source.submission.submittedAt && Date.parse(source.submission.submittedAt) >= Date.parse(publishedAt)
              && days.includes(localDateAt(source.submission.submittedAt, schedule.schoolTimeZone))
              && exerciseSubmissionNeedsReview({ ...source, resourceId: snapshot.resourceId,
                requiredContentVersion: snapshot.contentVersion, studentId: participant.studentId,
                classId: activity.schedule.classId })) pendingManualSubmissionIds.add(source.submission.id);
            const evidence = exerciseEvidenceFromSubmission({ ...source, resourceId: snapshot.resourceId,
              requiredContentVersion: snapshot.contentVersion, studentId: participant.studentId,
              classId: activity.schedule.classId });
            if (!evidence || Date.parse(evidence.submittedAt) < Date.parse(publishedAt)) continue;
            const date = localDateAt(evidence.submittedAt, schedule.schoolTimeZone);
            if (days.includes(date)) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        }
      }
      for (const [date, evidence] of byDay) records.push({ studentId: participant.studentId,
        classId: activity.schedule.classId, date, evidence });
    }
    const overrides = await transaction.listActivityOverrides(activity.organizationId, activity.id);
    const leaderboard = rankActivity(schedule, activity.participants, records, overrides, now);
    const evidenceByDay = new Map(records.map(record => [`${record.studentId}:${record.date}`, record.evidence]));
    const latestOverrides = new Map<string, TeacherCheckInOverride>();
    for (const override of overrides) {
      const key = `${override.studentId}:${override.date}`;
      const previous = latestOverrides.get(key);
      if (!previous || (override.version ?? 0) > (previous.version ?? 0)) latestOverrides.set(key, override);
    }
    const completedDatesByStudent: Record<string, string[]> = {};
    const supplementedDatesByStudent: Record<string, string[]> = {};
    const conditionStatusByStudentDay: Record<string, readonly boolean[]> = {};
    for (const person of activity.participants) {
      completedDatesByStudent[person.studentId] = [];
      supplementedDatesByStudent[person.studentId] = [];
      for (const date of days) {
        const key = `${person.studentId}:${date}`;
        const override = latestOverrides.get(key);
        conditionStatusByStudentDay[key] = schedule.conditions.map(condition => isEffectiveActivityDay(
          { ...schedule, conditions: [condition] }, person.studentId, date,
          evidenceByDay.get(key) ?? [], undefined));
        if (isEffectiveActivityDay(schedule, person.studentId, date,
          evidenceByDay.get(key) ?? [], override)) {
          completedDatesByStudent[person.studentId]!.push(date);
          if (override?.active) supplementedDatesByStudent[person.studentId]!.push(date);
        }
      }
    }
    return { leaderboard, completedDatesByStudent, supplementedDatesByStudent,
      conditionStatusByStudentDay, pendingManualSubmissionIds: [...pendingManualSubmissionIds] };
  }

  private async authorizeTeacher(transaction: ActivityTransaction, actor: TrustedActorContext, classId: string): Promise<string> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('task.publish') || !actor.scopeIds.includes(classId)) {
      throw new ActivityError('FORBIDDEN');
    }
    const organization = await transaction.findOrganization(actor.organizationId);
    const classEntity = await transaction.findClass(actor.organizationId, classId);
    const grant = await transaction.findTeacherGrant(actor.organizationId, actor.actorUserId, classId);
    if (organization?.status !== 'active' || classEntity?.status !== 'active'
      || !grant?.permissions.includes('task.publish')) throw new ActivityError('FORBIDDEN');
    return organization.timeZone;
  }

  private async receipt(transaction: ActivityTransaction, actor: TrustedActorContext,
    action: ActivityOperationReceipt['action'], operationId: string, fingerprint: string,
    result: ActivityEntity): Promise<void> {
    if (!await transaction.saveReceipt({ organizationId: actor.organizationId, actorUserId: actor.actorUserId,
      action, operationId, fingerprint, result })) throw new ActivityError('CONFLICT');
  }
}
