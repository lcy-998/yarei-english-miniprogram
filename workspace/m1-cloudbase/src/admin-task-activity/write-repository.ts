import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { ManagedError, type ManagedKind, type StopManagedResult } from './types';

const COLLECTIONS: Record<ManagedKind, string> = { classroom: 'tasks', activity: 'checkin_activities', template: 'task_templates' };
const RECEIPTS = 'admin_task_activity_operations';
const AUDITS = 'operation_logs';
function json(value: object): Record<string, JsonValue> { return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>; }
function record(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
function receiptId(organizationId: string, actorId: string, operationId: string): string {
  return `admin_task_activity_${hashHex(JSON.stringify([organizationId, actorId, operationId]))}`;
}

export class AdminTaskActivityWriteRepository {
  public constructor(private readonly documents: DocumentDatabasePort) {}

  public async stop(input: Readonly<{ organizationId: string; actorId: string; kind: ManagedKind;
    id: string; expectedVersion: number; operationId: string; reason: string;
    now: string; requestId: string }>): Promise<StopManagedResult> {
    const hash = hashHex(JSON.stringify([input.kind, input.id, input.expectedVersion, input.reason]));
    return this.documents.runTransaction(async (transaction) => {
      const receiptKey = receiptId(input.organizationId, input.actorId, input.operationId);
      const prior = await transaction.get(RECEIPTS, receiptKey);
      if (prior !== null) {
        if (prior.organizationId !== input.organizationId || prior.actorId !== input.actorId || prior.hash !== hash
          || typeof prior.status !== 'string' || !Number.isSafeInteger(prior.resultVersion)) throw new ManagedError('CONFLICT');
        return { id: input.id, kind: input.kind, status: prior.status, version: Number(prior.resultVersion) };
      }
      const collection = COLLECTIONS[input.kind];
      const current = await transaction.get(collection, input.id);
      if (current === null || current.organizationId !== input.organizationId || current.deletedAt !== null) {
        throw new ManagedError('NOT_FOUND');
      }
      if (current.version !== input.expectedVersion) throw new ManagedError('CONFLICT');
      const status = nextStatus(input.kind, current.status);
      const activityPayload = input.kind === 'activity' ? current.payload : undefined;
      if (input.kind === 'activity' && (!record(activityPayload)
        || activityPayload.id !== input.id || activityPayload.organizationId !== input.organizationId
        || activityPayload.status !== current.status || activityPayload.version !== current.version)) {
        throw new ManagedError('SERVICE_UNAVAILABLE');
      }
      const next: VersionedDocument = { ...current, version: current.version + 1, status,
        ...(input.kind === 'classroom' && status === 'withdrawn'
          ? { withdrawnAt: input.now, withdrawnBy: input.actorId, withdrawReason: input.reason } : {}),
        ...(input.kind === 'activity' ? { closedAt: input.now, updatedAt: input.now,
          payload: { ...activityPayload as Record<string, JsonValue>, status, version: current.version + 1,
            closedAt: input.now, updatedAt: input.now } } : {}),
        ...(input.kind === 'template' ? { updatedAt: input.now } : {}) };
      if (!(await transaction.replace(collection, input.id, current.version, next))) throw new ManagedError('CONFLICT');
      const result: StopManagedResult = { id: input.id, kind: input.kind, status, version: next.version };
      const receipt: VersionedDocument = { _id: receiptKey, organizationId: input.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, actorId: input.actorId, hash,
        status, resultVersion: next.version };
      if (!(await transaction.create(RECEIPTS, receipt))) throw new ManagedError('CONFLICT');
      const auditId = `audit_${hashHex(JSON.stringify([input.organizationId, input.actorId, input.operationId]))}`;
      const audit: VersionedDocument = { _id: auditId, organizationId: input.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, ...json({ id: auditId, requestId: input.requestId,
          actorUserId: input.actorId, actorRole: 'admin', action: `admin.${input.kind}.stop`,
          targetType: input.kind, targetId: input.id, result: 'succeeded', errorCode: null,
          occurredAt: input.now, metadata: { reason: input.reason, previousStatus: current.status,
            previousVersion: current.version, nextVersion: next.version } }) };
      if (!(await transaction.append(AUDITS, audit))) throw new ManagedError('CONFLICT');
      return result;
    });
  }
}

function nextStatus(kind: ManagedKind, raw: JsonValue): string {
  if (typeof raw !== 'string') throw new ManagedError('SERVICE_UNAVAILABLE');
  if (kind === 'classroom') {
    if (raw === 'scheduled') return 'withdrawn';
    if (raw === 'draft' || raw === 'active' || raw === 'expired') return 'closed';
  } else if (kind === 'activity') {
    if (raw === 'draft' || raw === 'published') return 'closed';
  } else if (raw === 'active') return 'deleted';
  throw new ManagedError('CONFLICT');
}
