import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { PronunciationSourceInput } from '../pronunciation/types';

export const PRONUNCIATION_COMMAND_ACTIONS = ['beginRecording', 'sealRecording', 'beginScore'] as const;
export const PRONUNCIATION_QUERY_ACTIONS = ['getScore', 'listAttempts', 'listMyWorks', 'getMyPlayback', 'getTeacherEvidence', 'getParentEvidence', 'listParentEvidence'] as const;
export type PronunciationCommandAction = (typeof PRONUNCIATION_COMMAND_ACTIONS)[number];
export type PronunciationQueryAction = (typeof PRONUNCIATION_QUERY_ACTIONS)[number];

export type PronunciationCommandInput = Readonly<{ action: 'beginRecording'; source: PronunciationSourceInput;
  operationId: string }> | Readonly<{ action: 'sealRecording'; recordingId: string; stagingFileId: string;
  expectedVersion: number; operationId: string }> | Readonly<{ action: 'beginScore'; recordingId: string;
  expectedVersion: number; operationId: string }>;
export type PronunciationQueryInput = Readonly<{ action: 'getScore'; scoreId: string }>
  | Readonly<{ action: 'listAttempts'; source: PronunciationSourceInput }>
  | Readonly<{ action: 'listMyWorks'; cursor: string | null; limit: number }>
  | Readonly<{ action: 'getMyPlayback'; recordingId: string }>
  | Readonly<{ action: 'getTeacherEvidence'; taskId: string; assignmentId: string;
    submissionVersion: number; itemId: string; segmentId: string }>
  | Readonly<{ action: 'getParentEvidence'; studentId: string; taskId: string; assignmentId: string;
    submissionVersion: number; itemId: string; segmentId: string }>
  | Readonly<{ action: 'listParentEvidence'; studentId: string; taskId: string; assignmentId: string;
    submissionVersion: number; itemId: string }>;

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
const bad = <T>(field: string): Validation<T> => ({ ok: false, fieldErrors: { [field]: '跟读参数无效。' } });
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const operation = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);

function source(value: unknown): Validation<PronunciationSourceInput> {
  const kind = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).kind : null;
  if (kind === 'task') {
    const parsed = parseExactObject(value, ['kind', 'taskId', 'itemId', 'segmentId']);
    return parsed.ok && id(parsed.value.taskId) && id(parsed.value.itemId) && id(parsed.value.segmentId)
      ? { ok: true, value: { kind: 'task', taskId: parsed.value.taskId,
        itemId: parsed.value.itemId, segmentId: parsed.value.segmentId } } : bad('source');
  }
  if (kind === 'reading') {
    const parsed = parseExactObject(value, ['kind', 'resourceId', 'segmentId']);
    return parsed.ok && id(parsed.value.resourceId) && id(parsed.value.segmentId)
      ? { ok: true, value: { kind: 'reading', resourceId: parsed.value.resourceId,
        segmentId: parsed.value.segmentId } } : bad('source');
  }
  return bad('source');
}

export function validatePronunciationCommandRequest(request: FunctionRequest<PronunciationCommandAction, JsonObject>):
  Validation<PronunciationCommandInput> {
  if (!operation(request.operationId)) return bad('operationId');
  if (request.action === 'beginRecording') {
    if (request.expectedVersion !== undefined) return bad('expectedVersion');
    const parsed = parseExactObject(request.payload, ['source']);
    const value = parsed.ok ? source(parsed.value.source) : bad<PronunciationSourceInput>('source');
    return value.ok ? { ok: true, value: { action: 'beginRecording', source: value.value,
      operationId: request.operationId } } : bad('source');
  }
  if (!Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 1) {
    return bad('expectedVersion');
  }
  if (request.action === 'sealRecording') {
    const parsed = parseExactObject(request.payload, ['recordingId', 'stagingFileId']);
    return parsed.ok && id(parsed.value.recordingId) && typeof parsed.value.stagingFileId === 'string'
      && parsed.value.stagingFileId.startsWith('cloud://') && parsed.value.stagingFileId.length <= 1024
      ? { ok: true, value: { action: 'sealRecording', recordingId: parsed.value.recordingId,
        stagingFileId: parsed.value.stagingFileId, expectedVersion: Number(request.expectedVersion),
        operationId: request.operationId } } : bad('recordingId');
  }
  const parsed = parseExactObject(request.payload, ['recordingId']);
  return parsed.ok && id(parsed.value.recordingId)
    ? { ok: true, value: { action: 'beginScore', recordingId: parsed.value.recordingId,
      expectedVersion: Number(request.expectedVersion), operationId: request.operationId } }
    : bad('recordingId');
}

export function validatePronunciationQueryRequest(request: FunctionRequest<PronunciationQueryAction, JsonObject>):
  Validation<PronunciationQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) return bad('operationId');
  if (request.action === 'getScore') {
    const parsed = parseExactObject(request.payload, ['scoreId']);
    return parsed.ok && id(parsed.value.scoreId)
      ? { ok: true, value: { action: 'getScore', scoreId: parsed.value.scoreId } } : bad('scoreId');
  }
  if (request.action === 'listAttempts') {
    const parsed = parseExactObject(request.payload, ['source']);
    const value = parsed.ok ? source(parsed.value.source) : bad<PronunciationSourceInput>('source');
    return value.ok ? { ok: true, value: { action: 'listAttempts', source: value.value } } : bad('source');
  }
  if (request.action === 'listMyWorks') {
    const parsed = parseExactObject(request.payload, ['cursor', 'limit']);
    return parsed.ok && (parsed.value.cursor === null
      || typeof parsed.value.cursor === 'string' && /^\d{1,6}$/.test(parsed.value.cursor))
      && Number.isSafeInteger(parsed.value.limit) && Number(parsed.value.limit) >= 1
      && Number(parsed.value.limit) <= 30
      ? { ok: true, value: { action: 'listMyWorks', cursor: parsed.value.cursor as string | null,
        limit: Number(parsed.value.limit) } } : bad('cursor');
  }
  if (request.action === 'getMyPlayback') {
    const parsed = parseExactObject(request.payload, ['recordingId']);
    return parsed.ok && id(parsed.value.recordingId)
      ? { ok: true, value: { action: 'getMyPlayback', recordingId: parsed.value.recordingId } }
      : bad('recordingId');
  }
  if (request.action === 'getParentEvidence') {
    const parsed = parseExactObject(request.payload,
      ['studentId', 'taskId', 'assignmentId', 'submissionVersion', 'itemId', 'segmentId']);
    return parsed.ok && id(parsed.value.studentId) && id(parsed.value.taskId)
      && id(parsed.value.assignmentId) && Number.isSafeInteger(parsed.value.submissionVersion)
      && Number(parsed.value.submissionVersion) > 0 && id(parsed.value.itemId) && id(parsed.value.segmentId)
      ? { ok: true, value: { action: 'getParentEvidence', studentId: parsed.value.studentId,
        taskId: parsed.value.taskId, assignmentId: parsed.value.assignmentId,
        submissionVersion: Number(parsed.value.submissionVersion), itemId: parsed.value.itemId,
        segmentId: parsed.value.segmentId } } : bad('studentId');
  }
  if (request.action === 'listParentEvidence') {
    const parsed = parseExactObject(request.payload,
      ['studentId', 'taskId', 'assignmentId', 'submissionVersion', 'itemId']);
    return parsed.ok && id(parsed.value.studentId) && id(parsed.value.taskId)
      && id(parsed.value.assignmentId) && Number.isSafeInteger(parsed.value.submissionVersion)
      && Number(parsed.value.submissionVersion) > 0 && id(parsed.value.itemId)
      ? { ok: true, value: { action: 'listParentEvidence', studentId: parsed.value.studentId,
        taskId: parsed.value.taskId, assignmentId: parsed.value.assignmentId,
        submissionVersion: Number(parsed.value.submissionVersion), itemId: parsed.value.itemId } }
      : bad('studentId');
  }
  const parsed = parseExactObject(request.payload,
    ['taskId', 'assignmentId', 'submissionVersion', 'itemId', 'segmentId']);
  return parsed.ok && id(parsed.value.taskId) && id(parsed.value.assignmentId)
    && Number.isSafeInteger(parsed.value.submissionVersion) && Number(parsed.value.submissionVersion) > 0
    && id(parsed.value.itemId) && id(parsed.value.segmentId)
    ? { ok: true, value: { action: 'getTeacherEvidence', taskId: parsed.value.taskId,
      assignmentId: parsed.value.assignmentId, submissionVersion: Number(parsed.value.submissionVersion),
      itemId: parsed.value.itemId, segmentId: parsed.value.segmentId } } : bad('taskId');
}
