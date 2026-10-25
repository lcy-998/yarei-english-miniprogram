export type PronunciationSourceInput = Readonly<
  | { kind: 'task'; taskId: string; itemId: string; segmentId: string }
  | { kind: 'reading'; resourceId: string; segmentId: string }>;

export interface ResolvedPronunciationSource {
  readonly kind: 'task' | 'reading';
  readonly taskId: string | null;
  readonly itemId: string | null;
  readonly resourceId: string;
  readonly segmentId: string;
  readonly referenceText: string;
  readonly displayTitle?: string;
  readonly sourceVersion: string;
  readonly assignmentId: string | null;
  readonly classId: string | null;
  readonly submissionVersion: number | null;
}

export interface PronunciationScore {
  readonly total: number;
  /** Vosk confidence proxy, not a validated phoneme-level pronunciation grade. */
  readonly pronunciation: number;
  readonly fluency: number;
  readonly completeness: number;
}

export type PronunciationStatus = 'draft' | 'sealed' | 'processing' | 'scored' | 'unreliable' | 'failed';

export interface PronunciationRecording {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly platformSubjectDigest?: string;
  readonly source: ResolvedPronunciationSource;
  readonly referenceSha256: string;
  readonly stagingPath: string;
  readonly fileId: string | null;
  readonly contentSha256: string | null;
  readonly sizeBytes: number | null;
  readonly durationMs: number | null;
  readonly status: PronunciationStatus;
  readonly score: PronunciationScore | null;
  readonly qualityReason: 'NO_SPEECH' | 'LOW_CONFIDENCE' | 'INCOMPLETE' | null;
  readonly failureKind?: 'system' | 'invalidated' | null;
  readonly modelVersion: string | null;
  readonly algorithmVersion: string | null;
  readonly scoreOperationId: string | null;
  readonly effectiveAttemptNumber: number | null;
  /** Present only on the new durable async scoring path; old records omit it. */
  readonly processingStartedAt?: string | null;
  readonly lastDispatchAt?: string | null;
  readonly dispatchRecoveryCount?: number;
  readonly systemRetryCount?: number;
  readonly dispatchState?: 'pending' | 'sent' | 'finished' | null;
  readonly workerLeaseUntil?: string | null;
  readonly workerInvocationCount?: number;
  readonly scoreAuthzVersion?: number;
  readonly version: number;
  readonly createdAt: string;
  readonly sealedAt: string | null;
  readonly scoredAt: string | null;
  readonly mediaDeletedAt?: string | null;
}

export interface PronunciationReceipt {
  readonly organizationId: string;
  readonly actorId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly recordingId: string;
}

export interface RecognizedWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

export interface RecognitionResult {
  readonly modelVersion: string;
  readonly durationMs: number;
  readonly words: readonly RecognizedWord[];
}

export class PronunciationError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
    | 'RESOURCE_OFFLINE' | 'MEDIA_INVALID' | 'TASK_NOT_SUBMITTABLE' | 'SERVICE_UNAVAILABLE',
    public readonly diagnostic: string | null = null) {
    super(code);
    this.name = 'PronunciationError';
  }
}
