import { createHash, randomUUID } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { TaskCoreReader } from '../task-core/repository';
import type { TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import type { AssignedTaskMedia, TaskMediaPlaybackPort,
  TaskMediaSessionRecord } from './playback-service';

export const TASK_MEDIA_COLLECTIONS = {
  sessions: 'task_media_sessions', operations: 'task_media_operations',
} as const;

interface SignedPlaybackPort { temporaryUrl(fileId: string): Promise<string> }

/** Read/write adapter for the trusted CloudBase document boundary. */
export class DocumentTaskMediaPlaybackPort implements TaskMediaPlaybackPort {
  public constructor(private readonly tasks: Pick<TaskCoreReader, 'findTask' | 'findAssignment'>,
    private readonly database: DocumentDatabasePort,
    private readonly playback: SignedPlaybackPort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async findAssignedMedia(actor: TrustedActorContext, taskId: string,
    itemId: string): Promise<AssignedTaskMedia | null> {
    if (actor.actorRole !== 'student') return null;
    const [task, assignment] = await Promise.all([
      this.tasks.findTask(actor.organizationId, taskId),
      this.tasks.findAssignment(actor.organizationId, taskId, actor.actorUserId),
    ]);
    if (!task || !assignment || task.organizationId !== actor.organizationId
      || assignment.organizationId !== actor.organizationId
      || assignment.studentId !== actor.actorUserId || task.publication != null
      || task.publishedAt === null || task.status === 'draft' || task.status === 'withdrawn'
      || task.visibility === 'recycled' && assignment.latestSubmissionId === null) return null;
    const item = task.items.find(candidate => candidate.id === itemId);
    const snapshot = item?.mediaSnapshot;
    if (!item || !snapshot || snapshot.kind !== item.resourceSnapshot.type
      || snapshot.continuousPlaybackEnforced !== true
      || typeof snapshot.mediaAssetKey !== 'string' || !snapshot.mediaAssetKey.startsWith('cloud://')
      || snapshot.reviewVersion !== snapshot.mediaVersion) return null;
    return { organizationId: actor.organizationId, studentId: actor.actorUserId,
      assignmentId: assignment.id, round: assignment.latestSubmissionVersion + 1, taskId, itemId,
      writable: writableAt(task, assignment, this.clock.nowIso()), snapshot };
  }

  public async findLatestSession(organizationId: string, studentId: string, taskId: string,
    itemId: string): Promise<TaskMediaSessionRecord | null> {
    const found = await this.database.find(TASK_MEDIA_COLLECTIONS.sessions,
      { organizationId, studentId, taskId, itemId, deletedAt: null });
    const sessions = found.map(projectSession).filter((row): row is TaskMediaSessionRecord => row !== null);
    return sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id))[0] ?? null;
  }

  public async findSession(sessionId: string): Promise<TaskMediaSessionRecord | null> {
    return projectSession(await this.database.get(TASK_MEDIA_COLLECTIONS.sessions, sessionId));
  }

  public createSession(record: TaskMediaSessionRecord,
    operationId: string): Promise<TaskMediaSessionRecord> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('begin', record.organizationId, record.studentId, operationId);
      const prior = await tx.get(TASK_MEDIA_COLLECTIONS.operations, receiptId);
      if (prior) {
        const session = projectSession(await tx.get(TASK_MEDIA_COLLECTIONS.sessions, String(prior.sessionId)));
        if (!session) throw new Error('MEDIA_BEGIN_RECEIPT_INVALID');
        return session;
      }
      const created = await tx.create(TASK_MEDIA_COLLECTIONS.sessions, toDocument(record));
      if (!created) throw new Error('MEDIA_SESSION_CONFLICT');
      if (!await tx.create(TASK_MEDIA_COLLECTIONS.operations, {
        _id: receiptId, organizationId: record.organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, studentId: record.studentId, taskId: record.taskId, itemId: record.itemId,
        sessionId: record.id, operationId, action: 'begin', occurredAt: record.createdAt,
      })) throw new Error('MEDIA_BEGIN_RECEIPT_CONFLICT');
      return record;
    });
  }

  public advanceSession(record: TaskMediaSessionRecord, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<TaskMediaSessionRecord | null> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('heartbeat', record.organizationId, record.studentId,
        `${record.id}:${operationId}`);
      const prior = await tx.get(TASK_MEDIA_COLLECTIONS.operations, receiptId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) return null;
        const current = projectSession(await tx.get(TASK_MEDIA_COLLECTIONS.sessions, record.id));
        return current ? projectReceipt(prior, current) : null;
      }
      const existing = projectSession(await tx.get(TASK_MEDIA_COLLECTIONS.sessions, record.id));
      if (!existing || existing.version !== expectedVersion
        || existing.organizationId !== record.organizationId || existing.studentId !== record.studentId
        || existing.mediaId !== record.mediaId || existing.mediaVersion !== record.mediaVersion
        || existing.round !== record.round
        || record.confirmedThroughMs < existing.confirmedThroughMs) return null;
      if (!await tx.replace(TASK_MEDIA_COLLECTIONS.sessions, record.id, expectedVersion, toDocument(record))) return null;
      if (!await tx.create(TASK_MEDIA_COLLECTIONS.operations, {
        _id: receiptId, organizationId: record.organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, studentId: record.studentId, taskId: record.taskId, itemId: record.itemId,
        sessionId: record.id, operationId, action: 'heartbeat', occurredAt: record.lastHeartbeatAt,
        fingerprint, confirmedThroughMs: record.confirmedThroughMs, sessionVersion: record.version,
      })) throw new Error('MEDIA_HEARTBEAT_RECEIPT_CONFLICT');
      return record;
    });
  }

  public async findHeartbeatReceipt(sessionId: string,
    operationId: string, fingerprint: string): Promise<TaskMediaSessionRecord | 'conflict' | null> {
    const session = await this.findSession(sessionId);
    if (!session) return null;
    const receipt = await this.database.get(TASK_MEDIA_COLLECTIONS.operations,
      operationDocumentId('heartbeat', session.organizationId, session.studentId, `${sessionId}:${operationId}`));
    return receipt ? receipt.fingerprint === fingerprint ? projectReceipt(receipt, session) : 'conflict' : null;
  }

  public async signPlayback(assetKey: string): Promise<Readonly<{ temporaryUrl: string; expiresAt: string }> | null> {
    if (!assetKey.startsWith('cloud://')) return null;
    const temporaryUrl = await this.playback.temporaryUrl(assetKey);
    if (!/^https:\/\//.test(temporaryUrl)) return null;
    return { temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60000).toISOString() };
  }

  public nextSessionId(): string { return `media_session_${randomUUID()}`; }
}

function writableAt(task: TaskRecord, assignment: TaskAssignmentRecord, nowIso: string): boolean {
  if (task.status === 'closed' || task.status === 'completed' || task.visibility === 'recycled'
    || assignment.status === 'awaiting_review' || assignment.status === 'completed') return false;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || now < Date.parse(task.startsAt)) return false;
  if (assignment.status === 'redo_required') return assignment.redoDueAt !== null
    && now <= Date.parse(assignment.redoDueAt);
  const due = Date.parse(task.dueAt);
  return now <= due || task.latePolicy.allowLate && now <= due + task.latePolicy.lateDays * 86400000;
}

function toDocument(row: TaskMediaSessionRecord): VersionedDocument {
  return { _id: row.id, organizationId: row.organizationId, schemaVersion: 1,
    version: row.version, deletedAt: null,
    studentId: row.studentId, assignmentId: row.assignmentId, round: row.round,
    taskId: row.taskId, itemId: row.itemId, mediaId: row.mediaId,
    mediaVersion: row.mediaVersion, confirmedThroughMs: row.confirmedThroughMs,
    createdAt: row.createdAt, lastHeartbeatAt: row.lastHeartbeatAt, expiresAt: row.expiresAt };
}

export function projectTaskMediaSession(document: VersionedDocument | null): TaskMediaSessionRecord | null {
  if (!document || document.deletedAt !== null || typeof document.studentId !== 'string'
    || typeof document.assignmentId !== 'string' || !Number.isSafeInteger(document.round) || Number(document.round) < 1
    || typeof document.taskId !== 'string'
    || typeof document.itemId !== 'string' || typeof document.mediaId !== 'string'
    || !Number.isSafeInteger(document.mediaVersion) || !Number.isSafeInteger(document.confirmedThroughMs)
    || typeof document.createdAt !== 'string' || typeof document.lastHeartbeatAt !== 'string'
    || typeof document.expiresAt !== 'string') return null;
  return { id: document._id, organizationId: document.organizationId,
    studentId: document.studentId, assignmentId: document.assignmentId, round: Number(document.round),
    taskId: document.taskId, itemId: document.itemId, mediaId: document.mediaId,
    mediaVersion: Number(document.mediaVersion), confirmedThroughMs: Number(document.confirmedThroughMs),
    createdAt: document.createdAt, lastHeartbeatAt: document.lastHeartbeatAt,
    expiresAt: document.expiresAt, version: document.version };
}

const projectSession = projectTaskMediaSession;

function projectReceipt(document: VersionedDocument,
  current?: TaskMediaSessionRecord): TaskMediaSessionRecord | null {
  if (!current || !Number.isSafeInteger(document.confirmedThroughMs)
    || !Number.isSafeInteger(document.sessionVersion) || document.sessionId !== current.id) return null;
  return { ...current, confirmedThroughMs: Number(document.confirmedThroughMs),
    version: Number(document.sessionVersion) };
}

function operationDocumentId(action: string, organizationId: string, studentId: string,
  operationId: string): string {
  return `task_media_${createHash('sha256').update(JSON.stringify([
    action, organizationId, studentId, operationId,
  ])).digest('hex').slice(0, 40)}`;
}
