import type { VocabularyAttemptReceipt, VocabularyAttemptRecord, VocabularyEvidenceScope } from './types';

export interface VocabularyEvidenceTransaction {
  findAutonomousScope(organizationId: string, studentId: string, packId: string): Promise<VocabularyEvidenceScope | null>;
  findTaskScope(organizationId: string, studentId: string, taskId: string, itemId: string,
    packId: string, nowIso: string): Promise<VocabularyEvidenceScope | null>;
  listAttempts(organizationId: string, studentId: string, packId: string, taskId: string | null,
    itemId: string | null, round: number, contentVersion: string, wordId: string): Promise<readonly VocabularyAttemptRecord[]>;
  listScopeAttempts(organizationId: string, studentId: string, packId: string, taskId: string | null,
    itemId: string | null, round: number, contentVersion: string): Promise<readonly VocabularyAttemptRecord[]>;
  appendAttempt(attempt: VocabularyAttemptRecord): Promise<boolean>;
  findReceipt(organizationId: string, studentId: string, operationId: string): Promise<VocabularyAttemptReceipt | null>;
  saveReceipt(receipt: VocabularyAttemptReceipt): Promise<boolean>;
}

export interface VocabularyEvidenceUnitOfWork {
  transaction<T>(work: (transaction: VocabularyEvidenceTransaction) => Promise<T>): Promise<T>;
}
