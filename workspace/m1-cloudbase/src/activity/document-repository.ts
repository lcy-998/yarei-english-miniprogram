import type { DailyCondition, ActivitySchedule } from '../task-core/activity-rules';
import type { ReadingPageEventRecord } from '../learning-progress/types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { StudentWork } from '../student-work/types';
import { projectStudentWork, STUDENT_WORK_COLLECTIONS } from '../student-work/document-repository';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import { feedbackDocumentId, submissionByIdDocumentId } from '../repositories/task-core-document-adapter';
import { activityDays, validateActivitySchedule } from '../task-core/activity-rules';
import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { ActivityTransaction, ActivityUnitOfWork } from './repository';
import { ActivityError, type ActivityClass, type ActivityConditionResource, type ActivityEntity, type ActivityExerciseSource,
  type ActivityFinalSnapshot, type ActivityGrant,
  type ActivityMembership, type ActivityOperationReceipt, type ActivityOrganization, type ActivityOverrideReceipt,
  type ActivityOverrideRecord, type ActivityUser } from './types';

export const ACTIVITY_COLLECTIONS = {
  organizations: 'organizations', classes: 'classes', users: 'users',
  grants: 'teacher_class_grants', memberships: 'class_memberships',
  activities: 'checkin_activities', receipts: 'checkin_activity_operations',
  overrides: 'checkin_overrides',
  finalBoards: 'checkin_final_boards',
  resources: 'learning_resources',
  readingPageEvents: 'reading_page_events',
  vocabularyAttempts: 'vocabulary_attempts',
  tasks: 'tasks', assignments: 'task_assignments', submissions: 'submissions', feedback: 'review_feedback',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nestedIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) return undefined;
    ids.push(item.id);
  }
  return ids;
}

function readingPageIds(document: VersionedDocument): string[] | undefined {
  const payload = isRecord(document.payload) ? document.payload : null;
  const chapters = payload?.chapters ?? document.chapters;
  if (Array.isArray(chapters)) {
    const ids: string[] = [];
    for (const chapter of chapters) {
      if (!isRecord(chapter)) return undefined;
      const pages = nestedIds(chapter.pages);
      if (!pages) return undefined;
      ids.push(...pages);
    }
    return ids;
  }
  if (document.pages !== undefined) return nestedIds(document.pages);
  return payload ? nestedIds(payload.pages) : undefined;
}

function vocabularyWordIds(document: VersionedDocument): string[] | undefined {
  if (Array.isArray(document.wordIds) && document.wordIds.every(id => typeof id === 'string' && id.trim())) {
    return [...document.wordIds] as string[];
  }
  if (document.words !== undefined) return nestedIds(document.words);
  return isRecord(document.payload) ? nestedIds(document.payload.words) : undefined;
}

function exerciseQuestionIds(document: VersionedDocument): string[] | undefined {
  const value = isRecord(document.payload) ? document.payload.questionIds : document.questionIds;
  return Array.isArray(value) && value.every(id => typeof id === 'string' && id.trim()) ? [...value] as string[] : undefined;
}

function isOffsetIso(value: unknown): value is string {
  return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function isCondition(value: unknown): value is DailyCondition {
  if (!isRecord(value) || typeof value.resourceId !== 'string' || !value.resourceId.trim()) return false;
  if (value.kind === 'reading' || value.kind === 'work') return true;
  if (value.kind === 'vocabulary') return Number.isSafeInteger(value.requiredWordCount) && Number(value.requiredWordCount) > 0;
  if (value.kind === 'exercise') return typeof value.minimumScore === 'number'
    && Number.isFinite(value.minimumScore) && value.minimumScore >= 0 && value.minimumScore <= 100;
  return false;
}

function isSchedule(value: unknown): value is ActivitySchedule {
  if (!isRecord(value) || typeof value.classId !== 'string' || typeof value.startsOn !== 'string'
    || typeof value.endsOn !== 'string' || typeof value.schoolTimeZone !== 'string'
    || !Array.isArray(value.restDates) || !value.restDates.every(date => typeof date === 'string')
    || !Array.isArray(value.conditions) || !value.conditions.every(isCondition)) return false;
  return validateActivitySchedule(value as unknown as ActivitySchedule);
}

function validDailyInstances(value: unknown, activityId: string, schedule: ActivitySchedule,
  publishedAt: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const days = publishedAt === null ? [] : activityDays(schedule);
  if (value.length !== days.length) return false;
  return value.every((instance, index) => isRecord(instance)
    && typeof instance.date === 'string' && instance.date === days[index]
    && instance.id === `${activityId}:${instance.date}` && instance.classId === schedule.classId
    && Number.isSafeInteger(instance.activityVersion) && Number(instance.activityVersion) >= 1
    && isOffsetIso(instance.createdAt));
}

function isActivity(value: unknown): value is ActivityEntity {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.organizationId === 'string' && typeof value.creatorTeacherId === 'string'
    && typeof value.title === 'string' && typeof value.description === 'string'
    && isSchedule(value.schedule)
    && (value.status === 'draft' || value.status === 'published' || value.status === 'closed')
    && Array.isArray(value.participants) && value.participants.every(person => isRecord(person)
      && typeof person.studentId === 'string' && person.studentId.length > 0
      && typeof person.displayNameMasked === 'string' && person.displayNameMasked.length > 0)
    && Array.isArray(value.conditionSnapshots) && value.conditionSnapshots.every(snapshot => isRecord(snapshot)
      && (snapshot.kind === 'reading' || snapshot.kind === 'vocabulary' || snapshot.kind === 'exercise' || snapshot.kind === 'work')
      && typeof snapshot.resourceId === 'string' && snapshot.resourceId.length > 0
      && typeof snapshot.contentVersion === 'string' && snapshot.contentVersion.length > 0
      && (snapshot.pageIds === undefined || (Array.isArray(snapshot.pageIds) && snapshot.pageIds.every(id => typeof id === 'string')))
      && (snapshot.wordIds === undefined || (Array.isArray(snapshot.wordIds) && snapshot.wordIds.every(id => typeof id === 'string')))
      && (snapshot.questionIds === undefined || (Array.isArray(snapshot.questionIds) && snapshot.questionIds.every(id => typeof id === 'string'))))
    && (value.publishedAt === null ? value.conditionSnapshots.length === 0 && value.participants.length === 0
      : value.conditionSnapshots.length === value.schedule.conditions.length && value.participants.length > 0)
    && validDailyInstances(value.dailyInstances, value.id, value.schedule as ActivitySchedule, value.publishedAt)
    && (value.restDayChanges === undefined || (Array.isArray(value.restDayChanges)
      && value.restDayChanges.every(change => isRecord(change) && typeof change.id === 'string' && change.id.length > 0
        && typeof change.date === 'string' && (value.schedule as ActivitySchedule).restDates.includes(change.date)
        && typeof change.reason === 'string' && change.reason.trim().length > 0
        && typeof change.teacherId === 'string' && change.teacherId.length > 0
        && isOffsetIso(change.changedAt) && Number.isSafeInteger(change.activityVersion)
        && Number(change.activityVersion) >= 1 && Number(change.activityVersion) <= Number(value.version))
      && new Set(value.restDayChanges.map(change => isRecord(change) ? change.date : '')).size === value.restDayChanges.length))
    && Number.isSafeInteger(value.version) && Number(value.version) >= 1
    && isOffsetIso(value.createdAt) && isOffsetIso(value.updatedAt)
    && (value.publishedAt === null || isOffsetIso(value.publishedAt))
    && (value.closedAt === null || isOffsetIso(value.closedAt));
}

export function projectActivity(value: unknown): ActivityEntity | null {
  if (!isActivity(value)) return null;
  return {
    id: value.id, organizationId: value.organizationId, creatorTeacherId: value.creatorTeacherId,
    title: value.title, description: value.description,
    schedule: { classId: value.schedule.classId, startsOn: value.schedule.startsOn, endsOn: value.schedule.endsOn,
      schoolTimeZone: value.schedule.schoolTimeZone, restDates: [...value.schedule.restDates],
      conditions: value.schedule.conditions.map(condition => {
        if (condition.kind === 'vocabulary') return { kind: 'vocabulary', resourceId: condition.resourceId,
          requiredWordCount: condition.requiredWordCount };
        if (condition.kind === 'exercise') return { kind: 'exercise', resourceId: condition.resourceId,
          minimumScore: condition.minimumScore };
        return { kind: condition.kind, resourceId: condition.resourceId };
      }) },
    status: value.status, participants: value.participants.map(person => ({ studentId: person.studentId,
      displayNameMasked: person.displayNameMasked })),
    conditionSnapshots: value.conditionSnapshots.map(snapshot => ({ kind: snapshot.kind,
      resourceId: snapshot.resourceId, contentVersion: snapshot.contentVersion,
      ...(snapshot.pageIds === undefined ? {} : { pageIds: [...snapshot.pageIds] }),
      ...(snapshot.wordIds === undefined ? {} : { wordIds: [...snapshot.wordIds] }),
      ...(snapshot.questionIds === undefined ? {} : { questionIds: [...snapshot.questionIds] }) })),
    dailyInstances: value.dailyInstances.map(instance => ({ id: instance.id, date: instance.date,
      classId: instance.classId, activityVersion: instance.activityVersion, createdAt: instance.createdAt })),
    restDayChanges: value.restDayChanges?.map(change => ({ id: change.id, date: change.date,
      reason: change.reason, teacherId: change.teacherId, changedAt: change.changedAt,
      activityVersion: change.activityVersion })) ?? [],
    version: value.version,
    createdAt: value.createdAt, updatedAt: value.updatedAt, publishedAt: value.publishedAt, closedAt: value.closedAt,
  };
}

function projectOverride(value: unknown): ActivityOverrideRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.organizationId !== 'string' || typeof value.activityId !== 'string'
    || typeof value.studentId !== 'string' || typeof value.classId !== 'string'
    || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || typeof value.active !== 'boolean' || typeof value.reason !== 'string' || !value.reason.trim()
    || typeof value.teacherId !== 'string' || !isOffsetIso(value.changedAt)
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1) return null;
  return { id: value.id, organizationId: value.organizationId, activityId: value.activityId,
    studentId: value.studentId, classId: value.classId, date: value.date, active: value.active,
    reason: value.reason, teacherId: value.teacherId, changedAt: value.changedAt, version: Number(value.version) };
}

function finalBoardId(activityId: string): string { return `activity_final_${activityId}`; }

function projectDateMap(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string[]> = {};
  for (const [studentId, dates] of Object.entries(value)) {
    if (!studentId || !Array.isArray(dates) || !dates.every(date => typeof date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
    result[studentId] = [...dates];
  }
  return result;
}

function projectFinalSnapshot(value: unknown): ActivityFinalSnapshot | null {
  if (!isRecord(value) || typeof value.organizationId !== 'string' || typeof value.activityId !== 'string'
    || !Number.isSafeInteger(value.activityVersion) || Number(value.activityVersion) < 1
    || !isOffsetIso(value.lockedAt) || !isRecord(value.leaderboard)) return null;
  const board = value.leaderboard;
  if (typeof board.classId !== 'string' || !Number.isSafeInteger(board.effectiveDayCount)
    || typeof board.finalized !== 'boolean' || !board.finalized || !Array.isArray(board.ranks)
    || !board.ranks.every(rank => isRecord(rank) && typeof rank.studentId === 'string'
      && typeof rank.displayNameMasked === 'string' && Number.isSafeInteger(rank.completedDays)
      && Number.isSafeInteger(rank.rank))) return null;
  const completed = projectDateMap(value.completedDatesByStudent);
  const supplemented = projectDateMap(value.supplementedDatesByStudent);
  if (!completed || !supplemented) return null;
  const rankIds = board.ranks.map(rank => String(rank.studentId));
  if (new Set(rankIds).size !== rankIds.length || Object.keys(completed).length !== rankIds.length
    || Object.keys(supplemented).length !== rankIds.length) return null;
  for (const rank of board.ranks) {
    const id = String(rank.studentId);
    const dates = completed[id];
    const supplementedDates = supplemented[id];
    if (!dates || !supplementedDates || new Set(dates).size !== dates.length
      || new Set(supplementedDates).size !== supplementedDates.length
      || dates.length !== Number(rank.completedDays) || dates.length > Number(board.effectiveDayCount)
      || supplementedDates.some(date => !dates.includes(date))) return null;
  }
  return { organizationId: value.organizationId, activityId: value.activityId,
    activityVersion: Number(value.activityVersion), lockedAt: value.lockedAt,
    leaderboard: { classId: board.classId, effectiveDayCount: Number(board.effectiveDayCount), finalized: true,
      ranks: board.ranks.map(rank => ({ studentId: String(rank.studentId),
        displayNameMasked: String(rank.displayNameMasked), completedDays: Number(rank.completedDays), rank: Number(rank.rank) })) },
    completedDatesByStudent: completed, supplementedDatesByStudent: supplemented };
}

function json(value: object): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

function plainRecord(document: VersionedDocument): Record<string, unknown> {
  const { _id: ignoredId, schemaVersion: ignoredSchemaVersion, version, deletedAt: ignoredDeletedAt, ...record } = document;
  void ignoredId;
  void ignoredSchemaVersion;
  void ignoredDeletedAt;
  return { ...record, version };
}

function receiptId(organizationId: string, actorUserId: string, action: string, operationId: string): string {
  return `activity_operation_${hashHex(JSON.stringify([organizationId, actorUserId, action, operationId]))}`;
}

function activityDocument(activity: ActivityEntity): VersionedDocument {
  return { _id: activity.id, organizationId: activity.organizationId, schemaVersion: 1, version: activity.version,
    deletedAt: null, classId: activity.schedule.classId, creatorTeacherId: activity.creatorTeacherId,
    status: activity.status, endsOn: activity.schedule.endsOn, payload: json(activity) };
}

function decodeActivity(document: VersionedDocument | null, organizationId: string): ActivityEntity | null {
  if (!document || document.organizationId !== organizationId || document.deletedAt !== null) return null;
  const payload = projectActivity(document.payload);
  if (!payload) return null;
  if (payload.id !== document._id || payload.organizationId !== organizationId || payload.version !== document.version
    || payload.schedule.classId !== document.classId || payload.status !== document.status
    || payload.creatorTeacherId !== document.creatorTeacherId) return null;
  return payload;
}

class DocumentActivityTransaction implements ActivityTransaction {
  public constructor(private readonly database: DocumentDatabaseTransactionPort) {}

  public async findOrganization(organizationId: string): Promise<ActivityOrganization | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.organizations, organizationId);
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null
      || (document.status !== 'active' && document.status !== 'disabled') || typeof document.timeZone !== 'string') return null;
    return { id: organizationId, status: document.status, timeZone: document.timeZone };
  }

  public async findClass(organizationId: string, classId: string): Promise<ActivityClass | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.classes, classId);
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null
      || (document.status !== 'active' && document.status !== 'archived')) return null;
    return { id: classId, organizationId, status: document.status };
  }

  public async findTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<ActivityGrant | null> {
    const grants = await this.database.find(ACTIVITY_COLLECTIONS.grants, { organizationId, teacherId, classId,
      status: 'active', deletedAt: null });
    if (grants.length !== 1 || !Array.isArray(grants[0]?.permissions)
      || !grants[0].permissions.every(permission => typeof permission === 'string')) return null;
    return { organizationId, teacherId, classId, status: 'active', permissions: [...grants[0].permissions] as string[] };
  }

  public async listClassMemberships(organizationId: string, classId: string): Promise<readonly ActivityMembership[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.memberships, { organizationId, classId,
      status: 'active', deletedAt: null });
    return documents.filter(document => typeof document.studentId === 'string' && document.studentId.length > 0)
      .map(document => ({ organizationId, classId, studentId: document.studentId as string, status: 'active' as const }));
  }

  public async findUser(organizationId: string, userId: string): Promise<ActivityUser | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.users, userId);
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null
      || (document.status !== 'active' && document.status !== 'disabled')
      || typeof document.displayNameMasked !== 'string') return null;
    return { id: userId, organizationId, status: document.status, displayNameMasked: document.displayNameMasked };
  }

  public async listActiveUsers(organizationId: string): Promise<readonly ActivityUser[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.users, { organizationId,
      status: 'active', deletedAt: null });
    return documents.filter(document => typeof document.displayNameMasked === 'string'
      && document.displayNameMasked.trim().length > 0)
      .map(document => ({ id: document._id, organizationId, status: 'active' as const,
        displayNameMasked: document.displayNameMasked as string }));
  }

  public async findConditionResource(organizationId: string, resourceId: string): Promise<ActivityConditionResource | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.resources, resourceId);
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null
      || (document.status !== 'published' && document.status !== 'offline' && document.status !== 'draft')
      || (document.type !== 'reading' && document.type !== 'vocabulary' && document.type !== 'exercise' && document.type !== 'work')
      || !isRecord(document.visibility)) return null;
    const contentVersion = document.contentVersion;
    if ((typeof contentVersion !== 'string' || !contentVersion.trim())
      && (typeof contentVersion !== 'number' || !Number.isSafeInteger(contentVersion) || contentVersion < 1)) return null;
    const details = {
      contentVersion: String(contentVersion),
      ...(document.type === 'reading' ? { pageIds: readingPageIds(document) } : {}),
      ...(document.type === 'vocabulary' ? { wordIds: vocabularyWordIds(document) } : {}),
      ...(document.type === 'exercise' ? { questionIds: exerciseQuestionIds(document) } : {}),
    };
    const visibility = document.visibility;
    if (visibility.type === 'organization') return { id: resourceId, organizationId, type: document.type,
      status: document.status, visibility: { type: 'organization' }, ...details };
    if (visibility.type === 'classes' && Array.isArray(visibility.classIds)
      && visibility.classIds.every(classId => typeof classId === 'string' && classId.length > 0)) {
      return { id: resourceId, organizationId, type: document.type, status: document.status,
        visibility: { type: 'classes', classIds: [...visibility.classIds] as string[] }, ...details };
    }
    return null;
  }

  public async listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.readingPageEvents, { organizationId, studentId,
      resourceId, deletedAt: null });
    return documents.map(document => {
      if (document.organizationId !== organizationId || document.deletedAt !== null
        || document.studentId !== studentId || document.resourceId !== resourceId
        || typeof document.chapterId !== 'string' || typeof document.pageId !== 'string'
        || typeof document.pageNumber !== 'number' || !Number.isSafeInteger(document.pageNumber) || document.pageNumber < 1
        || typeof document.progressVersion !== 'number' || !Number.isSafeInteger(document.progressVersion) || document.progressVersion < 1
        || (document.contentVersion !== null && typeof document.contentVersion !== 'string')
        || typeof document.operationId !== 'string' || !isOffsetIso(document.visitedAt)) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      return { id: typeof document.id === 'string' ? document.id : document._id,
        organizationId, studentId, resourceId, chapterId: document.chapterId, pageId: document.pageId,
        pageNumber: document.pageNumber, progressVersion: document.progressVersion,
        contentVersion: document.contentVersion, operationId: document.operationId, visitedAt: document.visitedAt };
    });
  }

  public async listVocabularyAttempts(organizationId: string, studentId: string, packId: string,
    contentVersion: string): Promise<readonly VocabularyAttemptRecord[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.vocabularyAttempts, { organizationId,
      studentId, packId, contentVersion, deletedAt: null });
    return documents.map(document => {
      if (document.organizationId !== organizationId || document.deletedAt !== null
        || document.studentId !== studentId || document.packId !== packId
        || typeof document.id !== 'string' || !document.id.trim()
        || (document.taskId !== null && typeof document.taskId !== 'string')
        || (document.itemId !== null && typeof document.itemId !== 'string')
        || !Number.isSafeInteger(document.round) || Number(document.round) < 0
        || document.contentVersion !== contentVersion
        || typeof document.wordId !== 'string' || !document.wordId.trim()
        || typeof document.studentInput !== 'string' || !document.studentInput.trim()
        || typeof document.isCorrect !== 'boolean' || typeof document.firstAttempt !== 'boolean'
        || !Number.isSafeInteger(document.attemptNumber) || Number(document.attemptNumber) < 1
        || document.firstAttempt !== (document.attemptNumber === 1)
        || !isOffsetIso(document.attemptedAt)) throw new ActivityError('SERVICE_UNAVAILABLE');
      return { id: document.id, organizationId, studentId, packId,
        taskId: document.taskId, itemId: document.itemId, round: Number(document.round),
        contentVersion: document.contentVersion, wordId: document.wordId, studentInput: document.studentInput,
        isCorrect: document.isCorrect, firstAttempt: document.firstAttempt,
        attemptNumber: Number(document.attemptNumber), attemptedAt: document.attemptedAt };
    });
  }

  public async listSubmittedWorks(organizationId: string, studentId: string, materialId: string): Promise<readonly StudentWork[]> {
    const documents = await this.database.find(STUDENT_WORK_COLLECTIONS.works, { organizationId,
      studentId, materialId, status: 'submitted', deletedAt: null });
    return documents.map(document => {
      const work = projectStudentWork({ ...document, version: document.version });
      if (!work || work.organizationId !== organizationId || work.studentId !== studentId
        || work.materialId !== materialId || work.status !== 'submitted') {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      return work;
    });
  }

  public async listExerciseSources(organizationId: string, studentId: string, classId: string,
    resourceId: string): Promise<readonly ActivityExerciseSource[]> {
    const assignmentDocs = await this.database.find(ACTIVITY_COLLECTIONS.assignments, { organizationId, studentId,
      classId, deletedAt: null });
    const sources: ActivityExerciseSource[] = [];
    const tasks = new Map<string, TaskRecord>();
    for (const document of assignmentDocs) {
      const rawAssignment = plainRecord(document);
      const assignmentId = typeof rawAssignment.id === 'string' && rawAssignment.id.trim()
        ? rawAssignment.id : document._id;
      if (document.organizationId !== organizationId || document.deletedAt !== null
        || !assignmentId || typeof rawAssignment.taskId !== 'string'
        || rawAssignment.studentId !== studentId || rawAssignment.classId !== classId
        || (rawAssignment.latestSubmissionId !== null && typeof rawAssignment.latestSubmissionId !== 'string')
        || typeof rawAssignment.status !== 'string') throw new ActivityError('SERVICE_UNAVAILABLE');
      if (rawAssignment.latestSubmissionId === null) continue;
      const assignment = { ...rawAssignment, id: assignmentId } as unknown as TaskAssignmentRecord;
      if (assignment.latestSubmissionId === null) continue;
      let task = tasks.get(assignment.taskId);
      if (!task) {
        const taskDoc = await this.database.get(ACTIVITY_COLLECTIONS.tasks, assignment.taskId);
        if (!taskDoc || taskDoc.organizationId !== organizationId || taskDoc.deletedAt !== null) {
          throw new ActivityError('SERVICE_UNAVAILABLE');
        }
        const rawTask = plainRecord(taskDoc);
        const taskId = typeof rawTask.id === 'string' && rawTask.id.trim() ? rawTask.id : taskDoc._id;
        if (taskId !== assignment.taskId || !Array.isArray(rawTask.items)) {
          throw new ActivityError('SERVICE_UNAVAILABLE');
        }
        const matching = rawTask.items.filter(item => isRecord(item) && item.resourceId === resourceId);
        if (!matching.length) continue;
        if (matching.some(item => !isRecord(item.resourceSnapshot)
          || item.resourceSnapshot.type !== 'exercise')) throw new ActivityError('SERVICE_UNAVAILABLE');
        task = { ...rawTask, id: taskId } as unknown as TaskRecord;
        tasks.set(task.id, task);
      }
      if (!task.items.some(item => item.resourceId === resourceId && item.resourceSnapshot?.type === 'exercise')) continue;
      sources.push(await this.readSubmittedExerciseSource(organizationId, assignment, task));
    }
    return sources;
  }

  public async listExerciseSourcesForStudents(organizationId: string, classId: string,
    resourceId: string, studentIds: readonly string[]): Promise<Readonly<Record<string, readonly ActivityExerciseSource[]>>> {
    const allowed = new Set(studentIds);
    const grouped: Record<string, ActivityExerciseSource[]> = {};
    if (!allowed.size) return grouped;
    const taskDocs = await this.database.find(ACTIVITY_COLLECTIONS.tasks, { organizationId, deletedAt: null });
    for (const taskDoc of taskDocs) {
      if (taskDoc.organizationId !== organizationId || taskDoc.deletedAt !== null) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      const rawTask = plainRecord(taskDoc);
      if (!Array.isArray(rawTask.items)) throw new ActivityError('SERVICE_UNAVAILABLE');
      const matching = rawTask.items.filter(item => isRecord(item) && item.resourceId === resourceId);
      if (!matching.length) continue;
      if (matching.some(item => !isRecord(item.resourceSnapshot)
        || item.resourceSnapshot.type !== 'exercise')) throw new ActivityError('SERVICE_UNAVAILABLE');
      const taskId = typeof rawTask.id === 'string' && rawTask.id.trim() ? rawTask.id : taskDoc._id;
      const task = { ...rawTask, id: taskId } as unknown as TaskRecord;
      const assignments = await this.database.find(ACTIVITY_COLLECTIONS.assignments, { organizationId,
        classId, taskId, deletedAt: null });
      for (const document of assignments) {
        const raw = plainRecord(document);
        if (typeof raw.studentId !== 'string' || !allowed.has(raw.studentId)) continue;
        const assignmentId = typeof raw.id === 'string' && raw.id.trim() ? raw.id : document._id;
        if (document.organizationId !== organizationId || document.deletedAt !== null
          || raw.classId !== classId || raw.taskId !== taskId || !assignmentId
          || (raw.latestSubmissionId !== null && typeof raw.latestSubmissionId !== 'string')
          || typeof raw.status !== 'string') throw new ActivityError('SERVICE_UNAVAILABLE');
        if (raw.latestSubmissionId === null) continue;
        const assignment = { ...raw, id: assignmentId } as unknown as TaskAssignmentRecord;
        const source = await this.readSubmittedExerciseSource(organizationId, assignment, task);
        grouped[raw.studentId] = [...(grouped[raw.studentId] ?? []), source];
      }
    }
    return grouped;
  }

  private async readSubmittedExerciseSource(organizationId: string,
    assignment: TaskAssignmentRecord, task: TaskRecord): Promise<ActivityExerciseSource> {
    if (assignment.latestSubmissionId === null) throw new ActivityError('SERVICE_UNAVAILABLE');
    const submissionDoc = await this.database.get(ACTIVITY_COLLECTIONS.submissions,
      submissionByIdDocumentId(organizationId, assignment.latestSubmissionId));
      if (!submissionDoc || submissionDoc.organizationId !== organizationId || submissionDoc.deletedAt !== null) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      const rawSubmission = plainRecord(submissionDoc);
      if (rawSubmission.id !== assignment.latestSubmissionId || !Array.isArray(rawSubmission.answers)
        || !rawSubmission.answers.every(answer => isRecord(answer) && typeof answer.itemId === 'string'
          && answer.value !== undefined)) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      const submission = rawSubmission as unknown as SubmissionRecord;
      const feedbackDoc = await this.database.get(ACTIVITY_COLLECTIONS.feedback,
        feedbackDocumentId(organizationId, submission.id));
      let feedback: ReviewFeedbackRecord | null = null;
      if (feedbackDoc) {
        if (feedbackDoc.organizationId !== organizationId || feedbackDoc.deletedAt !== null) {
          throw new ActivityError('SERVICE_UNAVAILABLE');
        }
        const rawFeedback = plainRecord(feedbackDoc);
        if (typeof rawFeedback.id !== 'string' || rawFeedback.submissionId !== submission.id) {
          throw new ActivityError('SERVICE_UNAVAILABLE');
        }
        feedback = rawFeedback as unknown as ReviewFeedbackRecord;
      }
    return { task, assignment, submission, feedback };
  }

  public async findActivity(organizationId: string, activityId: string): Promise<ActivityEntity | null> {
    return decodeActivity(await this.database.get(ACTIVITY_COLLECTIONS.activities, activityId), organizationId);
  }

  public async listActivities(organizationId: string): Promise<readonly ActivityEntity[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.activities, { organizationId, deletedAt: null });
    return documents.map(document => decodeActivity(document, organizationId))
      .filter((activity): activity is ActivityEntity => activity !== null);
  }

  public async saveActivity(activity: ActivityEntity, expectedVersion: number): Promise<boolean> {
    const document = activityDocument(activity);
    return expectedVersion === 0
      ? this.database.create(ACTIVITY_COLLECTIONS.activities, document)
      : this.database.replace(ACTIVITY_COLLECTIONS.activities, activity.id, expectedVersion, document);
  }

  public async findReceipt(organizationId: string, actorUserId: string, action: ActivityOperationReceipt['action'],
    operationId: string): Promise<ActivityOperationReceipt | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.receipts, receiptId(organizationId, actorUserId, action, operationId));
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null
      || document.actorUserId !== actorUserId || document.action !== action || document.operationId !== operationId
      || typeof document.fingerprint !== 'string') return null;
    const result = projectActivity(document.result);
    if (!result || result.organizationId !== organizationId || result.creatorTeacherId !== actorUserId) return null;
    return { organizationId, actorUserId, action, operationId, fingerprint: document.fingerprint, result };
  }

  public async saveReceipt(receipt: ActivityOperationReceipt): Promise<boolean> {
    return this.database.create(ACTIVITY_COLLECTIONS.receipts, { _id: receiptId(receipt.organizationId, receipt.actorUserId,
      receipt.action, receipt.operationId), organizationId: receipt.organizationId, schemaVersion: 1, version: 1,
    deletedAt: null, actorUserId: receipt.actorUserId, action: receipt.action, operationId: receipt.operationId,
    fingerprint: receipt.fingerprint, result: json(receipt.result) });
  }

  public async listOverrides(organizationId: string, activityId: string, studentId: string,
    date: string): Promise<readonly ActivityOverrideRecord[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.overrides, { organizationId, activityId,
      studentId, date, deletedAt: null });
    const records = documents.map(document => {
      const projected = projectOverride({ ...document, id: document.id ?? document._id,
        version: document.overrideVersion });
      if (!projected || projected.organizationId !== organizationId || projected.activityId !== activityId
        || projected.studentId !== studentId || projected.date !== date) throw new ActivityError('SERVICE_UNAVAILABLE');
      return projected;
    }).sort((left, right) => left.version - right.version);
    if (new Set(records.map(item => item.version)).size !== records.length) throw new ActivityError('SERVICE_UNAVAILABLE');
    return records;
  }

  public async listActivityOverrides(organizationId: string, activityId: string): Promise<readonly ActivityOverrideRecord[]> {
    const documents = await this.database.find(ACTIVITY_COLLECTIONS.overrides, { organizationId, activityId, deletedAt: null });
    return documents.map(document => {
      const projected = projectOverride({ ...document, id: document.id ?? document._id,
        version: document.overrideVersion });
      if (!projected || projected.organizationId !== organizationId || projected.activityId !== activityId) {
        throw new ActivityError('SERVICE_UNAVAILABLE');
      }
      return projected;
    });
  }

  public async appendOverride(record: ActivityOverrideRecord): Promise<boolean> {
    return this.database.create(ACTIVITY_COLLECTIONS.overrides, {
      _id: record.id, organizationId: record.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      id: record.id, activityId: record.activityId, studentId: record.studentId, classId: record.classId,
      date: record.date, active: record.active, reason: record.reason, teacherId: record.teacherId,
      changedAt: record.changedAt, overrideVersion: record.version,
    });
  }

  public async findOverrideReceipt(organizationId: string, actorUserId: string,
    operationId: string): Promise<ActivityOverrideReceipt | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.receipts,
      receiptId(organizationId, actorUserId, 'setOverride', operationId));
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null
      || document.actorUserId !== actorUserId || document.action !== 'setOverride'
      || document.operationId !== operationId || typeof document.fingerprint !== 'string') return null;
    const result = projectOverride(document.result);
    if (!result || result.organizationId !== organizationId || result.teacherId !== actorUserId) return null;
    return { organizationId, actorUserId, operationId, fingerprint: document.fingerprint, result };
  }

  public async saveOverrideReceipt(receipt: ActivityOverrideReceipt): Promise<boolean> {
    return this.database.create(ACTIVITY_COLLECTIONS.receipts, {
      _id: receiptId(receipt.organizationId, receipt.actorUserId, 'setOverride', receipt.operationId),
      organizationId: receipt.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      actorUserId: receipt.actorUserId, action: 'setOverride', operationId: receipt.operationId,
      fingerprint: receipt.fingerprint, result: json(receipt.result),
    });
  }

  public async findFinalSnapshot(organizationId: string, activityId: string): Promise<ActivityFinalSnapshot | null> {
    const document = await this.database.get(ACTIVITY_COLLECTIONS.finalBoards, finalBoardId(activityId));
    if (!document || document.organizationId !== organizationId || document.deletedAt !== null) return null;
    const projected = projectFinalSnapshot(document.payload);
    if (!projected || projected.organizationId !== organizationId || projected.activityId !== activityId) {
      throw new ActivityError('SERVICE_UNAVAILABLE');
    }
    return projected;
  }

  public async createFinalSnapshot(snapshot: ActivityFinalSnapshot): Promise<boolean> {
    return this.database.create(ACTIVITY_COLLECTIONS.finalBoards, {
      _id: finalBoardId(snapshot.activityId), organizationId: snapshot.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, activityId: snapshot.activityId,
      classId: snapshot.leaderboard.classId, lockedAt: snapshot.lockedAt, payload: json(snapshot),
    });
  }
}

export class DocumentActivityRepository implements ActivityUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}
  public transaction<T>(work: (transaction: ActivityTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(transaction => work(new DocumentActivityTransaction(transaction)));
  }
}
