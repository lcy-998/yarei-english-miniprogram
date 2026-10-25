import type { TrustedActorContext } from '../auth/trusted-actor';
import type { ContentEvidence } from '../task-core/content-rules';
import type { FrozenTeacherMediaSnapshot } from '../teacher-media/publish-gate';
import type { AssignedTaskMedia, TaskMediaPlaybackPort,
  TaskMediaSessionRecord } from './playback-service';

export interface TaskMediaQuestionResponse {
  readonly questionId: string;
  readonly response: string | readonly string[];
}

export type TaskMediaSubmissionRequest =
  | Readonly<{ kind: 'listening'; mediaSessionId: string;
    questionResponses: readonly TaskMediaQuestionResponse[] }>
  | Readonly<{ kind: 'video'; mediaSessionId: string;
    questionResponses?: readonly TaskMediaQuestionResponse[] }>
  | Readonly<{ kind: 'dubbing'; mediaSessionId: string; finalWorkId: string }>;

export interface SealedTaskDubbingWork {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly assignmentId: string;
  readonly round: number;
  readonly taskId: string;
  readonly itemId: string;
  readonly mediaId: string;
  readonly mediaVersion: number;
  readonly status: 'submitted' | 'draft' | 'deleted';
  readonly fileId: string;
  readonly contentSha256: string;
  readonly mediaDeletedAt?: string | null;
  readonly recording: Readonly<{ mediaId: string; durationMs: number;
    sizeBytes: number; serverReadable: boolean }>;
}

export interface TaskMediaSubmissionPort {
  findTaskDubbingWork(workId: string): Promise<SealedTaskDubbingWork | null>;
}

export type VerifiedTaskMediaSubmission = Readonly<{
  itemId: string;
  mediaSessionId: string;
  mediaId: string;
  mediaVersion: number;
  /** Raw original answers are retained by question ID and formal submission version. */
  questionResponses: readonly TaskMediaQuestionResponse[];
  evidence: ContentEvidence;
}>;

export type TaskMediaSubmissionResult = Readonly<{ ok: true; data: VerifiedTaskMediaSubmission }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'PLAYBACK_INCOMPLETE'
    | 'MAPPING_INCOMPLETE' | 'WORK_UNAVAILABLE' }>;

/** Builds verified content evidence from a frozen task item, a server session, and a sealed task work. */
export class TaskMediaSubmissionEvidenceService {
  public constructor(private readonly sessions: Pick<TaskMediaPlaybackPort, 'findSession'>,
    private readonly works: TaskMediaSubmissionPort) {}

  public async verify(actor: TrustedActorContext, assigned: AssignedTaskMedia,
    input: TaskMediaSubmissionRequest): Promise<TaskMediaSubmissionResult> {
    if (actor.actorRole !== 'student' || actor.organizationId !== assigned.organizationId
      || actor.actorUserId !== assigned.studentId || !assigned.writable) return failure('FORBIDDEN');
    if (!validRequestShape(input) || assigned.snapshot.kind !== input.kind) return failure('VALIDATION_ERROR');
    const session = await this.sessions.findSession(input.mediaSessionId);
    if (!session || !matchesSession(session, assigned)) return failure('FORBIDDEN');
    const snapshot = assigned.snapshot;
    const requiredMs = snapshot.kind === 'video' ? Math.ceil(snapshot.durationMs * 0.9) : snapshot.durationMs;
    if (session.confirmedThroughMs < requiredMs) return failure('PLAYBACK_INCOMPLETE');
    if (input.kind === 'dubbing') {
      const work = await this.works.findTaskDubbingWork(input.finalWorkId);
      if (!work || work.status !== 'submitted' || work.organizationId !== actor.organizationId
        || work.studentId !== actor.actorUserId || work.assignmentId !== assigned.assignmentId
        || work.round !== assigned.round || work.taskId !== assigned.taskId
        || work.itemId !== assigned.itemId || work.mediaId !== snapshot.mediaId
        || work.mediaVersion !== snapshot.mediaVersion || !work.fileId.startsWith('cloud://')
        || !/^[a-f0-9]{64}$/i.test(work.contentSha256)
        || work.mediaDeletedAt != null || !validRecording(work.recording)) {
        return failure('WORK_UNAVAILABLE');
      }
      return { ok: true, data: { itemId: assigned.itemId, mediaSessionId: session.id,
        mediaId: snapshot.mediaId, mediaVersion: snapshot.mediaVersion, questionResponses: [],
        evidence: { kind: 'dubbing', finalWorkId: work.id, recording: { ...work.recording } } } };
    }
    const responses = validOrderedResponses(input.questionResponses ?? [], snapshot);
    if (!responses) return failure('MAPPING_INCOMPLETE');
    const correctQuestionIds = responses.filter(response => {
      const key = snapshot.answerKeys.find(item => item.questionId === response.questionId);
      return key && key.correctAnswer !== null && answersEqual(response.response, key.correctAnswer);
    }).map(response => response.questionId);
    const common = { itemId: assigned.itemId, mediaSessionId: session.id,
      mediaId: snapshot.mediaId, mediaVersion: snapshot.mediaVersion, questionResponses: responses };
    if (input.kind === 'listening') {
      const verifiedPlayedSegmentIds = snapshot.clips.filter(clip =>
        clip.endMs <= session.confirmedThroughMs).map(clip => clip.segmentId);
      if (verifiedPlayedSegmentIds.length !== snapshot.clips.length) return failure('PLAYBACK_INCOMPLETE');
      return { ok: true, data: { ...common, evidence: { kind: 'listening',
        verifiedPlayedSegmentIds, answeredQuestionIds: responses.map(response => response.questionId),
        correctQuestionIds } } };
    }
    return { ok: true, data: { ...common, evidence: { kind: 'video',
      verifiedRanges: [{ startMs: 0, endMs: session.confirmedThroughMs }],
      answeredQuestionIds: responses.map(response => response.questionId), correctQuestionIds } } };
  }
}

function validRequestShape(input: TaskMediaSubmissionRequest): boolean {
  if (typeof input !== 'object' || input === null || !/^[A-Za-z0-9_-]{1,128}$/.test(input.mediaSessionId)) return false;
  const keys = Object.keys(input).sort();
  if (input.kind === 'dubbing') return keys.join(',') === 'finalWorkId,kind,mediaSessionId'
    && typeof input.finalWorkId === 'string' && !!input.finalWorkId.trim();
  if (input.kind === 'listening') return keys.join(',') === 'kind,mediaSessionId,questionResponses'
    && Array.isArray(input.questionResponses);
  if (input.kind === 'video') return (keys.join(',') === 'kind,mediaSessionId'
    || keys.join(',') === 'kind,mediaSessionId,questionResponses')
    && (input.questionResponses === undefined || Array.isArray(input.questionResponses));
  return false;
}

function matchesSession(session: TaskMediaSessionRecord, assigned: AssignedTaskMedia): boolean {
  return session.organizationId === assigned.organizationId && session.studentId === assigned.studentId
    && session.assignmentId === assigned.assignmentId && session.round === assigned.round
    && session.taskId === assigned.taskId
    && session.itemId === assigned.itemId && session.mediaId === assigned.snapshot.mediaId
    && session.mediaVersion === assigned.snapshot.mediaVersion;
}

function validOrderedResponses(input: readonly TaskMediaQuestionResponse[],
  snapshot: FrozenTeacherMediaSnapshot): readonly TaskMediaQuestionResponse[] | null {
  if (!Array.isArray(input) || input.length !== snapshot.questionIds.length
    || snapshot.answerKeys.length !== snapshot.questionIds.length) return null;
  const byId = new Map<string, TaskMediaQuestionResponse>();
  for (const row of input) {
    if (!row || typeof row.questionId !== 'string' || byId.has(row.questionId)
      || !validResponse(row.response)) return null;
    byId.set(row.questionId, row);
  }
  if (byId.size !== snapshot.questionIds.length
    || snapshot.questionIds.some(questionId => !byId.has(questionId))) return null;
  return snapshot.questionIds.map(questionId => {
    const response = byId.get(questionId)!;
    return { questionId, response: Array.isArray(response.response) ? [...response.response] : response.response };
  });
}

function validResponse(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0
    : Array.isArray(value) && value.length > 0
      && value.every(item => typeof item === 'string' && item.trim().length > 0)
      && new Set(value).size === value.length;
}

function answersEqual(input: string | readonly string[], correct: string | readonly string[]): boolean {
  if (typeof input === 'string' && typeof correct === 'string') return input.trim() === correct.trim();
  if (!Array.isArray(input) || !Array.isArray(correct)) return false;
  return input.length === correct.length && [...input].sort().every((value, index) => value === [...correct].sort()[index]);
}

function validRecording(value: SealedTaskDubbingWork['recording']): boolean {
  return typeof value.mediaId === 'string' && value.mediaId.trim().length > 0
    && Number.isSafeInteger(value.durationMs) && value.durationMs >= 1000 && value.durationMs <= 300000
    && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0 && value.sizeBytes <= 20 * 1024 * 1024
    && value.serverReadable === true;
}

function failure(code: Extract<TaskMediaSubmissionResult, { ok: false }>['code']): TaskMediaSubmissionResult {
  return { ok: false, code };
}
