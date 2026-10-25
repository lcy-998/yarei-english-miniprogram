export interface TeacherSuggestionFact {
  readonly id: string;
  readonly text: string;
}

export interface TeacherSuggestionInferenceInput {
  readonly operationId: string;
  readonly facts: readonly TeacherSuggestionFact[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

export type TeacherSuggestionInferenceOutput = Readonly<{
  text: string;
  citedFactIds: readonly string[];
}>;

export interface TeacherSuggestionInferencePort {
  generate(input: TeacherSuggestionInferenceInput): Promise<TeacherSuggestionInferenceOutput>;
}

export interface TeacherSuggestionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly teacherId: string;
  readonly taskId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly assignmentVersion: number;
  readonly operationId: string;
  readonly evidenceDigest: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly text: string | null;
  readonly citedFactIds: readonly string[];
  readonly status: 'processing' | 'trial' | 'failed';
  readonly generationNumber: number;
  readonly failureReason?: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export type TeacherSuggestionReservation = Readonly<
  | { kind: 'reserved'; record: TeacherSuggestionRecord }
  | { kind: 'existing'; record: TeacherSuggestionRecord }
  | { kind: 'limit' }
>;

export interface TeacherSuggestionStore {
  find(organizationId: string, teacherId: string, operationId: string): Promise<TeacherSuggestionRecord | null>;
  /** Must atomically reserve the operation and cap one submission at four generations. */
  reserve(record: Omit<TeacherSuggestionRecord, 'generationNumber' | 'version'>): Promise<TeacherSuggestionReservation>;
  complete(recordId: string, expectedVersion: number, text: string,
    citedFactIds: readonly string[], completedAt: string): Promise<TeacherSuggestionRecord | null>;
  fail(recordId: string, expectedVersion: number, failureReason: string): Promise<boolean>;
  findById(organizationId: string, teacherId: string, suggestionId: string): Promise<TeacherSuggestionRecord | null>;
  appendAudit(entry: Readonly<{
    organizationId: string;
    teacherId: string;
    submissionId: string;
    operationId: string;
    outcome: 'generated' | 'replayed' | 'rejected';
    reason: string;
    occurredAt: string;
  }>): Promise<void>;
}

export interface TeacherSuggestionView {
  readonly id: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly text: string;
  readonly generationNumber: number;
  readonly remainingRegenerations: number;
  readonly status: 'trial';
  readonly requiresTeacherConfirmation: true;
}
