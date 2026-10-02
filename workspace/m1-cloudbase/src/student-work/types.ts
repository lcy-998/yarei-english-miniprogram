export interface WorkMaterial {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly contentVersion: string;
  readonly status: 'published' | 'draft' | 'offline';
  readonly visibility: Readonly<{ type: 'organization' }> | Readonly<{ type: 'classes'; classIds: readonly string[] }>;
  readonly demonstrationFileId: string;
  readonly subtitle: string;
  readonly grade?: string;
  readonly textbook?: string;
  readonly unit?: string;
}

export type WorkMaterialView = Readonly<Pick<WorkMaterial, 'id' | 'title' | 'contentVersion' | 'subtitle'
  | 'grade' | 'textbook' | 'unit'>>;
export type WorkMaterialFilters = Readonly<{ grade?: string; textbook?: string; unit?: string }>;
export type WorkMaterialFacet = WorkMaterialFilters;
export type WorkMaterialPage = Readonly<{ items: readonly WorkMaterialView[]; total: number; nextOffset: number | null }>;

export interface StudentWork {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly materialId: string;
  readonly materialVersion: string;
  readonly stagingPath: string;
  readonly status: 'draft' | 'submitted';
  readonly fileId: string | null;
  readonly contentSha256: string | null;
  readonly sizeBytes: number | null;
  readonly durationMs: number | null;
  readonly note: string;
  readonly version: number;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  /** Soft-deleted drafts remain in storage for a seven-day recovery review. */
  readonly deletedAt?: string | null;
  readonly recoverableUntil?: string | null;
  readonly deletedByUserId?: string | null;
  /** Queryable marker for administrator recovery lists; absent on legacy active works. */
  readonly recoveryState?: 'deleted' | 'active';
  /** Original audio was removed after its retention period; the work receipt remains. */
  readonly mediaDeletedAt?: string | null;
  /** Derived at read time; playback ends at 180 days even if cleanup is delayed. */
  readonly mediaExpired?: boolean;
}

export interface WorkReceipt {
  readonly organizationId: string;
  readonly studentId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: StudentWork;
  readonly action?: 'deleteDraft';
  readonly occurredAt?: string;
}

export interface SealedRecording {
  readonly fileId: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly codec: 'mp3' | 'aac';
}

export type StudentWorkErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RESOURCE_OFFLINE' | 'MEDIA_INVALID' | 'SERVICE_UNAVAILABLE';

export class StudentWorkError extends Error {
  public constructor(public readonly code: StudentWorkErrorCode) { super(code); this.name = 'StudentWorkError'; }
}
