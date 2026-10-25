import { createHash } from 'node:crypto';
import { AuthorizationService } from '../auth/authorization-service';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { IdentityRepository } from '../runtime/ports';
import type { TaskQueryRepository } from '../task-query/repository';
import { isSubmittable } from '../task-core/task-core-service';
import type { LearningProgressRepository } from '../learning-progress/repository';
import type { DocumentDatabasePort } from '../repositories/document-database-port';
import type { PronunciationSourcePort } from './repository';
import { PronunciationError, type PronunciationRecording, type PronunciationSourceInput,
  type ResolvedPronunciationSource } from './types';

function approvedSegment(value: unknown, segmentId: string, contentVersion: string | null): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.reviewStatus !== 'approved' || !source.approvedAt || !source.approvedBy
    || (contentVersion !== null && source.sourceVersion !== contentVersion)
    || !Array.isArray(source.segments)) return null;
  const match = source.segments.find(candidate => candidate !== null && typeof candidate === 'object'
    && !Array.isArray(candidate) && (candidate as Record<string, unknown>).id === segmentId);
  const text = match && (match as Record<string, unknown>).text;
  const audio = match && (match as Record<string, unknown>).demonstrationAudioAssetKey;
  return typeof text === 'string' && text.trim().length >= 1 && text.length <= 300
    && typeof audio === 'string' && audio.startsWith('cloud://') ? text.trim() : null;
}

export class DocumentPronunciationSource implements PronunciationSourcePort {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly tasks: TaskQueryRepository,
    private readonly learning: LearningProgressRepository,
    private readonly documents: DocumentDatabasePort,
    identities: IdentityRepository,
    private readonly clock: { nowIso(): string }) {
    this.authorization = new AuthorizationService(identities);
  }

  public async resolve(actor: TrustedActorContext, input: PronunciationSourceInput,
    writable: boolean): Promise<ResolvedPronunciationSource> {
    if (actor.actorRole !== 'student') throw new PronunciationError('FORBIDDEN');
    if (input.kind === 'task') {
      const [task, assignment] = await Promise.all([
        this.tasks.findTask(actor.organizationId, input.taskId),
        this.tasks.findAssignment(actor.organizationId, input.taskId, actor.actorUserId),
      ]);
      if (!task || !assignment || task.visibility !== 'visible') throw new PronunciationError('NOT_FOUND');
      if (writable && !isSubmittable(task, assignment, this.clock.nowIso())) {
        throw new PronunciationError('TASK_NOT_SUBMITTABLE');
      }
      const item = task.items.find(candidate => candidate.id === input.itemId
        && candidate.resourceSnapshot.type === 'reading');
      if (!item) throw new PronunciationError('NOT_FOUND');
      const text = item.resourceSnapshot.payload.copyrightStatus === 'verified'
        ? approvedSegment(item.resourceSnapshot.payload.pronunciation, input.segmentId,
          String(item.resourceVersion)) : null;
      if (!text) throw new PronunciationError('RESOURCE_OFFLINE');
      const sourceHash = createHash('sha256').update(JSON.stringify(item.resourceSnapshot.payload.pronunciation)).digest('hex');
      return { kind: 'task', taskId: task.id, itemId: item.id, resourceId: item.resourceId,
        segmentId: input.segmentId, referenceText: text,
        displayTitle: task.title,
        sourceVersion: `${task.id}:${task.publishedAt ?? 'unpublished'}:${item.resourceVersion}:${sourceHash}`,
        assignmentId: assignment.id, classId: assignment.classId,
        submissionVersion: assignment.latestSubmissionVersion + 1 };
    }
    const access = await this.learning.findResource(actor.organizationId, input.resourceId, actor.actorUserId);
    if (!access || access.type !== 'reading' || access.status !== 'published'
      || !access.allowedStudentIds.includes(actor.actorUserId)) throw new PronunciationError('NOT_FOUND');
    const document = await this.documents.get('learning_resources', input.resourceId);
    if (!document || document.organizationId !== actor.organizationId || document.deletedAt !== null
      || document.status !== 'published') throw new PronunciationError('NOT_FOUND');
    const payload: Readonly<Record<string, unknown>> = document.payload !== null
      && typeof document.payload === 'object' && !Array.isArray(document.payload)
      ? document.payload as Readonly<Record<string, unknown>> : document;
    const contentVersion = typeof document.contentVersion === 'string'
      ? document.contentVersion
      : Number.isSafeInteger(document.contentVersion) && Number(document.contentVersion) > 0
        ? String(document.contentVersion) : null;
    const text = document.copyrightStatus === 'verified'
      ? approvedSegment(payload.pronunciation ?? document.pronunciation, input.segmentId, contentVersion) : null;
    if (!text) throw new PronunciationError('RESOURCE_OFFLINE');
    return { kind: 'reading', taskId: null, itemId: null, resourceId: input.resourceId,
      segmentId: input.segmentId, referenceText: text,
      displayTitle: typeof document.title === 'string' ? document.title : '跟读练习',
      sourceVersion: contentVersion ?? String(document.version),
      assignmentId: null, classId: null, submissionVersion: null };
  }

  public async current(actor: TrustedActorContext, source: ResolvedPronunciationSource,
    writable: boolean): Promise<boolean> {
    try {
      const refreshed = await this.resolve(actor, source.kind === 'task'
        ? { kind: 'task', taskId: source.taskId!, itemId: source.itemId!, segmentId: source.segmentId }
        : { kind: 'reading', resourceId: source.resourceId, segmentId: source.segmentId }, writable);
      return JSON.stringify(refreshed) === JSON.stringify(source);
    } catch (error: unknown) {
      if (error instanceof PronunciationError) return false;
      throw error;
    }
  }

  public async currentForScoring(actor: TrustedActorContext,
    recording: PronunciationRecording): Promise<boolean> {
    if (actor.actorRole !== 'student' || actor.organizationId !== recording.organizationId
      || actor.actorUserId !== recording.studentId || recording.mediaDeletedAt) return false;
    if (recording.source.kind === 'reading') return this.current(actor, recording.source, true);
    const source = recording.source;
    const input: PronunciationSourceInput = { kind: 'task', taskId: source.taskId!,
      itemId: source.itemId!, segmentId: source.segmentId };
    if (await this.current(actor, source, true)) return true;
    if (source.submissionVersion === null) return false;
    try {
      const resolved = await this.resolve(actor, input, false);
      const frozenResolved = { ...resolved, submissionVersion: source.submissionVersion };
      if (JSON.stringify(frozenResolved) !== JSON.stringify(source)) return false;
      return (await this.formalSubmissionAt(recording, source.submissionVersion)) !== null;
    } catch (error: unknown) {
      if (error instanceof PronunciationError) return false;
      throw error;
    }
  }

  public async teacherSubmittedAt(actor: TrustedActorContext, recording: PronunciationRecording,
    submissionVersion: number): Promise<string | null> {
    if (actor.actorRole !== 'teacher' || recording.source.kind !== 'task'
      || recording.source.submissionVersion !== submissionVersion || !recording.source.classId) return null;
    if (!(await this.authorization.canTeacherAccessClass(actor, recording.source.classId,
      'submission.review')).allowed) return null;
    return this.formalSubmissionAt(recording, submissionVersion);
  }

  public async parentSubmittedAt(actor: TrustedActorContext, recording: PronunciationRecording,
    submissionVersion: number): Promise<string | null> {
    if (actor.actorRole !== 'parent' || recording.source.kind !== 'task'
      || recording.source.submissionVersion !== submissionVersion
      || actor.organizationId !== recording.organizationId) return null;
    if (!(await this.authorization.canParentReadStudent(actor, recording.studentId)).allowed) return null;
    return this.formalSubmissionAt(recording, submissionVersion);
  }

  public async parentSubmissionRecordingIds(actor: TrustedActorContext, input: Readonly<{
    studentId: string; taskId: string; assignmentId: string; submissionVersion: number;
    itemId: string }>): Promise<Readonly<{ submittedAt: string; recordingIds: readonly string[] }> | null> {
    if (actor.actorRole !== 'parent'
      || !(await this.authorization.canParentReadStudent(actor, input.studentId)).allowed) return null;
    const submissions = await this.tasks.listTaskSubmissions(actor.organizationId, input.taskId);
    const submission = submissions.find(candidate => candidate.organizationId === actor.organizationId
      && candidate.taskId === input.taskId && candidate.assignmentId === input.assignmentId
      && candidate.studentId === input.studentId && candidate.submissionVersion === input.submissionVersion
      && candidate.status !== 'draft' && candidate.submittedAt !== null);
    if (!submission?.submittedAt) return null;
    const recordingIds = submission.answers.flatMap(answer => {
      const value = answer.value;
      if (answer.itemId !== input.itemId || value === null
        || typeof value !== 'object' || Array.isArray(value)) return [];
      const recordingId = (value as Record<string, unknown>).recordingId;
      return typeof recordingId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(recordingId)
        ? [recordingId] : [];
    });
    return { submittedAt: submission.submittedAt, recordingIds: [...new Set(recordingIds)] };
  }

  private async formalSubmissionAt(recording: PronunciationRecording,
    submissionVersion: number): Promise<string | null> {
    const submissions = await this.tasks.listTaskSubmissions(recording.organizationId, recording.source.taskId!);
    const matched = submissions.find(submission => submission.organizationId === recording.organizationId
      && submission.taskId === recording.source.taskId
      && submission.assignmentId === recording.source.assignmentId
      && submission.studentId === recording.studentId && submission.submissionVersion === submissionVersion
      && submission.status !== 'draft' && submission.submittedAt !== null
      && submission.answers.some(answer => answer.itemId === recording.source.itemId
        && typeof answer.value === 'object' && answer.value !== null && !Array.isArray(answer.value)
        && ((answer.value as Record<string, unknown>).recordingId === recording.id
          || (recording.source.kind === 'task'
            && (answer.value as Record<string, unknown>).kind === 'reading'))));
    return matched?.submittedAt ?? null;
  }
}
