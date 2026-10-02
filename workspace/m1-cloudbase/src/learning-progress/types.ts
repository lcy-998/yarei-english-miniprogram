import type { ErrorCode } from '../shared/protocol';

export class LearningProgressError extends Error {
  public constructor(public readonly code: Extract<ErrorCode,
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RESOURCE_OFFLINE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'>) {
    super(code);
    this.name = 'LearningProgressError';
  }
}

export interface LearningResourceAccessRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly type: 'reading' | 'vocabulary';
  readonly status: 'published' | 'offline';
  readonly contentVersion?: string;
  readonly allowedStudentIds: readonly string[];
  readonly pages: readonly Readonly<{
    id: string;
    chapterId: string;
    pageNumber: number;
  }>[];
  readonly wordIds: readonly string[];
}

export interface ReadingProgressRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly resourceId: string;
  readonly chapterId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly favorite: boolean;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ReadingPageEventRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly resourceId: string;
  readonly chapterId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly progressVersion: number;
  readonly contentVersion: string | null;
  readonly operationId: string;
  readonly visitedAt: string;
}

export interface VocabularyProgressRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly packId: string;
  readonly completedCount: number;
  readonly correctCount: number;
  readonly correctRate: number;
  readonly wrongWordIds: readonly string[];
  readonly version: number;
  readonly updatedAt: string;
}

export type ReadingProgressView = Omit<ReadingProgressRecord, 'organizationId' | 'studentId'>;
export type VocabularyProgressView = Omit<VocabularyProgressRecord, 'organizationId' | 'studentId'>;

export interface LearningProgressOperationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly action: 'saveReadingProgress' | 'saveVocabularyProgress';
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: ReadingProgressView | VocabularyProgressView;
}

export interface LearningProgressAuditRecord {
  readonly id: string;
  readonly requestId: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly actorRole: 'student';
  readonly action: 'reading_progress.saved' | 'vocabulary_progress.saved';
  readonly targetId: string;
  readonly result: 'succeeded' | 'denied';
  readonly reason?: string;
  readonly occurredAt: string;
}
