import { randomUUID } from 'node:crypto'
import type { TrustedActorContext } from '../auth/trusted-actor'
import type { DocumentDatabasePort } from '../repositories/document-database-port'
import type { TaskQueryRepository } from '../task-query/repository'

export interface SubmittedTaskMediaPlaybackView {
  readonly taskId: string
  readonly itemId: string
  readonly submissionVersion: number
  readonly kind: 'listening' | 'video' | 'dubbing'
  readonly mediaVersion: number
  readonly durationMs: number
  readonly temporaryUrl: string
  readonly expiresAt: string
  readonly clips: readonly Readonly<{ questionId: string; startMs: number; endMs: number }>[]
  readonly subtitles: readonly Readonly<{ startMs: number; endMs: number; text: string;
    translationText?: string }>[]
}

export type SubmittedTaskMediaPlaybackResult =
  | Readonly<{ ok: true; data: SubmittedTaskMediaPlaybackView }>
  | Readonly<{ ok: false; code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE' }>

/**
 * Historical student playback reads only a committed assignment and frozen task item.
 * It cannot create progress sessions, change completion, or accept a client media key.
 */
export class SubmittedTaskMediaPlaybackService {
  public constructor(private readonly tasks: Pick<TaskQueryRepository,
    'findTask' | 'findAssignment' | 'listTaskSubmissions'>,
  private readonly documents: DocumentDatabasePort,
  private readonly playback: Readonly<{ temporaryUrl(fileId: string): Promise<string> }>,
  private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async get(actor: TrustedActorContext, taskId: string, itemId: string,
    submissionVersion: number): Promise<SubmittedTaskMediaPlaybackResult> {
    if (!id(taskId) || !id(itemId) || !Number.isSafeInteger(submissionVersion)
      || submissionVersion < 1) return { ok: false, code: 'VALIDATION_ERROR' }
    if (actor.actorRole !== 'student') return { ok: false, code: 'NOT_FOUND' }
    const [task, assignment, submissions] = await Promise.all([
      this.tasks.findTask(actor.organizationId, taskId),
      this.tasks.findAssignment(actor.organizationId, taskId, actor.actorUserId),
      this.tasks.listTaskSubmissions(actor.organizationId, taskId),
    ])
    if (!task || !assignment || task.organizationId !== actor.organizationId
      || assignment.organizationId !== actor.organizationId
      || assignment.studentId !== actor.actorUserId
      || task.publishedAt === null || task.publication != null) return { ok: false, code: 'NOT_FOUND' }
    const submission = submissions.find(row => row.taskId === taskId
      && row.assignmentId === assignment.id && row.studentId === actor.actorUserId
      && row.organizationId === actor.organizationId
      && row.submissionVersion === submissionVersion
      && row.submissionVersion <= assignment.latestSubmissionVersion
      && row.status !== 'draft' && row.submittedAt !== null)
    const item = task.items.find(row => row.id === itemId)
    const snapshot = item?.mediaSnapshot
    const answer = submission?.answers.find(row => row.itemId === itemId)
    const value = record(answer?.value)
    if (!submission || !item || !snapshot || !value
      || snapshot.kind !== item.resourceSnapshot.type
      || snapshot.mediaVersion !== item.resourceVersion
      || snapshot.reviewVersion !== snapshot.mediaVersion
      || snapshot.continuousPlaybackEnforced !== true
      || !snapshot.mediaAssetKey.startsWith('cloud://')
      || !/^[a-f0-9]{64}$/i.test(snapshot.mediaSha256)
      || !Number.isSafeInteger(snapshot.durationMs) || snapshot.durationMs < 1000
      || snapshot.durationMs > 30 * 60 * 1000
      || value.kind !== snapshot.kind || value.mediaId !== snapshot.mediaId
      || value.mediaVersion !== snapshot.mediaVersion
      || typeof value.mediaSessionId !== 'string' || !value.mediaSessionId.trim()) {
      return { ok: false, code: 'NOT_FOUND' }
    }
    const clips = snapshot.kind === 'listening' ? snapshot.clips.map(clip => ({
      questionId: clip.questionId, startMs: clip.startMs, endMs: clip.endMs,
    })) : []
    if (snapshot.kind === 'listening' && (clips.length !== snapshot.questionIds.length
      || clips.some(clip => !snapshot.questionIds.includes(clip.questionId)
        || clip.startMs < 0 || clip.endMs <= clip.startMs || clip.endMs > snapshot.durationMs))) {
      return { ok: false, code: 'NOT_FOUND' }
    }
    const now = Date.parse(this.clock.nowIso())
    if (!Number.isFinite(now)) return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    let temporaryUrl: string
    try {
      temporaryUrl = await this.playback.temporaryUrl(snapshot.mediaAssetKey)
      if (!temporaryUrl.startsWith('https://')) throw new Error('INVALID_PLAYBACK_URL')
      const saved = await this.documents.runTransaction(tx => tx.append('operation_logs', {
        _id: `submitted_media_playback_${randomUUID()}`,
        organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
        action: 'student-task-query.getSubmittedTaskMediaPlayback',
        targetType: 'task', targetId: taskId, result: 'succeeded', errorCode: null,
        occurredAt: this.clock.nowIso(),
        metadata: { itemId, submissionVersion, mediaVersion: snapshot.mediaVersion },
      }))
      if (!saved) throw new Error('AUDIT_FAILED')
    } catch { return { ok: false, code: 'SERVICE_UNAVAILABLE' } }
    return { ok: true, data: { taskId, itemId, submissionVersion, kind: snapshot.kind,
      mediaVersion: snapshot.mediaVersion, durationMs: snapshot.durationMs,
      temporaryUrl, expiresAt: new Date(now + 60_000).toISOString(),
      clips, subtitles: snapshot.subtitleCues?.map(cue => ({ ...cue })) ?? [] } }
  }
}

function id(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
