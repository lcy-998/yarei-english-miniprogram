export interface PhonicsQuestion {
  readonly id: string;
  readonly stem: string;
  readonly options: readonly Readonly<{ id: string; text: string }>[];
  readonly correctOptionId: string;
  readonly explanation: string;
}

export interface PhonicsCourse {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly grade: string;
  readonly unit: string;
  readonly contentVersion: string;
  readonly status: 'draft' | 'published' | 'offline';
  readonly visibility: Readonly<{ type: 'organization' }> | Readonly<{ type: 'classes'; classIds: readonly string[] }>;
  readonly phonemes: readonly Readonly<{ id: string; label: string; examples: readonly string[];
    audioFileId: string | null }>[];
  readonly questions: readonly PhonicsQuestion[];
}

export interface PhonicsCourseView {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
  readonly unit: string;
  readonly contentVersion: string;
  readonly phonemes: readonly Readonly<{ id: string; label: string; examples: readonly string[];
    audioAvailable: boolean }>[];
  readonly questions: readonly Readonly<{ id: string; stem: string;
    options: readonly Readonly<{ id: string; text: string }>[] }>[];
}

export type PhonicsCourseListItem = Readonly<Pick<PhonicsCourse, 'id' | 'title' | 'grade' | 'unit' | 'contentVersion'>>
  & Readonly<{ phonemeCount: number; questionCount: number }>;

export interface PhonicsAnswerRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly contentVersion: string;
  readonly round: number;
  readonly questionId: string;
  readonly selectedOptionId: string;
  readonly isCorrect: boolean;
  readonly firstAttempt: boolean;
  readonly attemptNumber: number;
  readonly attemptedAt: string;
}

export interface PhonicsAnswerView {
  readonly round: number;
  readonly questionId: string;
  readonly selectedOptionId: string;
  readonly correctOptionId: string;
  readonly explanation: string;
  readonly isCorrect: boolean;
  readonly firstAttempt: boolean;
  readonly attemptNumber: number;
  readonly attemptedAt: string;
}

export interface PhonicsQuestionState {
  readonly questionId: string;
  readonly firstCorrect: boolean | null;
  readonly lastCorrect: boolean | null;
  readonly version: number;
}

export interface PhonicsCourseState {
  readonly courseId: string;
  readonly contentVersion: string;
  readonly currentRound: number;
  readonly completedCount: number;
  readonly firstCorrectCount: number;
  readonly score: number | null;
  readonly history: readonly Readonly<{ round: number; score: number; completedAt: string }>[];
  readonly wrongQuestionIds: readonly string[];
  readonly questions: readonly PhonicsQuestionState[];
}

export interface PhonicsReceipt {
  readonly organizationId: string;
  readonly studentId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: PhonicsAnswerRecord;
}

export type PhonicsErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RESOURCE_OFFLINE' | 'SERVICE_UNAVAILABLE';

export class PhonicsError extends Error {
  public constructor(public readonly code: PhonicsErrorCode) { super(code); this.name = 'PhonicsError'; }
}
