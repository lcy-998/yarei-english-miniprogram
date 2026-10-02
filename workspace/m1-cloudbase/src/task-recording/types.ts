export interface TaskRecordingRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly itemId: string;
  readonly assignmentId: string;
  readonly submissionVersion: number;
  readonly studentId: string;
  readonly classId: string;
  readonly resourceVersion: number;
  readonly stagingPath: string;
  readonly status: 'draft' | 'submitted';
  readonly fileId: string | null;
  readonly contentSha256: string | null;
  readonly sizeBytes: number | null;
  readonly durationMs: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  /** Original audio was removed after its retention period; submission evidence remains. */
  readonly mediaDeletedAt?: string | null;
  readonly mediaExpired?: boolean;
}
export interface TaskRecordingReceipt {
  readonly organizationId: string;
  readonly actorId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: TaskRecordingRecord;
}
export class TaskRecordingError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
    | 'MEDIA_INVALID' | 'TASK_NOT_SUBMITTABLE' | 'SERVICE_UNAVAILABLE') {
    super(code); this.name = 'TaskRecordingError';
  }
}
