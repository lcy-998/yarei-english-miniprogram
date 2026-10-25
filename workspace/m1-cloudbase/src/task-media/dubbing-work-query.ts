import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort } from '../repositories/document-database-port';
import type { TaskCoreReader } from '../task-core/repository';
import { DocumentTaskDubbingWorkPort, TASK_DUBBING_WORKS_COLLECTION } from './document-work-port';
import { randomUUID } from 'node:crypto';
import { dubbingAudioExpired } from '../media-retention/policy';

export interface MyTaskDubbingWorkView {
  readonly workId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly itemId: string;
  readonly round: number;
  readonly status: 'formal' | 'task_pending';
  readonly durationMs: number;
  readonly submittedAt: string;
  readonly playbackAvailable: boolean;
}

export interface MyTaskDubbingWorkPage {
  readonly items: readonly MyTaskDubbingWorkView[];
  readonly nextOffset: number | null;
}

export interface MyTaskDubbingPlaybackView {
  readonly workId: string;
  readonly status: 'formal' | 'task_pending';
  readonly durationMs: number;
  readonly temporaryUrl: string;
  readonly expiresAt: string;
}

/** Safe S-12 list; no file ID, staging path, transcript or autonomous student_works. */
export class TaskDubbingWorkQueryService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly tasks: Pick<TaskCoreReader, 'findTask' | 'findAssignment' | 'findSubmission'>,
    private readonly playback?: Readonly<{ temporaryUrl(fileId: string): Promise<string> }>,
    private readonly clock?: Readonly<{ nowIso(): string }>) {}

  public async listMine(actor: TrustedActorContext, offset: number,
    limit: number): Promise<MyTaskDubbingWorkPage | null> {
    if (actor.actorRole !== 'student' || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return null;
    const page = await this.database.findPage(TASK_DUBBING_WORKS_COLLECTION,
      { organizationId: actor.organizationId, studentId: actor.actorUserId,
        status: 'submitted', deletedAt: null }, { limit, offset });
    const items: MyTaskDubbingWorkView[] = [];
    for (const row of page.items) {
      const work = await new DocumentTaskDubbingWorkPort(this.database).findTaskDubbingWork(row._id);
      if (!work || work.organizationId !== actor.organizationId || work.studentId !== actor.actorUserId
        || typeof row.submittedAt !== 'string'
        || !Number.isFinite(Date.parse(row.submittedAt))) continue;
      const [task, assignment] = await Promise.all([
        this.tasks.findTask(actor.organizationId, work.taskId),
        this.tasks.findAssignment(actor.organizationId, work.taskId, actor.actorUserId),
      ]);
      if (!task || !assignment || assignment.id !== work.assignmentId) continue;
      const formal = assignment.latestSubmissionId === null ? null
        : await this.tasks.findSubmission(actor.organizationId, assignment.latestSubmissionId);
      const cited = formal !== null && formal.status !== 'draft'
        && formal.submissionVersion === work.round
        && formal.answers.some(answer => answer.itemId === work.itemId
        && isRecord(answer.value)
        && answer.value.kind === 'dubbing' && answer.value.finalWorkId === work.id);
      const now = Date.parse(this.clock?.nowIso() ?? new Date().toISOString());
      const playbackAvailable = work.mediaDeletedAt == null && (cited
        ? formal?.submittedAt !== null && formal?.submittedAt !== undefined
          && !dubbingAudioExpired(formal.submittedAt, new Date(now).toISOString())
        : task.visibility !== 'recycled' && assignment.latestSubmissionVersion < work.round
          && !dubbingAudioExpired(row.submittedAt, new Date(now).toISOString()));
      items.push({ workId: work.id, taskId: work.taskId, taskTitle: task.title,
        itemId: work.itemId, round: work.round,
        status: cited ? 'formal' : 'task_pending',
        durationMs: work.recording.durationMs, submittedAt: row.submittedAt,
        playbackAvailable });
    }
    return { items, nextOffset: page.hasMore ? offset + page.items.length : null };
  }

  public async getPlayback(actor: TrustedActorContext,
    workId: string): Promise<MyTaskDubbingPlaybackView | null> {
    if (actor.actorRole !== 'student' || !/^[A-Za-z0-9_-]{1,128}$/.test(workId)
      || !this.playback || !this.clock) return null;
    const work = await new DocumentTaskDubbingWorkPort(this.database).findTaskDubbingWork(workId);
    const workRow = await this.database.get(TASK_DUBBING_WORKS_COLLECTION, workId);
    if (!work || work.organizationId !== actor.organizationId || work.studentId !== actor.actorUserId
      || work.mediaDeletedAt != null) return null;
    const [task, assignment] = await Promise.all([
      this.tasks.findTask(actor.organizationId, work.taskId),
      this.tasks.findAssignment(actor.organizationId, work.taskId, actor.actorUserId),
    ]);
    if (!task || !assignment || assignment.id !== work.assignmentId) return null;
    const formal = assignment.latestSubmissionId === null ? null
      : await this.tasks.findSubmission(actor.organizationId, assignment.latestSubmissionId);
    const cited = formal !== null && formal.status !== 'draft' && formal.submissionVersion === work.round
      && formal.answers.some(answer => answer.itemId === work.itemId && isRecord(answer.value)
        && answer.value.kind === 'dubbing' && answer.value.finalWorkId === work.id);
    const nowIso = this.clock.nowIso();
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) return null;
    if (cited && (!formal?.submittedAt
      || dubbingAudioExpired(formal.submittedAt, nowIso))) return null;
    if (!cited && (assignment.latestSubmissionVersion >= work.round
      || task.visibility === 'recycled'
      || typeof workRow?.submittedAt !== 'string'
      || dubbingAudioExpired(workRow.submittedAt, nowIso))) return null;
    let temporaryUrl: string;
    try { temporaryUrl = await this.playback.temporaryUrl(work.fileId); }
    catch { return null; }
    if (!/^https:\/\//.test(temporaryUrl)) return null;
    const expiresAt = new Date(now + 60000).toISOString();
    await this.database.runTransaction(async tx => {
      const id = `task_dubbing_playback_audit_${randomUUID()}`;
      if (!await tx.append('operation_logs', { _id: id, organizationId: actor.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, requestId: id,
        actorUserId: actor.actorUserId, actorRole: 'student', action: 'task_dubbing.playback',
        targetType: 'task_dubbing_work', targetId: work.id, result: 'succeeded',
        errorCode: null, occurredAt: nowIso,
        metadata: { taskId: work.taskId, itemId: work.itemId, round: work.round },
      })) throw new Error('TASK_DUBBING_AUDIT_FAILED');
    });
    return { workId: work.id, status: cited ? 'formal' : 'task_pending',
      durationMs: work.recording.durationMs, temporaryUrl, expiresAt };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
