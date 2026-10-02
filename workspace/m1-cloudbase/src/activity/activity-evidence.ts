import { localDateAt, type DailyEvidence } from '../task-core/activity-rules';
import type { ReadingPageEventRecord } from '../learning-progress/types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { StudentWork } from '../student-work/types';
import type { ActivityConditionSnapshot } from './types';
import { evaluateExerciseSubmission, readExerciseQuestionSnapshot } from '../task-core/exercise-evidence';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import type { JsonObject } from '../shared/protocol';

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A reading condition is complete only when every frozen page was visited on the same school-local day. */
export function readingEvidenceFromPageEvents(input: Readonly<{
  snapshot: ActivityConditionSnapshot;
  events: readonly ReadingPageEventRecord[];
  organizationId: string;
  studentId: string;
  date: string;
  schoolTimeZone: string;
}>): DailyEvidence | null {
  const { snapshot, events, organizationId, studentId, date, schoolTimeZone } = input;
  const required = snapshot.pageIds;
  if (snapshot.kind !== 'reading' || !required?.length || !snapshot.contentVersion.trim()
    || new Set(required).size !== required.length) return null;
  const requiredIds = new Set(required);
  const visits = events.filter(event => event.organizationId === organizationId && event.studentId === studentId
    && event.resourceId === snapshot.resourceId && event.contentVersion === snapshot.contentVersion
    && event.progressVersion >= 1 && requiredIds.has(event.pageId)
    && Number.isFinite(Date.parse(event.visitedAt))
    && localDateAt(event.visitedAt, schoolTimeZone) === date);
  if (new Set(visits.map(event => event.pageId)).size !== requiredIds.size) return null;
  const lastVisit = visits.reduce((latest, event) => !latest || Date.parse(event.visitedAt) > Date.parse(latest)
    ? event.visitedAt : latest, '');
  return { kind: 'reading', resourceId: snapshot.resourceId, completed: true, submittedAt: lastVisit };
}

/** Counts distinct words first attempted after publication on one school-local day. */
export function vocabularyEvidenceFromAttempts(input: Readonly<{
  snapshot: ActivityConditionSnapshot;
  attempts: readonly VocabularyAttemptRecord[];
  organizationId: string;
  studentId: string;
  date: string;
  schoolTimeZone: string;
  publishedAt: string;
  requiredWordCount: number;
}>): DailyEvidence | null {
  const { snapshot, attempts, organizationId, studentId, date, schoolTimeZone, publishedAt, requiredWordCount } = input;
  const required = snapshot.wordIds;
  if (snapshot.kind !== 'vocabulary' || !required?.length || !snapshot.contentVersion.trim()
    || new Set(required).size !== required.length
    || !Number.isSafeInteger(requiredWordCount) || requiredWordCount < 1 || requiredWordCount > required.length
    || !Number.isFinite(Date.parse(publishedAt))) return null;
  const allowed = new Set(required);
  const firstByWord = new Map<string, VocabularyAttemptRecord>();
  for (const attempt of attempts) {
    if (attempt.organizationId !== organizationId || attempt.studentId !== studentId
      || attempt.packId !== snapshot.resourceId || attempt.contentVersion !== snapshot.contentVersion
      || !allowed.has(attempt.wordId) || !attempt.firstAttempt || attempt.attemptNumber !== 1
      || !Number.isFinite(Date.parse(attempt.attemptedAt))
      || Date.parse(attempt.attemptedAt) < Date.parse(publishedAt)
      || localDateAt(attempt.attemptedAt, schoolTimeZone) !== date) continue;
    const previous = firstByWord.get(attempt.wordId);
    if (!previous || Date.parse(attempt.attemptedAt) < Date.parse(previous.attemptedAt)) {
      firstByWord.set(attempt.wordId, attempt);
    }
  }
  if (firstByWord.size < requiredWordCount) return null;
  const sorted = [...firstByWord.values()].sort((left, right) =>
    Date.parse(left.attemptedAt) - Date.parse(right.attemptedAt));
  return { kind: 'vocabulary', resourceId: snapshot.resourceId, completedWordCount: firstByWord.size,
    submittedAt: sorted[requiredWordCount - 1]!.attemptedAt };
}

/** A work counts only after the server has sealed a readable recording for the frozen material. */
export function workEvidenceFromStudentWork(input: Readonly<{
  snapshot: ActivityConditionSnapshot;
  work: StudentWork;
  organizationId: string;
  studentId: string;
  date: string;
  schoolTimeZone: string;
  publishedAt: string;
}>): DailyEvidence | null {
  const { snapshot, work, organizationId, studentId, date, schoolTimeZone, publishedAt } = input;
  if (snapshot.kind !== 'work' || !snapshot.contentVersion.trim()
    || work.organizationId !== organizationId || work.studentId !== studentId
    || work.materialId !== snapshot.resourceId || work.materialVersion !== snapshot.contentVersion
    || work.status !== 'submitted' || !work.submittedAt
    || !Number.isFinite(Date.parse(work.submittedAt)) || !Number.isFinite(Date.parse(publishedAt))
    || Date.parse(work.submittedAt) < Date.parse(publishedAt)
    || localDateAt(work.submittedAt, schoolTimeZone) !== date
    || !work.fileId || !work.contentSha256 || !/^[a-f0-9]{64}$/.test(work.contentSha256)
    || !work.fileId.includes('/student-works/private/')
    || !work.fileId.endsWith(`/${work.id}/${work.contentSha256}.mp3`)
    || !Number.isSafeInteger(work.sizeBytes) || !work.sizeBytes || work.sizeBytes > 20 * 1024 * 1024
    || !Number.isSafeInteger(work.durationMs) || !work.durationMs
    || work.durationMs < 1000 || work.durationMs > 5 * 60 * 1000) return null;
  return { kind: 'work', resourceId: snapshot.resourceId, workId: work.id, submittedAt: work.submittedAt };
}

/** Recomputes one practice score from an immutable question snapshot and the current submitted version. */
export function exerciseEvidenceFromSubmission(input: Readonly<{
  task: TaskRecord;
  assignment: TaskAssignmentRecord;
  submission: SubmissionRecord;
  feedback?: ReviewFeedbackRecord | null;
  resourceId: string;
  requiredContentVersion?: string;
  studentId: string;
  classId: string;
}>): DailyEvidence | null {
  const { task, assignment, submission, feedback, resourceId, requiredContentVersion, studentId, classId } = input;
  if (task.organizationId !== assignment.organizationId || task.organizationId !== submission.organizationId
    || task.status === 'draft' || task.publishedAt === null
    || task.id !== assignment.taskId || task.id !== submission.taskId
    || assignment.id !== submission.assignmentId || assignment.studentId !== studentId
    || submission.studentId !== studentId || assignment.classId !== classId
    || assignment.latestSubmissionId !== submission.id
    || assignment.latestSubmissionVersion !== submission.submissionVersion
    || (assignment.status !== 'awaiting_review' && assignment.status !== 'completed')
    || (submission.status !== 'submitted' && submission.status !== 'reviewed')
    || !submission.submittedAt || !Number.isFinite(Date.parse(submission.submittedAt))) return null;
  if (feedback && (feedback.organizationId !== task.organizationId || feedback.taskId !== task.id
    || feedback.assignmentId !== assignment.id || feedback.submissionId !== submission.id
    || feedback.submissionVersion !== submission.submissionVersion || feedback.decision === 'returned')) return null;
  const candidates = task.items.filter(item => item.resourceId === resourceId && item.resourceSnapshot.type === 'exercise');
  if (candidates.length !== 1) return null;
  const item = candidates[0]!;
  if (requiredContentVersion !== undefined && String(item.resourceVersion) !== requiredContentVersion) return null;
  const snapshot = readExerciseQuestionSnapshot(item.resourceSnapshot.payload);
  if (!snapshot || snapshot.questionId !== resourceId) return null;
  const answers = submission.answers.filter(answer => answer.itemId === item.id);
  if (answers.length !== 1 || !isObject(answers[0]?.value)) return null;
  const stored = answers[0].value;
  if (stored.kind !== 'exercise' || !Array.isArray(stored.questionResponses) || stored.questionResponses.length !== 1
    || !isObject(stored.questionResponses[0])) return null;
  const raw = stored.questionResponses[0];
  const evaluation = evaluateExerciseSubmission(snapshot, { kind: 'exercise', answeredQuestionCount: 1,
    questionResponses: [{ questionId: raw.questionId, response: raw.response }] });
  if (!evaluation.complete) return null;
  let score = evaluation.automaticScore;
  if (task.items.length === 1 && feedback?.decision === 'approved' && feedback.score !== null
    && Number.isFinite(feedback.score) && feedback.score >= 0 && feedback.score <= 100) score = feedback.score;
  if (score === null) return null;
  return { kind: 'exercise', resourceId, score, submittedAt: submission.submittedAt };
}
