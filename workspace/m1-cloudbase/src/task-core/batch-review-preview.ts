import { isRecord } from '../shared/protocol';
import type { AssignmentStatus } from './types';

export interface BatchReviewPreviewCodec {
  encode(payload: string): string;
  decode(token: string): string | null;
}

export interface BatchReviewEligibleSubmission {
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly submissionRecordVersion: number;
  readonly assignmentId: string;
  readonly assignmentVersion: number;
  readonly classId: string;
}

export interface BatchReviewPreviewIntent {
  readonly schemaVersion: 1;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: number;
  readonly actor: Readonly<{
    organizationId: string;
    actorUserId: string;
    actorRole: 'teacher';
    authzVersion: number;
  }>;
  readonly task: Readonly<{ id: string; version: number }>;
  readonly authorizedClassIds: readonly string[];
  readonly filter: Readonly<{ classId?: string; status?: AssignmentStatus }>;
  readonly selection: Readonly<{ mode: 'eligible' | 'ids'; submissionIds: readonly string[] }>;
  readonly eligible: readonly BatchReviewEligibleSubmission[];
  readonly comment: string;
}

const PREFIX = 'batch-preview|';

export function serializeBatchReviewPreviewIntent(intent: BatchReviewPreviewIntent): string {
  return `${PREFIX}${JSON.stringify(intent)}`;
}

export function parseBatchReviewPreviewIntent(payload: string): BatchReviewPreviewIntent | null {
  if (!payload.startsWith(PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (!hasExactKeys(parsed, [
    'schemaVersion', 'issuedAt', 'expiresAt', 'previewVersion', 'actor', 'task',
    'authorizedClassIds', 'filter', 'selection', 'eligible', 'comment',
  ])) return null;
  if (parsed.schemaVersion !== 1
    || !isIso(parsed.issuedAt)
    || !isIso(parsed.expiresAt)
    || !isPositiveInteger(parsed.previewVersion)
    || typeof parsed.comment !== 'string') return null;

  if (!hasExactKeys(parsed.actor, ['organizationId', 'actorUserId', 'actorRole', 'authzVersion'])
    || !isId(parsed.actor.organizationId)
    || !isId(parsed.actor.actorUserId)
    || parsed.actor.actorRole !== 'teacher'
    || !isNonNegativeInteger(parsed.actor.authzVersion)) return null;
  if (!hasExactKeys(parsed.task, ['id', 'version'])
    || !isId(parsed.task.id)
    || !isPositiveInteger(parsed.task.version)) return null;

  const authorizedClassIds = parseIdArray(parsed.authorizedClassIds, true);
  if (authorizedClassIds === null) return null;
  if (!hasOnlyKeys(parsed.filter, ['classId', 'status'])) return null;
  const classId = parsed.filter.classId;
  if (classId !== undefined && !isId(classId)) return null;
  const status = parsed.filter.status;
  if (status !== undefined && !isAssignmentStatus(status)) return null;

  if (!hasOnlyKeys(parsed.selection, ['mode', 'submissionIds'])
    || (parsed.selection.mode !== 'eligible' && parsed.selection.mode !== 'ids')) return null;
  const selectedIds = parseIdArray(parsed.selection.submissionIds, true);
  if (selectedIds === null) return null;
  if (parsed.selection.mode === 'eligible' && selectedIds.length > 0) return null;
  if (parsed.selection.mode === 'ids' && selectedIds.length === 0) return null;

  if (!Array.isArray(parsed.eligible)) return null;
  const eligible: BatchReviewEligibleSubmission[] = [];
  for (const item of parsed.eligible) {
    if (!hasExactKeys(item, [
      'submissionId', 'submissionVersion', 'submissionRecordVersion',
      'assignmentId', 'assignmentVersion', 'classId',
    ])
      || !isId(item.submissionId)
      || !isPositiveInteger(item.submissionVersion)
      || !isPositiveInteger(item.submissionRecordVersion)
      || !isId(item.assignmentId)
      || !isPositiveInteger(item.assignmentVersion)
      || !isId(item.classId)) return null;
    eligible.push({
      submissionId: item.submissionId,
      submissionVersion: item.submissionVersion,
      submissionRecordVersion: item.submissionRecordVersion,
      assignmentId: item.assignmentId,
      assignmentVersion: item.assignmentVersion,
      classId: item.classId,
    });
  }
  if (new Set(eligible.map((item) => item.submissionId)).size !== eligible.length) return null;

  return {
    schemaVersion: 1,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
    previewVersion: parsed.previewVersion,
    actor: {
      organizationId: parsed.actor.organizationId,
      actorUserId: parsed.actor.actorUserId,
      actorRole: 'teacher',
      authzVersion: parsed.actor.authzVersion,
    },
    task: { id: parsed.task.id, version: parsed.task.version },
    authorizedClassIds,
    filter: {
      ...(classId === undefined ? {} : { classId }),
      ...(status === undefined ? {} : { status }),
    },
    selection: { mode: parsed.selection.mode, submissionIds: selectedIds },
    eligible,
    comment: parsed.comment,
  };
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return hasOnlyKeys(value, keys) && Object.keys(value).length === keys.length;
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function parseIdArray(value: unknown, allowEmpty: boolean): readonly string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100) return null;
  const result: string[] = [];
  for (const item of value) {
    if (!isId(item) || result.includes(item)) return null;
    result.push(item);
  }
  return result;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return value === 'not_started'
    || value === 'in_progress'
    || value === 'awaiting_review'
    || value === 'completed'
    || value === 'redo_required'
    || value === 'overdue';
}
