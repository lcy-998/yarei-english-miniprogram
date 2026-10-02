import type { TrustedActorContext } from '../auth/trusted-actor';
import type { VocabularyEvidenceTransaction, VocabularyEvidenceUnitOfWork } from './repository';
import { VocabularyEvidenceError, type VocabularyAttemptRecord, type VocabularyAttemptState,
  type VocabularyAttemptView, type VocabularyEvidenceScope, type VocabularyPackAttemptSummary } from './types';
import { summarizeVocabularyFirstAttempts } from './summary';

export interface VocabularyAttemptInput {
  readonly packId: string;
  readonly wordId: string;
  readonly studentInput: string;
  readonly taskId?: string;
  readonly itemId?: string;
}

export interface VocabularyClock { nowIso(): string }
export interface VocabularyIds { next(prefix: string): string }

function view(record: VocabularyAttemptRecord): VocabularyAttemptView {
  const { organizationId: ignoredOrganization, studentId: ignoredStudent, ...result } = record;
  void ignoredOrganization;
  void ignoredStudent;
  return { ...result };
}

function normalizedWord(value: string): string { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

export class VocabularyEvidenceService {
  public constructor(private readonly repository: VocabularyEvidenceUnitOfWork,
    private readonly clock: VocabularyClock, private readonly ids: VocabularyIds) {}

  public async submit(actor: TrustedActorContext, input: VocabularyAttemptInput,
    expectedVersion: number, operationId: string): Promise<VocabularyAttemptView> {
    if (actor.actorRole !== 'student') throw new VocabularyEvidenceError('FORBIDDEN');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(operationId)
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
      || typeof input.packId !== 'string' || !input.packId.trim()
      || typeof input.wordId !== 'string' || !input.wordId.trim()
      || typeof input.studentInput !== 'string' || !input.studentInput.trim() || input.studentInput.length > 100
      || Boolean(input.taskId) !== Boolean(input.itemId)) throw new VocabularyEvidenceError('VALIDATION_ERROR');
    const answer = input.studentInput.trim();
    const fingerprint = JSON.stringify({ ...input, studentInput: answer, expectedVersion });
    return this.repository.transaction(async transaction => {
      const scope = await this.scope(transaction, actor, input);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new VocabularyEvidenceError('CONFLICT');
        return view(prior.result);
      }
      if (scope.status !== 'available') throw new VocabularyEvidenceError('TASK_NOT_SUBMITTABLE');
      const matchingWords = scope.words.filter(word => word.id === input.wordId);
      if (matchingWords.length !== 1 || !matchingWords[0]?.spelling.trim()
        || new Set(scope.words.map(word => word.id)).size !== scope.words.length) {
        throw new VocabularyEvidenceError('RESOURCE_OFFLINE');
      }
      const attempts = await transaction.listAttempts(actor.organizationId, actor.actorUserId, scope.packId,
        scope.taskId, scope.itemId, scope.round, scope.contentVersion, input.wordId);
      if (attempts.length !== expectedVersion || attempts.some((attempt, index) => attempt.attemptNumber !== index + 1)) {
        throw new VocabularyEvidenceError('CONFLICT');
      }
      const record: VocabularyAttemptRecord = { id: this.ids.next('vocabulary_attempt'),
        organizationId: actor.organizationId, studentId: actor.actorUserId, packId: scope.packId,
        taskId: scope.taskId, itemId: scope.itemId, round: scope.round, contentVersion: scope.contentVersion,
        wordId: input.wordId, studentInput: answer,
        isCorrect: normalizedWord(answer) === normalizedWord(matchingWords[0].spelling),
        firstAttempt: attempts.length === 0, attemptNumber: attempts.length + 1, attemptedAt: this.clock.nowIso() };
      if (!await transaction.appendAttempt(record)) throw new VocabularyEvidenceError('CONFLICT');
      if (!await transaction.saveReceipt({ organizationId: actor.organizationId, studentId: actor.actorUserId,
        operationId, fingerprint, result: record })) throw new VocabularyEvidenceError('CONFLICT');
      return view(record);
    });
  }

  public async getState(actor: TrustedActorContext, input: Omit<VocabularyAttemptInput, 'studentInput'>): Promise<VocabularyAttemptState> {
    if (actor.actorRole !== 'student') throw new VocabularyEvidenceError('FORBIDDEN');
    if (!input.packId?.trim() || !input.wordId?.trim() || Boolean(input.taskId) !== Boolean(input.itemId)) {
      throw new VocabularyEvidenceError('VALIDATION_ERROR');
    }
    return this.repository.transaction(async transaction => {
      const scope = await this.scope(transaction, actor, input);
      if (!scope.words.some(word => word.id === input.wordId)) throw new VocabularyEvidenceError('NOT_FOUND');
      const attempts = await transaction.listAttempts(actor.organizationId, actor.actorUserId, scope.packId,
        scope.taskId, scope.itemId, scope.round, scope.contentVersion, input.wordId);
      return { wordId: input.wordId, firstCorrect: attempts[0]?.isCorrect ?? null,
        version: attempts.length, attempts: attempts.map(view) };
    });
  }

  public async getPackSummary(actor: TrustedActorContext,
    input: Readonly<{ packId: string; taskId?: string; itemId?: string }>): Promise<VocabularyPackAttemptSummary> {
    if (actor.actorRole !== 'student') throw new VocabularyEvidenceError('FORBIDDEN');
    if (!input.packId?.trim() || Boolean(input.taskId) !== Boolean(input.itemId)) {
      throw new VocabularyEvidenceError('VALIDATION_ERROR');
    }
    return this.repository.transaction(async transaction => {
      const scope = await this.scope(transaction, actor, { ...input, wordId: '' });
      const wordIds = scope.words.map(word => word.id);
      if (!wordIds.length || new Set(wordIds).size !== wordIds.length) throw new VocabularyEvidenceError('RESOURCE_OFFLINE');
      const attempts = await transaction.listScopeAttempts(actor.organizationId, actor.actorUserId,
        scope.packId, scope.taskId, scope.itemId, scope.round, scope.contentVersion);
      if (summarizeVocabularyFirstAttempts(wordIds, attempts) === null) throw new VocabularyEvidenceError('SERVICE_UNAVAILABLE');
      return { packId: scope.packId, contentVersion: scope.contentVersion, round: scope.round,
        words: wordIds.map(wordId => {
          const entries = attempts.filter(attempt => attempt.wordId === wordId)
            .sort((left, right) => left.attemptNumber - right.attemptNumber);
          return { wordId, firstCorrect: entries[0]?.isCorrect ?? null,
            lastCorrect: entries[entries.length - 1]?.isCorrect ?? null, version: entries.length };
        }) };
    });
  }

  private async scope(transaction: VocabularyEvidenceTransaction, actor: TrustedActorContext,
    input: Omit<VocabularyAttemptInput, 'studentInput'>): Promise<VocabularyEvidenceScope> {
    const scope = input.taskId && input.itemId
      ? await transaction.findTaskScope(actor.organizationId, actor.actorUserId, input.taskId, input.itemId, input.packId,
        this.clock.nowIso())
      : await transaction.findAutonomousScope(actor.organizationId, actor.actorUserId, input.packId);
    if (!scope || scope.studentId !== actor.actorUserId || scope.organizationId !== actor.organizationId
      || scope.packId !== input.packId || !scope.contentVersion.trim()
      || (input.taskId && (scope.taskId !== input.taskId || scope.itemId !== input.itemId))) {
      throw new VocabularyEvidenceError('NOT_FOUND');
    }
    return scope;
  }
}
