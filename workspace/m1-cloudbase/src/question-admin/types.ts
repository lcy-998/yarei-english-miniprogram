import type { JsonValue } from '../shared/protocol';

export type QuestionStatus = 'draft' | 'published' | 'offline';
export type QuestionVisibility = Readonly<{ type: 'organization' }> | Readonly<{ type: 'classes'; classIds: readonly string[] }>;
export type QuestionType = 'single_choice' | 'multiple_choice' | 'fill' | 'subjective';

export interface QuestionAdminSummary {
  readonly id: string;
  readonly title: string;
  readonly stemSummary: string;
  readonly grade: string;
  readonly unit: string | null;
  readonly difficulty: string | null;
  readonly knowledgePoint: string | null;
  readonly questionType: QuestionType;
  readonly status: QuestionStatus;
  readonly visibility: QuestionVisibility;
  readonly updatedAt: string | null;
  readonly version: number;
}
export interface QuestionAdminDetail extends QuestionAdminSummary {
  readonly stem: string;
  readonly options: readonly string[];
  readonly correctAnswer: JsonValue;
  readonly explanation: string;
}
export interface QuestionAdminPage {
  readonly items: readonly QuestionAdminSummary[];
  readonly total: number;
  readonly nextOffset: number | null;
}
export interface QuestionAdminFilters {
  readonly keyword?: string;
  readonly status?: QuestionStatus;
  readonly questionType?: QuestionType;
  readonly classId?: string;
}
export interface QuestionBatchItem { readonly id: string; readonly expectedVersion: number }

export class QuestionAdminError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'SERVICE_UNAVAILABLE') {
    super(code); this.name = 'QuestionAdminError';
  }
}
