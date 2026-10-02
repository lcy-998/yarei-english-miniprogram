import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';

export const TASK_RECORDING_QUERY_ACTIONS = ['listRound', 'getPlayback', 'getMediaState', 'listPrompts', 'getPrompt'] as const;
export const TASK_RECORDING_COMMAND_ACTIONS = ['begin', 'submit'] as const;
export type TaskRecordingQueryAction = (typeof TASK_RECORDING_QUERY_ACTIONS)[number];
export type TaskRecordingCommandAction = (typeof TASK_RECORDING_COMMAND_ACTIONS)[number];
export type TaskRecordingQueryInput = Readonly<{ action: 'listRound'; taskId: string; itemId: string }>
  | Readonly<{ action: 'getPlayback'; recordingId: string }>
  | Readonly<{ action: 'getMediaState'; recordingId: string }>
  | Readonly<{ action: 'listPrompts'; targetClassIds?: readonly string[]; keyword?: string;
    page: Readonly<{ limit: number; offset: number }> }>
  | Readonly<{ action: 'getPrompt'; promptId: string; targetClassIds?: readonly string[] }>;
export type TaskRecordingCommandInput = Readonly<{ action: 'begin'; taskId: string; itemId: string; operationId: string }>
  | Readonly<{ action: 'submit'; recordingId: string; stagingFileId: string;
    expectedVersion: number; operationId: string }>;
type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
const bad = <T>(field: string): Validation<T> => ({ ok: false, fieldErrors: { [field]: '录音参数无效。' } });
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 256;
export function validateTaskRecordingQueryRequest(request: FunctionRequest<TaskRecordingQueryAction, JsonObject>):
  Validation<TaskRecordingQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) return bad('operationId');
  if (request.action === 'listRound') {
    const parsed = parseExactObject(request.payload, ['taskId', 'itemId']);
    return parsed.ok && id(parsed.value.taskId) && id(parsed.value.itemId)
      ? { ok: true, value: { action: 'listRound', taskId: parsed.value.taskId, itemId: parsed.value.itemId } }
      : bad('taskId');
  }
  if (request.action === 'listPrompts') {
    const parsed = parseExactObject(request.payload, ['page'], ['targetClassIds', 'keyword']);
    if (!parsed.ok || (parsed.value.targetClassIds !== undefined
      && (!Array.isArray(parsed.value.targetClassIds) || !parsed.value.targetClassIds.every(id)))
      || (parsed.value.keyword !== undefined
        && (typeof parsed.value.keyword !== 'string' || parsed.value.keyword.length > 100))) return bad('targetClassIds');
    const page = parseExactObject(parsed.value.page, ['limit', 'offset']);
    if (!page.ok || !Number.isSafeInteger(page.value.limit) || !Number.isSafeInteger(page.value.offset)) return bad('page');
    return { ok: true, value: { action: 'listPrompts',
      ...(parsed.value.targetClassIds === undefined ? {} : { targetClassIds: parsed.value.targetClassIds as string[] }),
      ...(typeof parsed.value.keyword === 'string' ? { keyword: parsed.value.keyword } : {}),
      page: { limit: Number(page.value.limit), offset: Number(page.value.offset) } } };
  }
  if (request.action === 'getPrompt') {
    const parsed = parseExactObject(request.payload, ['promptId'], ['targetClassIds']);
    return parsed.ok && id(parsed.value.promptId) && (parsed.value.targetClassIds === undefined
      || (Array.isArray(parsed.value.targetClassIds) && parsed.value.targetClassIds.every(id)))
      ? { ok: true, value: { action: 'getPrompt', promptId: parsed.value.promptId,
        ...(parsed.value.targetClassIds === undefined ? {} : { targetClassIds: parsed.value.targetClassIds as string[] }) } } : bad('promptId');
  }
  const parsed = parseExactObject(request.payload, ['recordingId']);
  return parsed.ok && id(parsed.value.recordingId)
    ? { ok: true, value: { action: request.action === 'getMediaState' ? 'getMediaState' : 'getPlayback',
      recordingId: parsed.value.recordingId } }
    : bad('recordingId');
}
export function validateTaskRecordingCommandRequest(request: FunctionRequest<TaskRecordingCommandAction, JsonObject>):
  Validation<TaskRecordingCommandInput> {
  if (!id(request.operationId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(request.operationId)) return bad('operationId');
  if (request.action === 'begin') {
    if (request.expectedVersion !== undefined) return bad('expectedVersion');
    const parsed = parseExactObject(request.payload, ['taskId', 'itemId']);
    return parsed.ok && id(parsed.value.taskId) && id(parsed.value.itemId)
      ? { ok: true, value: { action: 'begin', taskId: parsed.value.taskId,
        itemId: parsed.value.itemId, operationId: request.operationId } } : bad('taskId');
  }
  if (!Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 1) return bad('expectedVersion');
  const parsed = parseExactObject(request.payload, ['recordingId', 'stagingFileId']);
  return parsed.ok && id(parsed.value.recordingId) && id(parsed.value.stagingFileId)
    ? { ok: true, value: { action: 'submit', recordingId: parsed.value.recordingId,
      stagingFileId: parsed.value.stagingFileId, expectedVersion: Number(request.expectedVersion),
      operationId: request.operationId } } : bad('recordingId');
}
