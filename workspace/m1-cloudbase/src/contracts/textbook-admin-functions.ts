import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import { TEXTBOOK_DASHBOARD_FIELDS, type TextbookCenterLayout } from '../textbook/admin-types';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
export const TEXTBOOK_ADMIN_QUERY_ACTIONS = ['getOverview', 'previewTextbook'] as const;
export const TEXTBOOK_ADMIN_COMMAND_ACTIONS = ['saveSettings', 'publishSettings',
  'saveCatalogDraft', 'publishCatalog', 'disableCatalog'] as const;
export type TextbookAdminQueryAction = (typeof TEXTBOOK_ADMIN_QUERY_ACTIONS)[number];
export type TextbookAdminCommandAction = (typeof TEXTBOOK_ADMIN_COMMAND_ACTIONS)[number];
export type TextbookAdminQueryInput = Readonly<{ action: 'getOverview' }>
  | Readonly<{ action: 'previewTextbook'; resourceId: string }>;
export type TextbookAdminCommandInput = Readonly<{ action: 'saveSettings' | 'publishSettings';
  layout: TextbookCenterLayout; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'saveCatalogDraft'; resourceId: string; classIds: readonly string[];
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'publishCatalog' | 'disableCatalog'; resourceId: string;
    expectedVersion: number; operationId: string }>;
function invalid<T>(field: string): Validation<T> { return { ok: false, fieldErrors: { [field]: '字段格式无效。' } }; }
function id(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 500
    && value.every(id) && new Set(value).size === value.length;
}

export function validateTextbookAdminQueryRequest(request: FunctionRequest<TextbookAdminQueryAction, JsonObject>):
  Validation<TextbookAdminQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) return invalid('operationId');
  if (request.action === 'getOverview') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true, value: { action: 'getOverview' } } : exact;
  }
  const exact = parseExactObject(request.payload, ['resourceId']);
  return exact.ok && id(exact.value.resourceId)
    ? { ok: true, value: { action: 'previewTextbook', resourceId: exact.value.resourceId } }
    : invalid('resourceId');
}

export function validateTextbookAdminCommandRequest(request: FunctionRequest<TextbookAdminCommandAction, JsonObject>):
  Validation<TextbookAdminCommandInput> {
  if (!request.operationId || !Number.isSafeInteger(request.expectedVersion)
    || Number(request.expectedVersion) < 0) return invalid('expectedVersion');
  const expectedVersion = Number(request.expectedVersion);
  if (request.action === 'saveSettings' || request.action === 'publishSettings') {
    const exact = parseExactObject(request.payload, ['layout']);
    if (!exact.ok) return exact;
    const layout = parseExactObject(exact.value.layout,
      ['classTextbooksEnabled', 'synchronizedTextbooksEnabled', 'visibleClassIds', 'dashboardFields']);
    if (!layout.ok || typeof layout.value.classTextbooksEnabled !== 'boolean'
      || typeof layout.value.synchronizedTextbooksEnabled !== 'boolean'
      || !ids(layout.value.visibleClassIds)
      || !Array.isArray(layout.value.dashboardFields) || layout.value.dashboardFields.length < 1
      || !layout.value.dashboardFields.every(field => typeof field === 'string'
        && TEXTBOOK_DASHBOARD_FIELDS.includes(field as typeof TEXTBOOK_DASHBOARD_FIELDS[number]))
      || new Set(layout.value.dashboardFields).size !== layout.value.dashboardFields.length) return invalid('layout');
    return { ok: true, value: { action: request.action,
      layout: { classTextbooksEnabled: layout.value.classTextbooksEnabled,
        synchronizedTextbooksEnabled: layout.value.synchronizedTextbooksEnabled,
        visibleClassIds: layout.value.visibleClassIds,
        dashboardFields: layout.value.dashboardFields as TextbookCenterLayout['dashboardFields'] },
      expectedVersion, operationId: request.operationId } };
  }
  if (request.action === 'saveCatalogDraft') {
    const exact = parseExactObject(request.payload, ['resourceId', 'classIds']);
    if (!exact.ok || !id(exact.value.resourceId) || !ids(exact.value.classIds)) return invalid('classIds');
    return { ok: true, value: { action: 'saveCatalogDraft', resourceId: exact.value.resourceId,
      classIds: exact.value.classIds, expectedVersion, operationId: request.operationId } };
  }
  const exact = parseExactObject(request.payload, ['resourceId']);
  return exact.ok && id(exact.value.resourceId)
    ? { ok: true, value: { action: request.action, resourceId: exact.value.resourceId,
      expectedVersion, operationId: request.operationId } }
    : invalid('resourceId');
}
