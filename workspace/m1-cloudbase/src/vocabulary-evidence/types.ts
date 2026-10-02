export interface VocabularyWordSnapshot { readonly id: string; readonly spelling: string }

export interface VocabularyEvidenceScope {
  readonly organizationId: string;
  readonly packId: string;
  readonly contentVersion: string;
  readonly words: readonly VocabularyWordSnapshot[];
  readonly taskId: string | null;
  readonly itemId: string | null;
  readonly round: number;
  readonly studentId: string;
  readonly status: 'available' | 'locked';
}

export interface VocabularyAttemptRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly packId: string;
  readonly taskId: string | null;
  readonly itemId: string | null;
  readonly round: number;
  readonly contentVersion: string;
  readonly wordId: string;
  readonly studentInput: string;
  readonly isCorrect: boolean;
  readonly firstAttempt: boolean;
  readonly attemptNumber: number;
  readonly attemptedAt: string;
}

export type VocabularyAttemptView = Omit<VocabularyAttemptRecord, 'organizationId' | 'studentId'>;

export interface VocabularyAttemptState {
  readonly wordId: string;
  readonly firstCorrect: boolean | null;
  readonly version: number;
  readonly attempts: readonly VocabularyAttemptView[];
}

export interface VocabularyWordAttemptSummary {
  readonly wordId: string;
  readonly firstCorrect: boolean | null;
  readonly lastCorrect: boolean | null;
  readonly version: number;
}

export interface VocabularyPackAttemptSummary {
  readonly packId: string;
  readonly contentVersion: string;
  readonly round: number;
  readonly words: readonly VocabularyWordAttemptSummary[];
}

export interface VocabularyAttemptReceipt {
  readonly organizationId: string;
  readonly studentId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: VocabularyAttemptRecord;
}

export type VocabularyEvidenceErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RESOURCE_OFFLINE' | 'TASK_NOT_SUBMITTABLE' | 'SERVICE_UNAVAILABLE';

export class VocabularyEvidenceError extends Error {
  public constructor(public readonly code: VocabularyEvidenceErrorCode) {
    super(code);
    this.name = 'VocabularyEvidenceError';
  }
}
