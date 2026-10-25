import type { DocumentDatabaseReaderPort } from '../repositories/document-database-port';
import type { SealedTaskDubbingWork, TaskMediaSubmissionPort } from './submission-evidence';

export const TASK_DUBBING_WORKS_COLLECTION = 'task_dubbing_works';

/** Only task-bound sealed works in this collection may satisfy a classroom dubbing submission. */
export class DocumentTaskDubbingWorkPort implements TaskMediaSubmissionPort {
  public constructor(private readonly database: DocumentDatabaseReaderPort) {}

  public async findTaskDubbingWork(workId: string): Promise<SealedTaskDubbingWork | null> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(workId)) return null;
    const row = await this.database.get(TASK_DUBBING_WORKS_COLLECTION, workId);
    if (!row || row.deletedAt !== null || typeof row.studentId !== 'string'
      || typeof row.assignmentId !== 'string' || !Number.isSafeInteger(row.round)
      || typeof row.taskId !== 'string' || typeof row.itemId !== 'string'
      || typeof row.mediaId !== 'string' || !Number.isSafeInteger(row.mediaVersion)
      || row.status !== 'submitted' || typeof row.fileId !== 'string'
      || !row.fileId.startsWith('cloud://')
      || typeof row.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(row.contentSha256)
      || (row.mediaDeletedAt !== undefined && row.mediaDeletedAt !== null
        && (typeof row.mediaDeletedAt !== 'string'
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.mediaDeletedAt)
          || !Number.isFinite(Date.parse(row.mediaDeletedAt))))
      || typeof row.recording !== 'object'
      || row.recording === null || Array.isArray(row.recording)) return null;
    const recording = row.recording as Record<string, unknown>;
    if (typeof recording.mediaId !== 'string' || !Number.isSafeInteger(recording.durationMs)
      || !Number.isSafeInteger(recording.sizeBytes) || recording.serverReadable !== true) return null;
    return { id: row._id, organizationId: row.organizationId,
      studentId: row.studentId, assignmentId: row.assignmentId, round: Number(row.round),
      taskId: row.taskId, itemId: row.itemId,
      mediaId: row.mediaId, mediaVersion: Number(row.mediaVersion), status: 'submitted',
      fileId: row.fileId, contentSha256: row.contentSha256,
      mediaDeletedAt: typeof row.mediaDeletedAt === 'string' ? row.mediaDeletedAt : null,
      recording: { mediaId: recording.mediaId, durationMs: Number(recording.durationMs),
        sizeBytes: Number(recording.sizeBytes), serverReadable: true } };
  }
}
