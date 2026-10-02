import type { TrustedActorContext } from '../auth/trusted-actor';
import type { Clock, IdentifierGenerator } from '../runtime/ports';
import type { LearningProgressRepository, LearningProgressTransaction } from './repository';
import {
  LearningProgressError,
  type LearningProgressAuditRecord,
  type LearningProgressOperationRecord,
  type LearningResourceAccessRecord,
  type ReadingProgressRecord,
  type ReadingPageEventRecord,
  type ReadingProgressView,
  type VocabularyProgressRecord,
  type VocabularyProgressView,
} from './types';

export interface SaveReadingProgressInput {
  readonly resourceId: string;
  readonly chapterId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly favorite: boolean;
  readonly expectedVersion: number;
  readonly operationId: string;
}

export interface SaveVocabularyProgressInput {
  readonly packId: string;
  readonly completedCount: number;
  readonly correctCount: number;
  readonly wrongWordIds: readonly string[];
  readonly expectedVersion: number;
  readonly operationId: string;
}

export class LearningProgressService {
  public constructor(
    private readonly repository: LearningProgressRepository,
    private readonly clock: Clock,
    private readonly ids: IdentifierGenerator,
  ) {}

  public async getReadingProgress(actor: TrustedActorContext, resourceId: string): Promise<ReadingProgressView | null> {
    this.requireStudent(actor);
    const resource = await this.requireResource(actor, resourceId, 'reading');
    const record = await this.repository.findReadingProgress(actor.organizationId, actor.actorUserId, resource.id);
    return record === null ? null : readingView(record);
  }

  public async getVocabularyProgress(actor: TrustedActorContext, packId: string): Promise<VocabularyProgressView | null> {
    this.requireStudent(actor);
    const resource = await this.requireResource(actor, packId, 'vocabulary');
    const record = await this.repository.findVocabularyProgress(actor.organizationId, actor.actorUserId, resource.id);
    return record === null ? null : vocabularyView(record);
  }

  public async saveReadingProgress(actor: TrustedActorContext, input: SaveReadingProgressInput): Promise<ReadingProgressView> {
    validateOperationId(input.operationId);
    return this.write(actor, 'saveReadingProgress', input.resourceId, input.operationId, fingerprint(input), async (transaction, resource) => {
      const page = resource.pages.find((candidate) => candidate.id === input.pageId);
      if (resource.type !== 'reading'
        || page === undefined
        || page.chapterId !== input.chapterId
        || page.pageNumber !== input.pageNumber) {
        throw new LearningProgressError('VALIDATION_ERROR');
      }
      const current = await transaction.findReadingProgress(actor.organizationId, actor.actorUserId, input.resourceId);
      requireVersion(current?.version ?? 0, input.expectedVersion);
      const next: ReadingProgressRecord = {
        id: current?.id ?? `reading_progress_${actor.actorUserId}_${input.resourceId}`,
        organizationId: actor.organizationId,
        studentId: actor.actorUserId,
        resourceId: input.resourceId,
        chapterId: input.chapterId,
        pageId: input.pageId,
        pageNumber: input.pageNumber,
        favorite: input.favorite,
        version: (current?.version ?? 0) + 1,
        updatedAt: this.clock.nowIso(),
      };
      await transaction.saveReadingProgress(next);
      const pageEvent: ReadingPageEventRecord = { id: this.ids.next('reading_page_event'), organizationId: actor.organizationId,
        studentId: actor.actorUserId, resourceId: input.resourceId, chapterId: page.chapterId, pageId: page.id,
        pageNumber: page.pageNumber, progressVersion: next.version, contentVersion: resource.contentVersion ?? null,
        operationId: input.operationId, visitedAt: next.updatedAt };
      await transaction.appendReadingPageEvent(pageEvent);
      return readingView(next);
    });
  }

  public async saveVocabularyProgress(actor: TrustedActorContext, input: SaveVocabularyProgressInput): Promise<VocabularyProgressView> {
    validateOperationId(input.operationId);
    return this.write(actor, 'saveVocabularyProgress', input.packId, input.operationId, fingerprint(input), async (transaction, resource) => {
      const wrongWordIds = [...new Set(input.wrongWordIds)];
      if (resource.type !== 'vocabulary'
        || !isNonNegativeInteger(input.completedCount)
        || !isNonNegativeInteger(input.correctCount)
        || input.completedCount > resource.wordIds.length
        || input.correctCount > input.completedCount
        || wrongWordIds.length > input.completedCount
        || wrongWordIds.some((wordId) => !resource.wordIds.includes(wordId))) {
        throw new LearningProgressError('VALIDATION_ERROR');
      }
      const current = await transaction.findVocabularyProgress(actor.organizationId, actor.actorUserId, input.packId);
      requireVersion(current?.version ?? 0, input.expectedVersion);
      const next: VocabularyProgressRecord = {
        id: current?.id ?? `vocabulary_progress_${actor.actorUserId}_${input.packId}`,
        organizationId: actor.organizationId,
        studentId: actor.actorUserId,
        packId: input.packId,
        completedCount: input.completedCount,
        correctCount: input.correctCount,
        correctRate: input.completedCount === 0 ? 0 : Math.round(input.correctCount * 10_000 / input.completedCount) / 100,
        wrongWordIds: wrongWordIds.sort(),
        version: (current?.version ?? 0) + 1,
        updatedAt: this.clock.nowIso(),
      };
      await transaction.saveVocabularyProgress(next);
      return vocabularyView(next);
    });
  }

  private async write<T extends ReadingProgressView | VocabularyProgressView>(
    actor: TrustedActorContext,
    action: LearningProgressOperationRecord['action'],
    targetId: string,
    operationId: string,
    requestFingerprint: string,
    perform: (transaction: LearningProgressTransaction, resource: LearningResourceAccessRecord) => Promise<T>,
  ): Promise<T> {
    const auditAction = action === 'saveReadingProgress' ? 'reading_progress.saved' : 'vocabulary_progress.saved';
    try {
      this.requireStudent(actor);
      return await this.repository.runTransaction(async (transaction) => {
        const operationRecordId = `${actor.organizationId}:${actor.actorUserId}:${operationId}`;
        const existing = await transaction.findOperation(operationRecordId);
        if (existing !== null) {
          if (existing.action !== action || existing.fingerprint !== requestFingerprint) throw new LearningProgressError('CONFLICT');
          return existing.result as T;
        }
        const resource = await this.requireResource(actor, targetId, action === 'saveReadingProgress' ? 'reading' : 'vocabulary', transaction);
        const result = await perform(transaction, resource);
        await transaction.saveOperation({
          id: operationRecordId,
          organizationId: actor.organizationId,
          studentId: actor.actorUserId,
          action,
          operationId,
          fingerprint: requestFingerprint,
          result,
        });
        await transaction.appendAudit(this.audit(actor, auditAction, targetId, 'succeeded'));
        return result;
      });
    } catch (error: unknown) {
      const reason = error instanceof LearningProgressError ? error.code : 'INTERNAL_ERROR';
      await this.repository.appendAudit(this.audit(actor, auditAction, targetId, 'denied', reason));
      throw error;
    }
  }

  private requireStudent(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'student') throw new LearningProgressError('FORBIDDEN');
  }

  private async requireResource(
    actor: TrustedActorContext,
    resourceId: string,
    type: LearningResourceAccessRecord['type'],
    reader: Pick<LearningProgressRepository, 'findResource'> = this.repository,
  ): Promise<LearningResourceAccessRecord> {
    const resource = await reader.findResource(actor.organizationId, resourceId);
    if (resource === null || resource.type !== type) throw new LearningProgressError('NOT_FOUND');
    if (resource.status !== 'published') throw new LearningProgressError('RESOURCE_OFFLINE');
    if (!resource.allowedStudentIds.includes(actor.actorUserId)) throw new LearningProgressError('NOT_FOUND');
    return resource;
  }

  private audit(
    actor: TrustedActorContext,
    action: LearningProgressAuditRecord['action'],
    targetId: string,
    result: LearningProgressAuditRecord['result'],
    reason?: string,
  ): LearningProgressAuditRecord {
    return {
      id: this.ids.next('learning_audit'),
      requestId: actor.requestId,
      organizationId: actor.organizationId,
      actorUserId: actor.actorUserId,
      actorRole: 'student',
      action,
      targetId,
      result,
      ...(reason === undefined ? {} : { reason }),
      occurredAt: this.clock.nowIso(),
    };
  }
}

function readingView(record: ReadingProgressRecord): ReadingProgressView {
  const { organizationId: _organizationId, studentId: _studentId, ...view } = record;
  return view;
}

function vocabularyView(record: VocabularyProgressRecord): VocabularyProgressView {
  const { organizationId: _organizationId, studentId: _studentId, ...view } = record;
  return { ...view, wrongWordIds: [...view.wrongWordIds] };
}

function fingerprint(input: SaveReadingProgressInput | SaveVocabularyProgressInput): string {
  const operationId = input.operationId;
  const body = 'resourceId' in input
    ? [input.resourceId, input.chapterId, input.pageId, input.pageNumber, input.favorite, input.expectedVersion]
    : [input.packId, input.completedCount, input.correctCount, [...new Set(input.wrongWordIds)].sort(), input.expectedVersion];
  return `${operationId}|${JSON.stringify(body)}`;
}

function requireVersion(currentVersion: number, expectedVersion: number): void {
  if (!isNonNegativeInteger(expectedVersion)) throw new LearningProgressError('VALIDATION_ERROR');
  if (currentVersion !== expectedVersion) throw new LearningProgressError('CONFLICT');
}

function validateOperationId(operationId: string): void {
  if (operationId.trim().length === 0 || operationId.length > 128) throw new LearningProgressError('VALIDATION_ERROR');
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
