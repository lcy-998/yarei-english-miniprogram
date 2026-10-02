import type { VocabularyEvidenceTransaction, VocabularyEvidenceUnitOfWork } from './repository';
import type { VocabularyAttemptReceipt, VocabularyAttemptRecord, VocabularyEvidenceScope } from './types';

export interface VocabularyEvidenceFixture {
  readonly autonomousScopes?: readonly VocabularyEvidenceScope[];
  readonly taskScopes?: readonly VocabularyEvidenceScope[];
  readonly attempts?: readonly VocabularyAttemptRecord[];
  readonly receipts?: readonly VocabularyAttemptReceipt[];
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

interface MutableState {
  autonomousScopes: VocabularyEvidenceScope[];
  taskScopes: VocabularyEvidenceScope[];
  attempts: VocabularyAttemptRecord[];
  receipts: VocabularyAttemptReceipt[];
}

export class InMemoryVocabularyEvidenceRepository implements VocabularyEvidenceUnitOfWork, VocabularyEvidenceTransaction {
  private state: MutableState;
  private tail: Promise<void> = Promise.resolve();
  public constructor(fixture: VocabularyEvidenceFixture = {}) {
    this.state = copy({ autonomousScopes: [...(fixture.autonomousScopes ?? [])], taskScopes: [...(fixture.taskScopes ?? [])],
      attempts: [...(fixture.attempts ?? [])], receipts: [...(fixture.receipts ?? [])] });
  }
  public async transaction<T>(work: (transaction: VocabularyEvidenceTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = copy(this.state);
    try { return await work(this); }
    catch (error: unknown) { this.state = before; throw error; }
    finally { release(); }
  }
  public async findAutonomousScope(organizationId: string, studentId: string, packId: string): Promise<VocabularyEvidenceScope | null> {
    return copy(this.state.autonomousScopes.find(item => item.organizationId === organizationId && item.studentId === studentId
      && item.packId === packId) ?? null);
  }
  public async findTaskScope(organizationId: string, studentId: string, taskId: string, itemId: string,
    packId: string, _nowIso: string): Promise<VocabularyEvidenceScope | null> {
    return copy(this.state.taskScopes.find(item => item.organizationId === organizationId && item.studentId === studentId
      && item.taskId === taskId && item.itemId === itemId && item.packId === packId) ?? null);
  }
  public async listAttempts(organizationId: string, studentId: string, packId: string, taskId: string | null,
    itemId: string | null, round: number, contentVersion: string, wordId: string): Promise<readonly VocabularyAttemptRecord[]> {
    return copy(this.state.attempts.filter(item => item.organizationId === organizationId && item.studentId === studentId
      && item.packId === packId && item.taskId === taskId && item.itemId === itemId && item.round === round
      && item.contentVersion === contentVersion && item.wordId === wordId)
      .sort((left, right) => left.attemptNumber - right.attemptNumber));
  }
  public async listScopeAttempts(organizationId: string, studentId: string, packId: string, taskId: string | null,
    itemId: string | null, round: number, contentVersion: string): Promise<readonly VocabularyAttemptRecord[]> {
    return copy(this.state.attempts.filter(item => item.organizationId === organizationId && item.studentId === studentId
      && item.packId === packId && item.taskId === taskId && item.itemId === itemId && item.round === round
      && item.contentVersion === contentVersion));
  }
  public async appendAttempt(attempt: VocabularyAttemptRecord): Promise<boolean> {
    if (this.state.attempts.some(item => item.id === attempt.id)) return false;
    this.state.attempts.push(copy(attempt));
    return true;
  }
  public async findReceipt(organizationId: string, studentId: string, operationId: string): Promise<VocabularyAttemptReceipt | null> {
    return copy(this.state.receipts.find(item => item.organizationId === organizationId && item.studentId === studentId
      && item.operationId === operationId) ?? null);
  }
  public async saveReceipt(receipt: VocabularyAttemptReceipt): Promise<boolean> {
    if (this.state.receipts.some(item => item.organizationId === receipt.organizationId && item.studentId === receipt.studentId
      && item.operationId === receipt.operationId)) return false;
    this.state.receipts.push(copy(receipt));
    return true;
  }
  public snapshot(): Readonly<MutableState> { return copy(this.state); }
}
