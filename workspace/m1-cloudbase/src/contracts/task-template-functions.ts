import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import { parseItemRefs } from './task-core-functions';
import type { TemplateInput } from '../task-template/service';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
export const TASK_TEMPLATE_QUERY_ACTIONS = ['listTemplates', 'getTemplate'] as const;
export const TASK_TEMPLATE_COMMAND_ACTIONS = ['saveTemplate', 'renameTemplate', 'copyTemplate', 'removeTemplate', 'useTemplate'] as const;
export type TaskTemplateQueryAction = (typeof TASK_TEMPLATE_QUERY_ACTIONS)[number];
export type TaskTemplateCommandAction = (typeof TASK_TEMPLATE_COMMAND_ACTIONS)[number];
export type TaskTemplateQueryInput = Readonly<{ action: 'listTemplates' }> | Readonly<{ action: 'getTemplate'; templateId: string }>;
export type TaskTemplateCommandInput = Readonly<{ action: 'saveTemplate'; input: TemplateInput;
  expectedVersion: number; operationId: string }> | Readonly<{ action: 'renameTemplate' | 'copyTemplate';
  templateId: string; title: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'removeTemplate' | 'useTemplate'; templateId: string;
    expectedVersion: number; operationId: string }>;
function invalid<T>(field: string, message: string): Validation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}
function id(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 128; }

export function validateTaskTemplateQueryRequest(request: FunctionRequest<TaskTemplateQueryAction, JsonObject>):
  Validation<TaskTemplateQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) {
    return invalid('operationId', '查询不接受写操作字段。');
  }
  const exact = request.action === 'listTemplates'
    ? parseExactObject(request.payload, []) : parseExactObject(request.payload, ['templateId']);
  if (!exact.ok) return exact;
  return request.action === 'listTemplates' ? { ok: true, value: { action: 'listTemplates' } }
    : id(exact.value.templateId) ? { ok: true, value: { action: 'getTemplate', templateId: exact.value.templateId } }
      : invalid('templateId', '模板标识无效。');
}

export function validateTaskTemplateCommandRequest(request: FunctionRequest<TaskTemplateCommandAction, JsonObject>):
  Validation<TaskTemplateCommandInput> {
  if (request.operationId === undefined || request.expectedVersion === undefined
    || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0) {
    return invalid('expectedVersion', '模板写入需要操作标识和当前版本。');
  }
  if (request.action === 'saveTemplate') {
    const exact = parseExactObject(request.payload, ['title', 'description', 'itemRefs'], ['templateId']);
    if (!exact.ok) return exact;
    if (typeof exact.value.title !== 'string' || typeof exact.value.description !== 'string'
      || (exact.value.templateId !== undefined && !id(exact.value.templateId))) {
      return invalid('title', '模板名称或说明无效。');
    }
    const refs = parseItemRefs(exact.value.itemRefs);
    if (!refs.ok) return refs;
    return { ok: true, value: { action: 'saveTemplate',
      input: { title: exact.value.title, description: exact.value.description, itemRefs: refs.value,
        ...(exact.value.templateId === undefined ? {} : { templateId: exact.value.templateId as string }) },
      expectedVersion: request.expectedVersion, operationId: request.operationId } };
  }
  if (request.action === 'renameTemplate' || request.action === 'copyTemplate') {
    const exact = parseExactObject(request.payload, ['templateId', 'title']);
    if (!exact.ok) return exact;
    return id(exact.value.templateId) && typeof exact.value.title === 'string'
      ? { ok: true, value: { action: request.action, templateId: exact.value.templateId,
        title: exact.value.title, expectedVersion: request.expectedVersion, operationId: request.operationId } }
      : invalid('templateId', '模板标识或名称无效。');
  }
  const exact = parseExactObject(request.payload, ['templateId']);
  if (!exact.ok) return exact;
  return id(exact.value.templateId) ? { ok: true, value: { action: request.action,
    templateId: exact.value.templateId, expectedVersion: request.expectedVersion,
    operationId: request.operationId } } : invalid('templateId', '模板标识无效。');
}
