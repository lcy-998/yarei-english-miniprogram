import type { JsonValue } from '../shared/protocol';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import type { TaskQueryRepository } from './repository';
import type { QueryResourceOptionRecord, QueryTeacherGrantRecord } from './types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { ReadingPageEventRecord } from '../learning-progress/types';

export interface TaskQueryFixture {
  readonly teacherGrants?: readonly QueryTeacherGrantRecord[];
  readonly resources?: readonly QueryResourceOptionRecord[];
  readonly tasks?: readonly TaskRecord[];
  readonly assignments?: readonly TaskAssignmentRecord[];
  readonly submissions?: readonly SubmissionRecord[];
  readonly feedback?: readonly ReviewFeedbackRecord[];
  readonly vocabularyAttempts?: readonly VocabularyAttemptRecord[];
  readonly readingPageEvents?: readonly ReadingPageEventRecord[];
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  return value;
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    targetClassIds: [...task.targetClassIds],
    targetStudentIds: [...task.targetStudentIds],
    itemRefs: task.itemRefs.map((item) => ({
      ...item,
      ...(item.completionRule === undefined ? {} : { completionRule: cloneJson(item.completionRule) as typeof item.completionRule }),
      ...(item.scoringRule === undefined ? {} : { scoringRule: cloneJson(item.scoringRule) as typeof item.scoringRule }),
    })),
    items: task.items.map((item) => ({
      ...item,
      resourceSnapshot: { ...item.resourceSnapshot, payload: cloneJson(item.resourceSnapshot.payload) as typeof item.resourceSnapshot.payload },
      completionRule: cloneJson(item.completionRule) as typeof item.completionRule,
      scoringRule: cloneJson(item.scoringRule) as typeof item.scoringRule,
    })),
  };
}

function cloneSubmission(submission: SubmissionRecord): SubmissionRecord {
  return { ...submission, answers: submission.answers.map((answer) => ({ itemId: answer.itemId, value: cloneJson(answer.value) })) };
}

export class InMemoryTaskQueryRepository implements TaskQueryRepository {
  private teacherGrants: QueryTeacherGrantRecord[];
  private readonly resources: QueryResourceOptionRecord[];
  private readonly tasks: TaskRecord[];
  private readonly assignments: TaskAssignmentRecord[];
  private readonly submissions: SubmissionRecord[];
  private readonly feedback: ReviewFeedbackRecord[];
  private readonly vocabularyAttempts: VocabularyAttemptRecord[];
  private readonly readingPageEvents: ReadingPageEventRecord[];

  public constructor(fixture: TaskQueryFixture) {
    this.teacherGrants = (fixture.teacherGrants ?? []).map((item) => ({ ...item, permissions: [...item.permissions] }));
    this.resources = (fixture.resources ?? []).map((item) => ({ ...item, allowedClassIds: [...item.allowedClassIds] }));
    this.tasks = (fixture.tasks ?? []).map(cloneTask);
    this.assignments = (fixture.assignments ?? []).map((item) => ({ ...item }));
    this.submissions = (fixture.submissions ?? []).map(cloneSubmission);
    this.feedback = (fixture.feedback ?? []).map((item) => ({ ...item }));
    this.vocabularyAttempts = (fixture.vocabularyAttempts ?? []).map((item) => ({ ...item }));
    this.readingPageEvents = (fixture.readingPageEvents ?? []).map((item) => ({ ...item }));
  }

  public replaceTeacherGrant(grant: QueryTeacherGrantRecord): void {
    this.teacherGrants = [...this.teacherGrants.filter((item) => item.id !== grant.id), { ...grant, permissions: [...grant.permissions] }];
  }

  public async listActiveTeacherGrants(organizationId: string, teacherId: string): Promise<readonly QueryTeacherGrantRecord[]> {
    return this.teacherGrants
      .filter((item) => item.organizationId === organizationId && item.teacherId === teacherId && item.status === 'active')
      .map((item) => ({ ...item, permissions: [...item.permissions] }));
  }

  public async listTasks(organizationId: string): Promise<readonly TaskRecord[]> {
    return this.tasks.filter((item) => item.organizationId === organizationId).map(cloneTask);
  }

  public async findTask(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    const found = this.tasks.find((item) => item.organizationId === organizationId && item.id === taskId);
    return found === undefined ? null : cloneTask(found);
  }

  public async listAssignments(organizationId: string): Promise<readonly TaskAssignmentRecord[]> {
    return this.assignments.filter((item) => item.organizationId === organizationId).map((item) => ({ ...item }));
  }

  public async findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null> {
    const found = this.assignments.find((item) => item.organizationId === organizationId && item.taskId === taskId && item.studentId === studentId);
    return found === undefined ? null : { ...found };
  }

  public async findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null> {
    const found = this.assignments.find((item) => item.organizationId === organizationId && item.id === assignmentId);
    return found === undefined ? null : { ...found };
  }

  public async listSubmissions(organizationId: string): Promise<readonly SubmissionRecord[]> {
    return this.submissions.filter((item) => item.organizationId === organizationId).map(cloneSubmission);
  }

  public async listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]> {
    return this.submissions.filter((item) => item.organizationId === organizationId && item.taskId === taskId).map(cloneSubmission);
  }

  public async findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null> {
    const found = this.submissions.find((item) => item.organizationId === organizationId
      && item.assignmentId === assignmentId
      && item.submissionVersion === submissionVersion
      && item.status === 'draft');
    return found === undefined ? null : cloneSubmission(found);
  }

  public async findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null> {
    const found = this.submissions.find((item) => item.organizationId === organizationId && item.id === submissionId);
    return found === undefined ? null : cloneSubmission(found);
  }

  public async findFeedback(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null> {
    const found = this.feedback.find((item) => item.organizationId === organizationId && item.submissionId === submissionId);
    return found === undefined ? null : { ...found };
  }

  public async listVocabularyAttempts(organizationId: string, studentId: string, packId: string,
    taskId: string, itemId: string, round: number, contentVersion: string): Promise<readonly VocabularyAttemptRecord[]> {
    return this.vocabularyAttempts.filter((item) => item.organizationId === organizationId && item.studentId === studentId
      && item.packId === packId && item.taskId === taskId && item.itemId === itemId
      && item.round === round && item.contentVersion === contentVersion).map((item) => ({ ...item }));
  }

  public async listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]> {
    return this.readingPageEvents.filter(item => item.organizationId === organizationId && item.studentId === studentId
      && item.resourceId === resourceId).map(item => ({ ...item }));
  }

  public async listPublishedResourceOptions(organizationId: string): Promise<readonly QueryResourceOptionRecord[]> {
    return this.resources
      .filter((item) => item.organizationId === organizationId && item.status === 'published')
      .map((item) => ({ ...item, allowedClassIds: [...item.allowedClassIds] }));
  }

  public async findPublishedResourceOption(organizationId: string, resourceId: string): Promise<QueryResourceOptionRecord | null> {
    const found = this.resources.find((item) => item.organizationId === organizationId && item.id === resourceId && item.status === 'published');
    return found === undefined ? null : { ...found, allowedClassIds: [...found.allowedClassIds] };
  }
}
