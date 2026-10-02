import type { ActivityTransaction, ActivityUnitOfWork } from './repository';
import type { ActivityClass, ActivityConditionResource, ActivityEntity, ActivityExerciseSource, ActivityFinalSnapshot, ActivityGrant, ActivityMembership,
  ActivityOperationReceipt, ActivityOrganization, ActivityOverrideReceipt, ActivityOverrideRecord, ActivityUser } from './types';
import type { ReadingPageEventRecord } from '../learning-progress/types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { StudentWork } from '../student-work/types';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';

export interface ActivityFixture {
  readonly organizations?: readonly ActivityOrganization[];
  readonly classes?: readonly ActivityClass[];
  readonly grants?: readonly ActivityGrant[];
  readonly memberships?: readonly ActivityMembership[];
  readonly users?: readonly ActivityUser[];
  readonly resources?: readonly ActivityConditionResource[];
  readonly readingPageEvents?: readonly ReadingPageEventRecord[];
  readonly vocabularyAttempts?: readonly VocabularyAttemptRecord[];
  readonly studentWorks?: readonly StudentWork[];
  readonly tasks?: readonly TaskRecord[];
  readonly assignments?: readonly TaskAssignmentRecord[];
  readonly submissions?: readonly SubmissionRecord[];
  readonly feedback?: readonly ReviewFeedbackRecord[];
  readonly activities?: readonly ActivityEntity[];
  readonly receipts?: readonly ActivityOperationReceipt[];
  readonly overrides?: readonly ActivityOverrideRecord[];
  readonly overrideReceipts?: readonly ActivityOverrideReceipt[];
  readonly finalSnapshots?: readonly ActivityFinalSnapshot[];
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

interface MutableActivityState {
  organizations: ActivityOrganization[];
  classes: ActivityClass[];
  grants: ActivityGrant[];
  memberships: ActivityMembership[];
  users: ActivityUser[];
  resources: ActivityConditionResource[];
  readingPageEvents: ReadingPageEventRecord[];
  vocabularyAttempts: VocabularyAttemptRecord[];
  studentWorks: StudentWork[];
  tasks: TaskRecord[];
  assignments: TaskAssignmentRecord[];
  submissions: SubmissionRecord[];
  feedback: ReviewFeedbackRecord[];
  activities: ActivityEntity[];
  receipts: ActivityOperationReceipt[];
  overrides: ActivityOverrideRecord[];
  overrideReceipts: ActivityOverrideReceipt[];
  finalSnapshots: ActivityFinalSnapshot[];
}

export class InMemoryActivityRepository implements ActivityUnitOfWork, ActivityTransaction {
  private state: MutableActivityState;
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(fixture: ActivityFixture = {}) {
    this.state = copy({ organizations: [...(fixture.organizations ?? [])], classes: [...(fixture.classes ?? [])],
      grants: [...(fixture.grants ?? [])], memberships: [...(fixture.memberships ?? [])], users: [...(fixture.users ?? [])],
      resources: [...(fixture.resources ?? [])], readingPageEvents: [...(fixture.readingPageEvents ?? [])],
      vocabularyAttempts: [...(fixture.vocabularyAttempts ?? [])],
      studentWorks: [...(fixture.studentWorks ?? [])],
      tasks: [...(fixture.tasks ?? [])], assignments: [...(fixture.assignments ?? [])],
      submissions: [...(fixture.submissions ?? [])], feedback: [...(fixture.feedback ?? [])],
      activities: [...(fixture.activities ?? [])], receipts: [...(fixture.receipts ?? [])],
      overrides: [...(fixture.overrides ?? [])], overrideReceipts: [...(fixture.overrideReceipts ?? [])],
      finalSnapshots: [...(fixture.finalSnapshots ?? [])] });
  }

  public async transaction<T>(work: (transaction: ActivityTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = copy(this.state);
    try { return await work(this); }
    catch (error: unknown) { this.state = before; throw error; }
    finally { release(); }
  }

  public async findOrganization(organizationId: string): Promise<ActivityOrganization | null> {
    return copy(this.state.organizations.find(item => item.id === organizationId) ?? null);
  }
  public async findClass(organizationId: string, classId: string): Promise<ActivityClass | null> {
    return copy(this.state.classes.find(item => item.organizationId === organizationId && item.id === classId) ?? null);
  }
  public async findTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<ActivityGrant | null> {
    return copy(this.state.grants.find(item => item.organizationId === organizationId && item.teacherId === teacherId
      && item.classId === classId && item.status === 'active') ?? null);
  }
  public async listClassMemberships(organizationId: string, classId: string): Promise<readonly ActivityMembership[]> {
    return copy(this.state.memberships.filter(item => item.organizationId === organizationId && item.classId === classId && item.status === 'active'));
  }
  public async findUser(organizationId: string, userId: string): Promise<ActivityUser | null> {
    return copy(this.state.users.find(item => item.organizationId === organizationId && item.id === userId) ?? null);
  }
  public async listActiveUsers(organizationId: string): Promise<readonly ActivityUser[]> {
    return copy(this.state.users.filter(item => item.organizationId === organizationId && item.status === 'active'));
  }
  public async findConditionResource(organizationId: string, resourceId: string): Promise<ActivityConditionResource | null> {
    return copy(this.state.resources.find(item => item.organizationId === organizationId && item.id === resourceId) ?? null);
  }
  public async listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]> {
    return copy(this.state.readingPageEvents.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.resourceId === resourceId));
  }
  public async listVocabularyAttempts(organizationId: string, studentId: string, packId: string,
    contentVersion: string): Promise<readonly VocabularyAttemptRecord[]> {
    return copy(this.state.vocabularyAttempts.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.packId === packId && item.contentVersion === contentVersion));
  }
  public async listSubmittedWorks(organizationId: string, studentId: string, materialId: string): Promise<readonly StudentWork[]> {
    return copy(this.state.studentWorks.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.materialId === materialId && item.status === 'submitted'));
  }
  public async listExerciseSources(organizationId: string, studentId: string, classId: string, resourceId: string): Promise<readonly ActivityExerciseSource[]> {
    const sources: ActivityExerciseSource[] = [];
    for (const assignment of this.state.assignments.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.classId === classId && item.latestSubmissionId)) {
      const task = this.state.tasks.find(item => item.organizationId === organizationId && item.id === assignment.taskId
        && item.items.some(content => content.resourceId === resourceId && content.resourceSnapshot.type === 'exercise'));
      const submission = this.state.submissions.find(item => item.organizationId === organizationId
        && item.id === assignment.latestSubmissionId);
      if (!task || !submission) continue;
      sources.push(copy({ task, assignment, submission,
        feedback: this.state.feedback.find(item => item.organizationId === organizationId
          && item.submissionId === submission.id) ?? null }));
    }
    return sources;
  }
  public async listExerciseSourcesForStudents(organizationId: string, classId: string,
    resourceId: string, studentIds: readonly string[]): Promise<Readonly<Record<string, readonly ActivityExerciseSource[]>>> {
    const result: Record<string, readonly ActivityExerciseSource[]> = {};
    for (const studentId of new Set(studentIds)) {
      result[studentId] = await this.listExerciseSources(organizationId, studentId, classId, resourceId);
    }
    return result;
  }
  public async findActivity(organizationId: string, activityId: string): Promise<ActivityEntity | null> {
    return copy(this.state.activities.find(item => item.organizationId === organizationId && item.id === activityId) ?? null);
  }
  public async listActivities(organizationId: string): Promise<readonly ActivityEntity[]> {
    return copy(this.state.activities.filter(item => item.organizationId === organizationId));
  }
  public async saveActivity(activity: ActivityEntity, expectedVersion: number): Promise<boolean> {
    const index = this.state.activities.findIndex(item => item.organizationId === activity.organizationId && item.id === activity.id);
    if (index < 0 && expectedVersion !== 0) return false;
    if (index >= 0 && this.state.activities[index]?.version !== expectedVersion) return false;
    if (index < 0) this.state.activities.push(copy(activity));
    else this.state.activities[index] = copy(activity);
    return true;
  }
  public async findReceipt(organizationId: string, actorUserId: string, action: ActivityOperationReceipt['action'], operationId: string): Promise<ActivityOperationReceipt | null> {
    return copy(this.state.receipts.find(item => item.organizationId === organizationId && item.actorUserId === actorUserId
      && item.action === action && item.operationId === operationId) ?? null);
  }
  public async saveReceipt(receipt: ActivityOperationReceipt): Promise<boolean> {
    if (this.state.receipts.some(item => item.organizationId === receipt.organizationId && item.actorUserId === receipt.actorUserId
      && item.action === receipt.action && item.operationId === receipt.operationId)) return false;
    this.state.receipts.push(copy(receipt));
    return true;
  }
  public async listOverrides(organizationId: string, activityId: string, studentId: string, date: string): Promise<readonly ActivityOverrideRecord[]> {
    return copy(this.state.overrides.filter(item => item.organizationId === organizationId && item.activityId === activityId
      && item.studentId === studentId && item.date === date));
  }
  public async listActivityOverrides(organizationId: string, activityId: string): Promise<readonly ActivityOverrideRecord[]> {
    return copy(this.state.overrides.filter(item => item.organizationId === organizationId && item.activityId === activityId));
  }
  public async appendOverride(record: ActivityOverrideRecord): Promise<boolean> {
    if (this.state.overrides.some(item => item.id === record.id)) return false;
    this.state.overrides.push(copy(record));
    return true;
  }
  public async findOverrideReceipt(organizationId: string, actorUserId: string, operationId: string): Promise<ActivityOverrideReceipt | null> {
    return copy(this.state.overrideReceipts.find(item => item.organizationId === organizationId
      && item.actorUserId === actorUserId && item.operationId === operationId) ?? null);
  }
  public async saveOverrideReceipt(receipt: ActivityOverrideReceipt): Promise<boolean> {
    if (this.state.overrideReceipts.some(item => item.organizationId === receipt.organizationId
      && item.actorUserId === receipt.actorUserId && item.operationId === receipt.operationId)) return false;
    this.state.overrideReceipts.push(copy(receipt));
    return true;
  }
  public async findFinalSnapshot(organizationId: string, activityId: string): Promise<ActivityFinalSnapshot | null> {
    return copy(this.state.finalSnapshots.find(item => item.organizationId === organizationId && item.activityId === activityId) ?? null);
  }
  public async createFinalSnapshot(snapshot: ActivityFinalSnapshot): Promise<boolean> {
    if (this.state.finalSnapshots.some(item => item.organizationId === snapshot.organizationId && item.activityId === snapshot.activityId)) return false;
    this.state.finalSnapshots.push(copy(snapshot));
    return true;
  }
  public snapshot(): Readonly<MutableActivityState> { return copy(this.state); }
}
