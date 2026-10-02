import type { TrustedActorContext } from '../auth/trusted-actor';
import { activityDays, isEffectiveActivityDay, localDateAt, rankActivity, validateActivitySchedule,
  type ActivityDailyRecord, type ActivityLeaderboard, type ActivityParticipant, type ActivitySchedule,
  type DailyCondition, type DailyEvidence, type TeacherCheckInOverride } from '../task-core/activity-rules';
import { exerciseEvidenceFromSubmission, readingEvidenceFromPageEvents, vocabularyEvidenceFromAttempts, workEvidenceFromStudentWork } from './activity-evidence';
import type { ActivityTransaction, ActivityUnitOfWork } from './repository';
import { ActivityError, type ActivityConditionSnapshot, type ActivityDayView, type ActivityDraftInput,
  type ActivityEntity, type ActivityFinalSnapshot, type ActivityLeaderboardView, type ActivityOperationReceipt, type ActivityOverrideRecord,
  type ActivityOverrideState } from './types';

export interface ActivityClock { nowIso(): string }
export interface ActivityIds { next(prefix: string): string }

// Keep the whole published activity, including its dated occurrences and roster, below the
// CloudBase single-response budget with ample space for document metadata and later versions.
const MAX_ACTIVITY_SNAPSHOT_BYTES = 1_000_000;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function operationKeyValid(operationId: string, expectedVersion: number): boolean {
  return operationId.trim().length >= 8 && Number.isSafeInteger(expectedVersion) && expectedVersion >= 0;
}

function payloadFingerprint(value: object): string { return JSON.stringify(value); }

function validLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function nextLocalDate(value: string): string {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function withinFinalizationWindow(nowIso: string, timeZone: string, endsOn: string): boolean {
  if (localDateAt(nowIso, timeZone) !== nextLocalDate(endsOn)) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(new Date(nowIso));
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return hour === 0 && minute >= 0 && minute <= 5;
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
      const now = this.clock.nowIso();
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
        if (activity.publishedAt === null && activity.creatorTeacherId !== actor.actorUserId) continue;
        visible.push(clone(activity));
      }
      return visible.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
        if (activity.publishedAt === null || !activity.participants.some(person => person.studentId === actor.actorUserId)) continue;
        let currentClass = classMemberships.get(activity.schedule.classId);
        if (currentClass === undefined) {
          const memberships = await transaction.listClassMemberships(actor.organizationId, activity.schedule.classId);
          currentClass = memberships.some(item => item.studentId === actor.actorUserId);
          classMemberships.set(activity.schedule.classId, currentClass);
        }
        if (currentClass) {
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
      const memberships = await transaction.listClassMemberships(actor.organizationId, activity.schedule.classId);
      if (!memberships.some(item => item.studentId === actor.actorUserId)) throw new ActivityError('NOT_FOUND');
      const publishedAt = activity.publishedAt;
      if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) throw new ActivityError('SERVICE_UNAVAILABLE');
      const totalConditions = activity.schedule.conditions.length;
      if (activity.schedule.restDates.includes(date)) return { activityId, date, restDay: true, complete: null,
        evidenceStatus: 'available', verifiedConditions: 0, totalConditions, completedAt: null, supplemented: false };
      if (!activity.dailyInstances.some(instance => instance.date === date && instance.classId === activity.schedule.classId)) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      if (activity.conditionSnapshots.length !== totalConditions) throw new ActivityError('SERVICE_UNAVAILABLE');
      if (localDateAt(this.clock.nowIso(), activity.schedule.schoolTimeZone) > activity.schedule.endsOn) {
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
      if (localDateAt(now, activity.schedule.schoolTimeZone) > activity.schedule.endsOn) {
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

  /** Invoked only by a trusted maintenance runner during the first five minutes after school-local midnight. */
  public async finalizeActivity(organizationId: string, activityId: string): Promise<ActivityFinalSnapshot> {
    return this.repository.transaction(async transaction => {
      const activity = await transaction.findActivity(organizationId, activityId);
      if (!activity || activity.publishedAt === null) throw new ActivityError('NOT_FOUND');
      const existing = await transaction.findFinalSnapshot(organizationId, activityId);
      if (existing) return existing;
      const now = this.clock.nowIso();
      if (!withinFinalizationWindow(now, activity.schedule.schoolTimeZone, activity.schedule.endsOn)) {
        throw new ActivityError('CONFLICT');
      }
      const calculated = await this.calculateLeaderboard(transaction, activity, now);
      if (!calculated.leaderboard.finalized) throw new ActivityError('SERVICE_UNAVAILABLE');
      const snapshot: ActivityFinalSnapshot = { organizationId, activityId, activityVersion: activity.version,
        lockedAt: now, leaderboard: calculated.leaderboard,
        completedDatesByStudent: calculated.completedDatesByStudent,
        supplementedDatesByStudent: calculated.supplementedDatesByStudent };
      if (!await transaction.createFinalSnapshot(snapshot)) throw new ActivityError('CONFLICT');
      return snapshot;
    });
  }

  private async calculateLeaderboard(transaction: ActivityTransaction, activity: ActivityEntity,
    now: string): Promise<Readonly<{ leaderboard: ActivityLeaderboard;
      completedDatesByStudent: Record<string, string[]>;
      supplementedDatesByStudent: Record<string, string[]> }>> {
    const days = activityDays(activity.schedule);
    const records: ActivityDailyRecord[] = [];
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
              date, schoolTimeZone: activity.schedule.schoolTimeZone });
            if (evidence) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        } else if (snapshot.kind === 'vocabulary' && condition.kind === 'vocabulary') {
          if (!snapshot.wordIds?.length) throw new ActivityError('SERVICE_UNAVAILABLE');
          const attempts = await transaction.listVocabularyAttempts(activity.organizationId, participant.studentId,
            snapshot.resourceId, snapshot.contentVersion);
          for (const date of days) {
            const evidence = vocabularyEvidenceFromAttempts({ snapshot, attempts,
              organizationId: activity.organizationId, studentId: participant.studentId,
              date, schoolTimeZone: activity.schedule.schoolTimeZone, publishedAt,
              requiredWordCount: condition.requiredWordCount });
            if (evidence) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        } else if (snapshot.kind === 'work') {
          const works = await transaction.listSubmittedWorks(activity.organizationId, participant.studentId,
            snapshot.resourceId);
          for (const work of works) {
            if (!work.submittedAt) continue;
            const date = localDateAt(work.submittedAt, activity.schedule.schoolTimeZone);
            if (!days.includes(date)) continue;
            const evidence = workEvidenceFromStudentWork({ snapshot, work,
              organizationId: activity.organizationId, studentId: participant.studentId,
              date, schoolTimeZone: activity.schedule.schoolTimeZone, publishedAt });
            if (evidence) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        } else if (snapshot.kind === 'exercise') {
          const sources = exerciseSources.get(snapshot.resourceId)?.[participant.studentId] ?? [];
          for (const source of sources) {
            const evidence = exerciseEvidenceFromSubmission({ ...source, resourceId: snapshot.resourceId,
              requiredContentVersion: snapshot.contentVersion, studentId: participant.studentId,
              classId: activity.schedule.classId });
            if (!evidence || Date.parse(evidence.submittedAt) < Date.parse(publishedAt)) continue;
            const date = localDateAt(evidence.submittedAt, activity.schedule.schoolTimeZone);
            if (days.includes(date)) byDay.set(date, [...(byDay.get(date) ?? []), evidence]);
          }
        }
      }
      for (const [date, evidence] of byDay) records.push({ studentId: participant.studentId,
        classId: activity.schedule.classId, date, evidence });
    }
    const overrides = await transaction.listActivityOverrides(activity.organizationId, activity.id);
    const leaderboard = rankActivity(activity.schedule, activity.participants, records, overrides, now);
    const evidenceByDay = new Map(records.map(record => [`${record.studentId}:${record.date}`, record.evidence]));
    const latestOverrides = new Map<string, TeacherCheckInOverride>();
    for (const override of overrides) {
      const key = `${override.studentId}:${override.date}`;
      const previous = latestOverrides.get(key);
      if (!previous || (override.version ?? 0) > (previous.version ?? 0)) latestOverrides.set(key, override);
    }
    const completedDatesByStudent: Record<string, string[]> = {};
    const supplementedDatesByStudent: Record<string, string[]> = {};
    for (const person of activity.participants) {
      completedDatesByStudent[person.studentId] = [];
      supplementedDatesByStudent[person.studentId] = [];
      for (const date of days) {
        const key = `${person.studentId}:${date}`;
        const override = latestOverrides.get(key);
        if (isEffectiveActivityDay(activity.schedule, person.studentId, date,
          evidenceByDay.get(key) ?? [], override)) {
          completedDatesByStudent[person.studentId]!.push(date);
          if (override?.active) supplementedDatesByStudent[person.studentId]!.push(date);
        }
      }
    }
    return { leaderboard, completedDatesByStudent, supplementedDatesByStudent };
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
