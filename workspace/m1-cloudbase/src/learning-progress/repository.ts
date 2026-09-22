import type {
  LearningProgressAuditRecord,
  LearningProgressOperationRecord,
  LearningResourceAccessRecord,
  ReadingProgressRecord,
  VocabularyProgressRecord,
} from './types';

export interface LearningProgressReader {
  findResource(organizationId: string, resourceId: string): Promise<LearningResourceAccessRecord | null>;
  findReadingProgress(organizationId: string, studentId: string, resourceId: string): Promise<ReadingProgressRecord | null>;
  findVocabularyProgress(organizationId: string, studentId: string, packId: string): Promise<VocabularyProgressRecord | null>;
}

export interface LearningProgressTransaction extends LearningProgressReader {
  findOperation(recordId: string): Promise<LearningProgressOperationRecord | null>;
  saveReadingProgress(record: ReadingProgressRecord): Promise<void>;
  saveVocabularyProgress(record: VocabularyProgressRecord): Promise<void>;
  saveOperation(record: LearningProgressOperationRecord): Promise<void>;
  appendAudit(record: LearningProgressAuditRecord): Promise<void>;
}

export interface LearningProgressRepository extends LearningProgressReader {
  runTransaction<T>(work: (transaction: LearningProgressTransaction) => Promise<T>): Promise<T>;
  appendAudit(record: LearningProgressAuditRecord): Promise<void>;
}

