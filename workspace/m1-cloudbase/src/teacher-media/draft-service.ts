import type { TrustedActorContext } from '../auth/trusted-actor';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate,
  type TeacherMediaClip, type TeacherMediaQuestionView, type TeacherMediaSubtitleCue,
} from './publish-gate';
import type { TeacherMediaRecord } from './review-service';

export interface BeginTeacherMediaInput {
  readonly title: string;
  readonly kind: TeacherMediaCandidate['kind'];
  readonly allowedClassIds: readonly string[];
  readonly copyrightEvidenceKey: string;
  readonly questionIds: readonly string[];
  readonly questions: readonly TeacherMediaQuestionView[];
  readonly answerKeys: TeacherMediaCandidate['answerKeys'];
  readonly clips: readonly TeacherMediaClip[];
  readonly subtitleAssetKey?: string;
  readonly subtitleCues?: readonly TeacherMediaSubtitleCue[];
}

export interface TeacherMediaDraftView {
  readonly mediaId: string;
  readonly status: TeacherMediaRecord['status'];
  readonly recordVersion: number;
  readonly stagingPath: string;
  readonly scanStatus: TeacherMediaRecord['scanStatus'];
  readonly transcodeStatus: TeacherMediaRecord['transcodeStatus'];
}

export interface ProcessedTeacherMedia {
  readonly mediaAssetKey: string;
  readonly mediaSha256: string;
  readonly durationMs: number;
  readonly sourceScanEvidence: NonNullable<TeacherMediaCandidate['sourceScanEvidence']>;
  readonly transcodeEvidence: NonNullable<TeacherMediaCandidate['transcodeEvidence']>;
  readonly scanEvidence: NonNullable<TeacherMediaCandidate['scanEvidence']>;
}

export interface TeacherMediaDraftPort {
  hasCurrentTeacherClassGrant(organizationId: string, teacherId: string,
    classId: string, permission: 'media.upload'): Promise<boolean>;
  find(organizationId: string, mediaId: string): Promise<TeacherMediaRecord | null>;
  findSealReceipt(organizationId: string, teacherId: string,
    operationId: string): Promise<Readonly<{ fingerprint: string; record: TeacherMediaRecord }> | null>;
  create(record: TeacherMediaRecord, operationId: string): Promise<TeacherMediaRecord>;
  replace(record: TeacherMediaRecord, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<TeacherMediaRecord | null>;
  nextId(): string;
}

/** No implementation may return success before it has actually scanned raw bytes, transcoded, then rescanned output. */
export interface TeacherMediaProcessingPort {
  process(stagingPath: string, stagingFileId: string,
    kind: TeacherMediaCandidate['kind']): Promise<ProcessedTeacherMedia | null>;
}

export type TeacherMediaDraftResult = Readonly<{ ok: true; data: TeacherMediaDraftView }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
    | 'CONFLICT' | 'MEDIA_INVALID' | 'SERVICE_UNAVAILABLE' }>;

/** T-20 business gate. A missing real processor keeps drafts unreviewable. */
export class TeacherMediaDraftService {
  public constructor(private readonly port: TeacherMediaDraftPort,
    private readonly processor: TeacherMediaProcessingPort | null,
    private readonly clock: Readonly<{ nowIso(): string }>,
    private readonly continuousPlaybackReady = false) {}

  public async begin(actor: TrustedActorContext, input: BeginTeacherMediaInput,
    operationId: string): Promise<TeacherMediaDraftResult> {
    if (!validId(operationId) || actor.actorRole !== 'teacher'
      || !actor.permissions.includes('media.upload')) return fail('FORBIDDEN');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100
      || !['listening', 'video', 'dubbing'].includes(input.kind)
      || typeof input.copyrightEvidenceKey !== 'string'
      || !input.copyrightEvidenceKey.startsWith('cloud://')
      || !Array.isArray(input.allowedClassIds)
      || input.allowedClassIds.length < 1 || input.allowedClassIds.length > 50
      || new Set(input.allowedClassIds).size !== input.allowedClassIds.length
      || input.allowedClassIds.some(classId => !validId(classId))
      || !Array.isArray(input.questionIds) || !Array.isArray(input.questions)
      || !Array.isArray(input.answerKeys) || !Array.isArray(input.clips)) return fail('VALIDATION_ERROR');
    if (input.questions.some(question => !question || typeof question !== 'object'
      || !Array.isArray(question.options))
      || input.answerKeys.some(answer => !answer || typeof answer !== 'object')
      || input.clips.some(clip => !clip || typeof clip !== 'object')
      || input.subtitleCues !== undefined && (!Array.isArray(input.subtitleCues)
        || input.subtitleCues.some(cue => !cue || typeof cue !== 'object'))) return fail('VALIDATION_ERROR');
    for (const classId of input.allowedClassIds) {
      if (!actor.scopeIds.includes(classId)
        || !await this.port.hasCurrentTeacherClassGrant(actor.organizationId,
          actor.actorUserId, classId, 'media.upload')) return fail('FORBIDDEN');
    }
    const mediaId = this.port.nextId();
    const record = await this.port.create({ id: mediaId, organizationId: actor.organizationId,
      ownerTeacherId: actor.actorUserId, stagingPath: `teacher-media/staging/${actor.organizationId}/${actor.actorUserId}/${mediaId}`,
      title: input.title.trim(), kind: input.kind, version: 1, recordVersion: 1,
      status: 'draft', reviewVersion: null, reviewedBy: null, reviewedAt: null,
      rejectionReason: null, copyrightStatus: 'unverified',
      copyrightEvidenceKey: input.copyrightEvidenceKey,
      scanStatus: 'pending', transcodeStatus: 'pending',
      sourceScanEvidence: null, scanEvidence: null, transcodeEvidence: null,
      mediaAssetKey: '', mediaSha256: '', durationMs: 0,
      allowedClassIds: [...input.allowedClassIds], questionIds: [...input.questionIds],
      questions: input.questions.map(question => ({ ...question, options: [...question.options] })),
      answerKeys: input.answerKeys.map(answer => ({ ...answer,
        correctAnswer: Array.isArray(answer.correctAnswer) ? [...answer.correctAnswer] : answer.correctAnswer })),
      clips: input.clips.map(clip => ({ ...clip })),
      ...(input.subtitleAssetKey === undefined ? {} : { subtitleAssetKey: input.subtitleAssetKey }),
      ...(input.subtitleCues === undefined ? {} : { subtitleCues: input.subtitleCues.map(cue => ({ ...cue })) }),
      continuousPlaybackEnforced: false,
    }, operationId);
    return record.ownerTeacherId === actor.actorUserId && record.organizationId === actor.organizationId
      ? { ok: true, data: safeView(record) } : fail('CONFLICT');
  }

  public async sealProcessed(actor: TrustedActorContext, mediaId: string, stagingFileId: string,
    expectedRecordVersion: number, operationId: string): Promise<TeacherMediaDraftResult> {
    if (!validId(mediaId) || !validId(operationId)
      || !Number.isSafeInteger(expectedRecordVersion) || expectedRecordVersion < 1
      || typeof stagingFileId !== 'string' || !stagingFileId.startsWith('cloud://')) return fail('VALIDATION_ERROR');
    const current = await this.port.find(actor.organizationId, mediaId);
    if (!current) return fail('NOT_FOUND');
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('media.upload')
      || current.ownerTeacherId !== actor.actorUserId
      || current.allowedClassIds.some(classId => !actor.scopeIds.includes(classId))) return fail('FORBIDDEN');
    for (const classId of current.allowedClassIds) {
      if (!await this.port.hasCurrentTeacherClassGrant(actor.organizationId,
        actor.actorUserId, classId, 'media.upload')) return fail('FORBIDDEN');
    }
    const fingerprint = JSON.stringify([mediaId, stagingFileId, expectedRecordVersion]);
    const prior = await this.port.findSealReceipt(actor.organizationId, actor.actorUserId, operationId);
    if (prior) return prior.fingerprint === fingerprint
      && prior.record.organizationId === actor.organizationId
      && prior.record.ownerTeacherId === actor.actorUserId
      && prior.record.id === mediaId
      ? { ok: true, data: safeView(prior.record) } : fail('CONFLICT');
    if (current.status !== 'draft' && current.status !== 'rejected') return fail('CONFLICT');
    if (current.recordVersion !== expectedRecordVersion || !current.stagingPath) return fail('CONFLICT');
    if (!this.processor) return fail('SERVICE_UNAVAILABLE');
    let processed: ProcessedTeacherMedia | null;
    try { processed = await this.processor.process(current.stagingPath, stagingFileId, current.kind); }
    catch { return fail('SERVICE_UNAVAILABLE'); }
    if (!processed) return fail('MEDIA_INVALID');
    const next: TeacherMediaRecord = { ...current,
      mediaAssetKey: processed.mediaAssetKey, mediaSha256: processed.mediaSha256,
      durationMs: processed.durationMs, scanStatus: 'clean', transcodeStatus: 'ready',
      sourceScanEvidence: processed.sourceScanEvidence,
      transcodeEvidence: processed.transcodeEvidence, scanEvidence: processed.scanEvidence,
      continuousPlaybackEnforced: this.continuousPlaybackReady,
      recordVersion: current.recordVersion + 1 };
    const technical = freezeTeacherMediaForTask({ ...next, status: 'published',
      reviewVersion: next.version, reviewedBy: 'technical-preflight',
      reviewedAt: this.clock.nowIso(), copyrightStatus: 'verified' },
    actor.organizationId, next.allowedClassIds);
    if (!technical.ready) return fail('MEDIA_INVALID');
    const saved = await this.port.replace(next, expectedRecordVersion, operationId, fingerprint);
    return saved && saved.recordVersion === next.recordVersion
      ? { ok: true, data: safeView(saved) } : fail('CONFLICT');
  }
}

function safeView(record: TeacherMediaRecord): TeacherMediaDraftView {
  return { mediaId: record.id, status: record.status, recordVersion: record.recordVersion,
    stagingPath: record.stagingPath ?? '', scanStatus: record.scanStatus,
    transcodeStatus: record.transcodeStatus };
}
function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function fail(code: Extract<TeacherMediaDraftResult, { ok: false }>['code']): TeacherMediaDraftResult {
  return { ok: false, code };
}
