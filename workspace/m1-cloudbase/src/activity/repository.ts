import type { ActivityClass, ActivityConditionResource, ActivityEntity, ActivityExerciseSource, ActivityFinalSnapshot, ActivityGrant, ActivityMembership,
  ActivityOperationReceipt, ActivityOrganization, ActivityOverrideReceipt, ActivityOverrideRecord, ActivityUser } from './types';
import type { ReadingPageEventRecord } from '../learning-progress/types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { StudentWork } from '../student-work/types';

export interface ActivityTransaction {
  findOrganization(organizationId: string): Promise<ActivityOrganization | null>;
  findClass(organizationId: string, classId: string): Promise<ActivityClass | null>;
  findTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<ActivityGrant | null>;
  listClassMemberships(organizationId: string, classId: string): Promise<readonly ActivityMembership[]>;
  findUser(organizationId: string, userId: string): Promise<ActivityUser | null>;
  listActiveUsers(organizationId: string): Promise<readonly ActivityUser[]>;
  findConditionResource(organizationId: string, resourceId: string): Promise<ActivityConditionResource | null>;
  listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]>;
  listVocabularyAttempts(organizationId: string, studentId: string, packId: string,
    contentVersion: string): Promise<readonly VocabularyAttemptRecord[]>;
  listSubmittedWorks(organizationId: string, studentId: string, materialId: string): Promise<readonly StudentWork[]>;
  listExerciseSources(organizationId: string, studentId: string, classId: string, resourceId: string): Promise<readonly ActivityExerciseSource[]>;
  listExerciseSourcesForStudents(organizationId: string, classId: string, resourceId: string,
    studentIds: readonly string[]): Promise<Readonly<Record<string, readonly ActivityExerciseSource[]>>>;
  findActivity(organizationId: string, activityId: string): Promise<ActivityEntity | null>;
  listActivities(organizationId: string): Promise<readonly ActivityEntity[]>;
  saveActivity(activity: ActivityEntity, expectedVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, actorUserId: string, action: ActivityOperationReceipt['action'], operationId: string): Promise<ActivityOperationReceipt | null>;
  saveReceipt(receipt: ActivityOperationReceipt): Promise<boolean>;
  listOverrides(organizationId: string, activityId: string, studentId: string, date: string): Promise<readonly ActivityOverrideRecord[]>;
  listActivityOverrides(organizationId: string, activityId: string): Promise<readonly ActivityOverrideRecord[]>;
  appendOverride(record: ActivityOverrideRecord): Promise<boolean>;
  findOverrideReceipt(organizationId: string, actorUserId: string, operationId: string): Promise<ActivityOverrideReceipt | null>;
  saveOverrideReceipt(receipt: ActivityOverrideReceipt): Promise<boolean>;
  findFinalSnapshot(organizationId: string, activityId: string): Promise<ActivityFinalSnapshot | null>;
  createFinalSnapshot(snapshot: ActivityFinalSnapshot): Promise<boolean>;
}

export interface ActivityUnitOfWork {
  transaction<T>(work: (transaction: ActivityTransaction) => Promise<T>): Promise<T>;
}
