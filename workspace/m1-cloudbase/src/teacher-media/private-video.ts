import { createHash, randomUUID } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import type { OrgContentRepository } from '../org-content/repository';
import type { CloudBasePlaybackSdkPort } from '../student-work/cloudbase-playback';
import type { JsonObject, JsonValue } from '../shared/protocol';
import { freezeTeacherMediaForTask, type TeacherMediaAnswerKey,
  type TeacherMediaCandidate, type TeacherMediaQuestionView } from './publish-gate';

export const PRIVATE_VIDEO_COLLECTION = 'teacher_private_videos';
export const PRIVATE_VIDEO_MAX_DURATION_MS = 10 * 60 * 1000;

export interface PrivateVideoQuestion extends TeacherMediaQuestionView {
  readonly [key: string]: JsonValue;
  readonly correctAnswer: string | readonly string[] | null;
  readonly explanation: string;
}

export interface PrivateVideoDraftInput {
  readonly title: string;
  readonly questions: readonly PrivateVideoQuestion[];
}

export type PrivateVideoProcessed = Readonly<{
  readonly mediaAssetKey: string;
  readonly mediaSha256: string;
  readonly durationMs: number;
} & ({
  readonly sourceScanEvidence: NonNullable<TeacherMediaCandidate['sourceScanEvidence']>;
  readonly transcodeEvidence: NonNullable<TeacherMediaCandidate['transcodeEvidence']>;
  readonly scanEvidence: NonNullable<TeacherMediaCandidate['scanEvidence']>;
  readonly directUploadEvidence?: never;
} | {
  readonly directUploadEvidence: NonNullable<TeacherMediaCandidate['directUploadEvidence']>;
  readonly sourceScanEvidence?: never;
  readonly transcodeEvidence?: never;
  readonly scanEvidence?: never;
})>;

export interface PrivateVideoProcessor {
  process(stagingFileId: string, stagingPath: string): Promise<PrivateVideoProcessed>;
}

export interface PrivateVideoDispatcher {
  dispatch(job: Readonly<{ organizationId: string; videoId: string; processingToken: string }>): Promise<void>;
}

export interface PrivateVideoView {
  readonly id: string;
  readonly title: string;
  readonly status: 'draft' | 'processing' | 'failed' | 'ready' | 'published' | 'offline';
  readonly version: number;
  readonly contentVersion: number;
  readonly durationMs: number;
  readonly questionCount: number;
  readonly stagingPath: string | null;
  readonly processingError: string | null;
}

export class PrivateVideoError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR'
    | 'MEDIA_INVALID' | 'SERVICE_UNAVAILABLE') { super(code); }
}

type PrivateVideoDocument = VersionedDocument & Readonly<{
  ownerTeacherId: string;
  title: string;
  status: PrivateVideoView['status'];
  contentVersion: number;
  questions: readonly PrivateVideoQuestion[];
  stagingPath: string | null;
  stagingFileId: string | null;
  processingToken: string | null;
  processingClaimedAt: string | null;
  media: JsonObject | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

function requireTeacher(actor: TrustedActorContext): void {
  if (actor.actorRole !== 'teacher') throw new PrivateVideoError('FORBIDDEN');
}

function validateQuestions(questions: readonly PrivateVideoQuestion[], complete = true): void {
  if (!Array.isArray(questions) || (complete && questions.length < 1) || questions.length > 6) {
    throw new PrivateVideoError('VALIDATION_ERROR');
  }
  if (!complete) {
    const ids = questions.map(question => question?.questionId);
    if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      || new Set(ids).size !== ids.length
      || questions.some(question => !['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(question.questionType)
        || typeof question.stem !== 'string' || question.stem.length > 500
        || !Array.isArray(question.options) || question.options.length > 6
        || question.options.some((option: string) => typeof option !== 'string' || option.length > 200)
        || !(question.correctAnswer === null
          || typeof question.correctAnswer === 'string' && question.correctAnswer.length <= 200
          || Array.isArray(question.correctAnswer) && question.correctAnswer.length <= 6
            && question.correctAnswer.every((value: unknown) => typeof value === 'string' && value.length <= 200))
        || typeof question.explanation !== 'string' || question.explanation.length > 1000)) {
      throw new PrivateVideoError('VALIDATION_ERROR');
    }
    return;
  }
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question || !/^[A-Za-z0-9_-]{1,128}$/.test(question.questionId)
      || ids.has(question.questionId) || !question.stem?.trim()
      || question.stem.length > 500 || !Array.isArray(question.options)
      || typeof question.explanation !== 'string' || question.explanation.length > 1000) {
      throw new PrivateVideoError('VALIDATION_ERROR');
    }
    ids.add(question.questionId);
    if (question.questionType === 'single_choice' || question.questionType === 'multiple_choice') {
      if (question.options.length < 2 || question.options.length > 6
        || question.options.some((option: string) => typeof option !== 'string' || !option.trim())
        || new Set(question.options).size !== question.options.length) {
        throw new PrivateVideoError('VALIDATION_ERROR');
      }
      const answer = question.correctAnswer;
      if (question.questionType === 'multiple_choice' && !Array.isArray(answer)
        || question.questionType === 'single_choice' && typeof answer !== 'string') {
        throw new PrivateVideoError('VALIDATION_ERROR');
      }
      const answers = Array.isArray(answer) ? answer : [answer];
      if (!answers.length || answers.some(value => typeof value !== 'string'
        || !question.options.includes(value))) throw new PrivateVideoError('VALIDATION_ERROR');
      if (question.questionType === 'single_choice' && answers.length !== 1) {
        throw new PrivateVideoError('VALIDATION_ERROR');
      }
    } else if (question.questionType === 'fill') {
      if (question.options.length || typeof question.correctAnswer !== 'string'
        || !question.correctAnswer.trim()) throw new PrivateVideoError('VALIDATION_ERROR');
    } else if (question.questionType === 'subjective') {
      if (question.options.length || question.correctAnswer !== null) {
        throw new PrivateVideoError('VALIDATION_ERROR');
      }
    } else throw new PrivateVideoError('VALIDATION_ERROR');
  }
}

function view(row: PrivateVideoDocument): PrivateVideoView {
  return { id: row._id, title: row.title, status: row.status, version: row.version,
    contentVersion: row.contentVersion,
    durationMs: Number(row.media?.durationMs ?? 0), questionCount: row.questions.length,
    stagingPath: row.stagingPath, processingError: row.processingError };
}

function cleanQuestions(questions: readonly PrivateVideoQuestion[]): PrivateVideoQuestion[] {
  return questions.map(question => ({ questionId: question.questionId,
    questionType: question.questionType, stem: question.stem,
    options: [...question.options],
    correctAnswer: Array.isArray(question.correctAnswer)
      ? [...question.correctAnswer] : question.correctAnswer,
    explanation: question.explanation }));
}

function owned(row: VersionedDocument | null, actor: TrustedActorContext): PrivateVideoDocument {
  if (!row || row.organizationId !== actor.organizationId || row.deletedAt !== null) {
    throw new PrivateVideoError('NOT_FOUND');
  }
  if (row.ownerTeacherId !== actor.actorUserId) throw new PrivateVideoError('FORBIDDEN');
  return row as PrivateVideoDocument;
}

async function audit(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
  id: string, action: string, now: string): Promise<void> {
  const saved = await tx.append('operation_logs', {
    _id: `teacher_video_audit_${randomUUID().replace(/-/g, '')}`,
    organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
    requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
    action: `teacher-private-video-command.${action}`, targetType: 'learning_resource',
    targetId: id, result: 'succeeded', errorCode: null, occurredAt: now, metadata: {},
  });
  if (!saved) throw new PrivateVideoError('SERVICE_UNAVAILABLE');
}

/** Teacher-owned videos stay outside the centrally distributed asset catalog. */
export class TeacherPrivateVideoService {
  constructor(private readonly database: DocumentDatabasePort,
    private readonly processor: PrivateVideoProcessor | null,
    private readonly clock: { nowIso(): string },
    private readonly grants: Pick<OrgContentRepository, 'listActiveTeacherGrants'>,
    private readonly playback?: CloudBasePlaybackSdkPort,
    private readonly dispatcher?: PrivateVideoDispatcher) {}

  private async authorizedClassIds(actor: TrustedActorContext): Promise<string[]> {
    if (!actor.permissions.includes('task.publish') || !actor.permissions.includes('content.read')) {
      throw new PrivateVideoError('FORBIDDEN');
    }
    const active = await this.grants.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    const ids = active.filter(grant => actor.scopeIds.includes(grant.classId)
      && grant.permissions.includes('task.publish') && grant.permissions.includes('content.read'))
      .map(grant => grant.classId);
    if (!ids.length) throw new PrivateVideoError('FORBIDDEN');
    return ids;
  }

  async available(actor: TrustedActorContext): Promise<boolean> {
    if (actor.actorRole !== 'teacher' || (!this.dispatcher && !this.processor)) return false;
    try { await this.authorizedClassIds(actor); return true; }
    catch { return false; }
  }

  async list(actor: TrustedActorContext): Promise<PrivateVideoView[]> {
    requireTeacher(actor);
    const rows = await this.database.find(PRIVATE_VIDEO_COLLECTION,
      { organizationId: actor.organizationId, ownerTeacherId: actor.actorUserId });
    return rows.filter(row => row.deletedAt === null).map(row => view(owned(row, actor)))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(actor: TrustedActorContext, id: string): Promise<PrivateVideoView & {
    questions: readonly PrivateVideoQuestion[]; previewUrl: string | null }> {
    requireTeacher(actor);
    const row = owned(await this.database.get(PRIVATE_VIDEO_COLLECTION, id), actor);
    let previewUrl: string | null = null;
    const fileId = row.media?.mediaAssetKey;
    if (this.playback && typeof fileId === 'string' && fileId.startsWith('cloud://')) {
      try {
        const result = await this.playback.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: 60 }] });
        const signed = result.fileList?.find(item => item.fileID === fileId);
        if (signed?.tempFileURL?.startsWith('https://')
          && (signed.code === undefined || signed.code === 'SUCCESS')) {
          const audited = await this.database.runTransaction(tx => tx.append('operation_logs', {
            _id: `teacher_private_preview_${randomUUID().replace(/-/g, '')}`,
            organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
            requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
            action: 'teacher-private-video-command.getPreview', targetType: 'learning_resource',
            targetId: id, result: 'succeeded', errorCode: null, occurredAt: this.clock.nowIso(),
            metadata: { contentVersion: row.contentVersion },
          }));
          if (audited) previewUrl = signed.tempFileURL;
        }
      } catch { previewUrl = null; }
    }
    return { ...view(row), questions: row.questions, previewUrl };
  }

  async save(actor: TrustedActorContext, input: PrivateVideoDraftInput,
    id?: string, expectedVersion?: number, operationId?: string): Promise<PrivateVideoView> {
    requireTeacher(actor);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100) {
      throw new PrivateVideoError('VALIDATION_ERROR');
    }
    validateQuestions(input.questions, false);
    const questions = cleanQuestions(input.questions);
    const now = this.clock.nowIso();
    if (!id) {
      const videoId = operationId && /^[A-Za-z0-9_-]{8,128}$/.test(operationId)
        ? `teacher_video_${createHash('sha256').update(JSON.stringify([
          actor.organizationId, actor.actorUserId, operationId])).digest('hex').slice(0, 32)}`
        : `teacher_video_${randomUUID().replace(/-/g, '')}`;
      const row: PrivateVideoDocument = { _id: videoId, organizationId: actor.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, ownerTeacherId: actor.actorUserId,
        title: input.title.trim(), status: 'draft', contentVersion: 1,
        questions, stagingPath: null, stagingFileId: null, processingToken: null,
        processingClaimedAt: null, media: null,
        processingError: null, createdAt: now, updatedAt: now };
      const created = await this.database.runTransaction(async tx => {
        const inserted = await tx.create(PRIVATE_VIDEO_COLLECTION, row);
        if (inserted) await audit(tx, actor, videoId, 'save', now);
        return inserted;
      });
      if (!created) {
        const existing = owned(await this.database.get(PRIVATE_VIDEO_COLLECTION, videoId), actor);
        if (existing.title !== row.title
          || JSON.stringify(existing.questions) !== JSON.stringify(row.questions)) {
          throw new PrivateVideoError('CONFLICT');
        }
        return view(existing);
      }
      return view(row);
    }
    return this.database.runTransaction(async tx => {
      const row = owned(await tx.get(PRIVATE_VIDEO_COLLECTION, id), actor);
      if (row.version !== expectedVersion || row.status === 'processing' || row.status === 'offline') {
        throw new PrivateVideoError('CONFLICT');
      }
      const changed = row.title !== input.title.trim()
        || JSON.stringify(row.questions) !== JSON.stringify(questions);
      const next: PrivateVideoDocument = { ...row, title: input.title.trim(),
        questions, status: row.status === 'published' && changed ? 'ready' : row.status,
        contentVersion: changed ? row.contentVersion + 1 : row.contentVersion,
        version: row.version + 1, updatedAt: now };
      if (row.status === 'published' && changed) {
        const resource = await tx.get('learning_resources', id);
        if (!resource || !await tx.replace('learning_resources', id, resource.version,
          { ...resource, status: 'draft', version: resource.version + 1 })) {
          throw new PrivateVideoError('CONFLICT');
        }
      }
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, row.version, next)) {
        throw new PrivateVideoError('CONFLICT');
      }
      await audit(tx, actor, id, 'save', now);
      return view(next);
    });
  }

  async beginUpload(actor: TrustedActorContext, id: string, expectedVersion: number): Promise<PrivateVideoView> {
    requireTeacher(actor);
    await this.authorizedClassIds(actor);
    return this.database.runTransaction(async tx => {
      const row = owned(await tx.get(PRIVATE_VIDEO_COLLECTION, id), actor);
      if (row.version !== expectedVersion || row.status === 'offline'
        || row.status === 'processing') throw new PrivateVideoError('CONFLICT');
      const stagingPath = `teacher-videos/staging/${actor.organizationId}/${actor.actorUserId}/${id}/${randomUUID().replace(/-/g, '')}.mp4`;
      const next: PrivateVideoDocument = { ...row, status: 'draft', stagingPath,
        stagingFileId: null, processingToken: null, processingClaimedAt: null,
        processingError: null, media: null,
        contentVersion: row.status === 'published' ? row.contentVersion + 1 : row.contentVersion,
        version: row.version + 1, updatedAt: this.clock.nowIso() };
      if (row.status === 'published') {
        const resource = await tx.get('learning_resources', id);
        if (!resource || !await tx.replace('learning_resources', id, resource.version,
          { ...resource, status: 'draft', version: resource.version + 1 })) {
          throw new PrivateVideoError('CONFLICT');
        }
      }
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, row.version, next)) throw new PrivateVideoError('CONFLICT');
      await audit(tx, actor, id, 'beginUpload', this.clock.nowIso());
      return view(next);
    });
  }

  async seal(actor: TrustedActorContext, id: string, expectedVersion: number,
    stagingFileId: string): Promise<PrivateVideoView> {
    requireTeacher(actor);
    await this.authorizedClassIds(actor);
    if (!this.dispatcher && !this.processor) throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    const processingToken = randomUUID().replace(/-/g, '');
    const accepted = await this.database.runTransaction(async tx => {
      const current = owned(await tx.get(PRIVATE_VIDEO_COLLECTION, id), actor);
      if (current.version !== expectedVersion || current.status !== 'draft' || !current.stagingPath
        || typeof stagingFileId !== 'string' || !stagingFileId.endsWith(current.stagingPath)) {
        throw new PrivateVideoError('CONFLICT');
      }
      const next: PrivateVideoDocument = { ...current, status: 'processing',
        stagingFileId, processingToken, processingClaimedAt: null,
        processingError: null,
        version: current.version + 1, updatedAt: this.clock.nowIso() };
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, current.version, next)) {
        throw new PrivateVideoError('CONFLICT');
      }
      await audit(tx, actor, id, 'seal', this.clock.nowIso());
      return view(next);
    });
    try {
      if (this.dispatcher) await this.dispatcher.dispatch({ organizationId: actor.organizationId,
        videoId: id, processingToken });
      else {
        await this.processAccepted({ organizationId: actor.organizationId,
          videoId: id, processingToken });
        return view(owned(await this.database.get(PRIVATE_VIDEO_COLLECTION, id), actor));
      }
    } catch {
      await this.failProcessing(actor.organizationId, id, processingToken, 'SERVICE_UNAVAILABLE');
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    }
    return accepted;
  }

  async retryProcessing(actor: TrustedActorContext, id: string,
    expectedVersion: number): Promise<PrivateVideoView> {
    requireTeacher(actor);
    await this.authorizedClassIds(actor);
    if (!this.dispatcher && !this.processor) throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    const processingToken = randomUUID().replace(/-/g, '');
    const accepted = await this.database.runTransaction(async tx => {
      const row = owned(await tx.get(PRIVATE_VIDEO_COLLECTION, id), actor);
      const staleClaim = row.status === 'processing' &&
        (row.processingClaimedAt
          ? Date.parse(this.clock.nowIso()) - Date.parse(row.processingClaimedAt) > 20 * 60 * 1000
          : Date.parse(this.clock.nowIso()) - Date.parse(row.updatedAt) > 2 * 60 * 1000);
      if (row.version !== expectedVersion || !row.stagingPath || !row.stagingFileId
        || row.status !== 'failed' && !staleClaim) throw new PrivateVideoError('CONFLICT');
      const next: PrivateVideoDocument = { ...row, status: 'processing', processingToken,
        processingClaimedAt: null, processingError: null,
        version: row.version + 1, updatedAt: this.clock.nowIso() };
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, row.version, next)) {
        throw new PrivateVideoError('CONFLICT');
      }
      await audit(tx, actor, id, 'retryProcessing', this.clock.nowIso());
      return view(next);
    });
    try {
      if (this.dispatcher) await this.dispatcher.dispatch({ organizationId: actor.organizationId,
        videoId: id, processingToken });
      else {
        await this.processAccepted({ organizationId: actor.organizationId,
          videoId: id, processingToken });
        return view(owned(await this.database.get(PRIVATE_VIDEO_COLLECTION, id), actor));
      }
    } catch {
      await this.failProcessing(actor.organizationId, id, processingToken, 'SERVICE_UNAVAILABLE');
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    }
    return accepted;
  }

  async processAccepted(job: Readonly<{ organizationId: string; videoId: string;
    processingToken: string }>): Promise<'ready' | 'failed' | 'stale'> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(job.organizationId)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(job.videoId)
      || !/^[a-f0-9]{32}$/.test(job.processingToken)) return 'stale';
    const claimed = await this.database.runTransaction(async tx => {
      const row = await tx.get(PRIVATE_VIDEO_COLLECTION, job.videoId) as PrivateVideoDocument | null;
      if (!row || row.organizationId !== job.organizationId || row.status !== 'processing'
        || row.processingToken !== job.processingToken || !row.stagingPath || !row.stagingFileId
        || row.processingClaimedAt) return null;
      const next: PrivateVideoDocument = { ...row, processingClaimedAt: this.clock.nowIso(),
        version: row.version + 1 };
      return await tx.replace(PRIVATE_VIDEO_COLLECTION, row._id, row.version, next) ? next : null;
    });
    if (!claimed) return 'stale';
    if (!this.processor) {
      await this.failProcessing(job.organizationId, job.videoId, job.processingToken,
        'SERVICE_UNAVAILABLE');
      return 'failed';
    }
    let processed: PrivateVideoProcessed;
    try {
      processed = await this.processor.process(claimed.stagingFileId!, claimed.stagingPath!);
      if (!Number.isSafeInteger(processed.durationMs) || processed.durationMs < 1000
        || processed.durationMs > PRIVATE_VIDEO_MAX_DURATION_MS) {
        throw new PrivateVideoError('MEDIA_INVALID');
      }
    } catch (error: unknown) {
      await this.failProcessing(job.organizationId, job.videoId, job.processingToken,
        error instanceof PrivateVideoError ? error.code : 'SERVICE_UNAVAILABLE');
      return 'failed';
    }
    const saved = await this.database.runTransaction(async tx => {
      const row = await tx.get(PRIVATE_VIDEO_COLLECTION, job.videoId) as PrivateVideoDocument | null;
      if (!row || row.organizationId !== job.organizationId || row.status !== 'processing'
        || row.processingToken !== job.processingToken || row.version !== claimed.version) return false;
      const now = this.clock.nowIso();
      const next: PrivateVideoDocument = { ...row, status: 'ready',
        media: processed as unknown as JsonObject, processingToken: null,
        processingClaimedAt: null, processingError: null,
        version: row.version + 1, updatedAt: now };
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, row._id, row.version, next)) return false;
      await this.auditWorker(tx, row, 'ready', now, null);
      return true;
    });
    return saved ? 'ready' : 'stale';
  }

  private async failProcessing(organizationId: string, id: string, token: string,
    code: string): Promise<void> {
    await this.database.runTransaction(async tx => {
      const row = await tx.get(PRIVATE_VIDEO_COLLECTION, id) as PrivateVideoDocument | null;
      if (!row || row.organizationId !== organizationId || row.status !== 'processing'
        || row.processingToken !== token) return;
      const now = this.clock.nowIso();
      const next: PrivateVideoDocument = { ...row, status: 'failed', processingToken: null,
        processingClaimedAt: null, processingError: code,
        version: row.version + 1, updatedAt: now };
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, row.version, next)) return;
      await this.auditWorker(tx, row, 'failed', now, code);
    });
  }

  private async auditWorker(tx: DocumentDatabaseTransactionPort, row: PrivateVideoDocument,
    result: 'ready' | 'failed', now: string, code: string | null): Promise<void> {
    const saved = await tx.append('operation_logs', {
      _id: `teacher_video_worker_${randomUUID().replace(/-/g, '')}`,
      organizationId: row.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      requestId: `worker_${row._id}_${row.processingToken ?? randomUUID().replace(/-/g, '')}`,
      actorUserId: 'server-worker', actorRole: 'system',
      action: `teacher-private-video-worker.${result}`, targetType: 'learning_resource',
      targetId: row._id, result: result === 'ready' ? 'succeeded' : 'denied',
      errorCode: code,
      occurredAt: now, metadata: { contentVersion: row.contentVersion },
    });
    if (!saved) throw new PrivateVideoError('SERVICE_UNAVAILABLE');
  }

  async publish(actor: TrustedActorContext, id: string, expectedVersion: number): Promise<PrivateVideoView> {
    requireTeacher(actor);
    const classIds = await this.authorizedClassIds(actor);
    return this.database.runTransaction(async tx => {
      const row = owned(await tx.get(PRIVATE_VIDEO_COLLECTION, id), actor);
      if (row.version !== expectedVersion || row.status !== 'ready' || !row.media) {
        throw new PrivateVideoError('CONFLICT');
      }
      validateQuestions(row.questions);
      const now = this.clock.nowIso();
      const questions: TeacherMediaQuestionView[] = row.questions.map(({ questionId, questionType, stem, options }) =>
        ({ questionId, questionType, stem, options }));
      const answerKeys: TeacherMediaAnswerKey[] = row.questions.map(({ questionId, correctAnswer, explanation }) =>
        ({ questionId, correctAnswer, explanation }));
      const candidate: TeacherMediaCandidate = {
        id: row._id, organizationId: row.organizationId, title: row.title, kind: 'video',
        version: row.contentVersion, status: 'published', reviewVersion: row.contentVersion,
        reviewedBy: actor.actorUserId, reviewedAt: now, copyrightStatus: 'unverified',
        copyrightEvidenceKey: null,
        scanStatus: row.media.directUploadEvidence ? 'pending' : 'clean',
        transcodeStatus: row.media.directUploadEvidence ? 'pending' : 'ready',
        sourceScanEvidence: row.media.sourceScanEvidence as TeacherMediaCandidate['sourceScanEvidence'] ?? null,
        scanEvidence: row.media.scanEvidence as TeacherMediaCandidate['scanEvidence'] ?? null,
        transcodeEvidence: row.media.transcodeEvidence as TeacherMediaCandidate['transcodeEvidence'] ?? null,
        directUploadEvidence: row.media.directUploadEvidence as TeacherMediaCandidate['directUploadEvidence'] ?? null,
        mediaAssetKey: String(row.media.mediaAssetKey), mediaSha256: String(row.media.mediaSha256),
        durationMs: Number(row.media.durationMs), allowedClassIds: classIds,
        questionIds: questions.map(question => question.questionId), questions, answerKeys, clips: [],
        continuousPlaybackEnforced: true,
      };
      const gate = freezeTeacherMediaForTask(candidate, row.organizationId,
        [classIds[0]!], 'teacher_private');
      if (!gate.ready || candidate.durationMs > PRIVATE_VIDEO_MAX_DURATION_MS) {
        throw new PrivateVideoError('MEDIA_INVALID');
      }
      const next: PrivateVideoDocument = { ...row, status: 'published',
        media: { ...row.media, publishedCandidate: candidate as unknown as JsonObject },
        version: row.version + 1, updatedAt: now };
      const resource: VersionedDocument = {
        _id: id, organizationId: row.organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, type: 'video', title: row.title,
        contentVersion: row.contentVersion, status: 'published',
        teacherPrivateOwnerId: actor.actorUserId,
        visibility: { type: 'classes', classIds },
        allowedClassIds: classIds,
        payload: { teacherPrivate: { ownerTeacherId: actor.actorUserId },
          teacherMedia: candidate as unknown as JsonObject },
      };
      const oldResource = await tx.get('learning_resources', id);
      const resourceSaved = oldResource
        ? await tx.replace('learning_resources', id, oldResource.version,
          { ...resource, version: oldResource.version + 1 })
        : await tx.create('learning_resources', resource);
      if (!resourceSaved) throw new PrivateVideoError('CONFLICT');
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, row.version, next)) {
        throw new PrivateVideoError('CONFLICT');
      }
      await audit(tx, actor, id, 'publish', now);
      return view(next);
    });
  }

  async withdraw(actor: TrustedActorContext, id: string, expectedVersion: number): Promise<PrivateVideoView> {
    requireTeacher(actor);
    return this.database.runTransaction(async tx => {
      const row = owned(await tx.get(PRIVATE_VIDEO_COLLECTION, id), actor);
      if (row.version !== expectedVersion || row.status !== 'published') throw new PrivateVideoError('CONFLICT');
      const next: PrivateVideoDocument = { ...row, status: 'offline', version: row.version + 1,
        updatedAt: this.clock.nowIso() };
      const resource = await tx.get('learning_resources', id);
      if (resource && !await tx.replace('learning_resources', id, resource.version,
        { ...resource, status: 'offline', version: resource.version + 1 })) {
        throw new PrivateVideoError('CONFLICT');
      }
      if (!await tx.replace(PRIVATE_VIDEO_COLLECTION, id, row.version, next)) {
        throw new PrivateVideoError('CONFLICT');
      }
      await audit(tx, actor, id, 'withdraw', this.clock.nowIso());
      return view(next);
    });
  }
}
