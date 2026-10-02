import type { AdminCloudResult } from './admin-cloud-contract';
import type { AdminSessionClient } from './admin-session-client';
import type { CloudBaseBrowserApp } from './cloudbase-admin-runtime';

export type TextbookDashboardField = 'grade' | 'studentCount' | 'configuredBookCount' | 'progress' | 'updatedAt';
export interface TextbookLayout { classTextbooksEnabled: boolean; synchronizedTextbooksEnabled: boolean;
  visibleClassIds: string[]; dashboardFields: TextbookDashboardField[] }
export interface TextbookSettings { id: string; organizationId: string; draft: TextbookLayout; published: TextbookLayout | null;
  status: 'draft' | 'published'; version: number; updatedAt: string; publishedAt: string | null }
export interface TextbookCatalogDraft { id: string; organizationId: string; resourceId: string; classIds: string[];
  status: 'draft' | 'published' | 'disabled'; version: number; updatedAt: string; publishedAt: string | null }
export interface AdminTextbookBook { id: string; title: string; grade: string; term: string; edition: string;
  contentVersion: string; chapterCount: number; status: 'draft' | 'published' | 'offline';
  visibleClassIds: string[]; updatedAt: string | null; version: number; draft: TextbookCatalogDraft | null }
export interface AdminTextbookPreview extends AdminTextbookBook { chapters: Array<{ id: string; title: string;
  lessons: Array<{ id: string; title: string }> }> }
export interface AdminTextbookOverview { classes: Array<{ id: string; name: string; grade: string; term: string;
  status: 'active' | 'archived' }>; books: AdminTextbookBook[]; settings: TextbookSettings | null }

export interface AdminTextbookClient {
  getOverview(): Promise<AdminCloudResult<AdminTextbookOverview>>;
  previewTextbook(resourceId: string): Promise<AdminCloudResult<AdminTextbookPreview>>;
  saveSettings(layout: TextbookLayout, expectedVersion: number, operationId: string, publish: boolean): Promise<AdminCloudResult<TextbookSettings>>;
  saveCatalogDraft(resourceId: string, classIds: readonly string[], expectedVersion: number, operationId: string): Promise<AdminCloudResult<TextbookCatalogDraft>>;
  changeCatalogStatus(resourceId: string, expectedVersion: number, operationId: string, publish: boolean): Promise<AdminCloudResult<TextbookCatalogDraft>>;
}

type Action = 'getOverview' | 'previewTextbook' | 'saveSettings' | 'publishSettings'
  | 'saveCatalogDraft' | 'publishCatalog' | 'disableCatalog';
const SAFE_ERRORS = {
  VALIDATION_ERROR: '输入内容不符合要求，请检查后重试。', UNAUTHENTICATED: '后台登录状态已失效，请重新登录。',
  FORBIDDEN: '当前后台账号没有教材配置权限。', NOT_FOUND: '课本不存在或不在授权范围。',
  CONFLICT: '教材配置已发生变化，请刷新后重试。', RESOURCE_OFFLINE: '该课本当前不可用。',
  NETWORK_ERROR: '网络连接异常，请稍后重试。', SERVICE_UNAVAILABLE: '教材服务尚未配置或暂不可用。',
  INTERNAL_ERROR: '教材服务处理失败，请稍后重试。',
} as const;
type SafeError = keyof typeof SAFE_ERRORS;
function failed<T>(code: SafeError): AdminCloudResult<T> {
  return { ok: false, error: { code, message: SAFE_ERRORS[code],
    retryable: code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE' || code === 'INTERNAL_ERROR' } };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isBook(value: unknown): value is AdminTextbookBook {
  return record(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.grade === 'string' && typeof value.term === 'string' && typeof value.edition === 'string'
    && typeof value.contentVersion === 'string' && typeof value.chapterCount === 'number'
    && ['draft', 'published', 'offline'].includes(String(value.status))
    && Array.isArray(value.visibleClassIds) && value.visibleClassIds.every(item => typeof item === 'string')
    && Number.isSafeInteger(value.version);
}
function isPreview(value: unknown): value is AdminTextbookPreview {
  return isBook(value) && record(value) && Array.isArray(value.chapters)
    && value.chapters.every(chapter => record(chapter) && typeof chapter.id === 'string'
      && typeof chapter.title === 'string' && Array.isArray(chapter.lessons));
}
function isSettings(value: unknown): value is TextbookSettings {
  return record(value) && typeof value.id === 'string' && Number.isSafeInteger(value.version)
    && record(value.draft) && Array.isArray(value.draft.visibleClassIds)
    && (value.published === null || record(value.published));
}
function isDraft(value: unknown): value is TextbookCatalogDraft {
  return record(value) && typeof value.id === 'string' && typeof value.resourceId === 'string'
    && Array.isArray(value.classIds) && value.classIds.every(item => typeof item === 'string')
    && Number.isSafeInteger(value.version);
}
function isOverview(value: unknown): value is AdminTextbookOverview {
  return record(value) && Array.isArray(value.classes) && value.classes.every(item =>
    record(item) && typeof item.id === 'string' && typeof item.name === 'string'
    && typeof item.grade === 'string' && typeof item.term === 'string')
    && Array.isArray(value.books) && value.books.every(isBook)
    && (value.settings === null || isSettings(value.settings));
}

export function createAdminTextbookClient(app: CloudBaseBrowserApp, sessions: AdminSessionClient): AdminTextbookClient {
  async function invoke<T>(name: 'textbook-admin-query' | 'textbook-admin-command', action: Action,
    payload: object, valid: (value: unknown) => value is T, write?: { expectedVersion: number; operationId: string }): Promise<AdminCloudResult<T>> {
    const session = await sessions.getCurrentSession();
    if (!session.ok) return session;
    try {
      const response = await app.callFunction({ name, parse: true, data: {
        apiVersion: 'm1.v1', action, payload, businessSessionToken: session.data.token,
        ...(write ? { expectedVersion: write.expectedVersion, operationId: write.operationId } : {}),
      } });
      const result = response.result;
      if (!record(result) || typeof result.ok !== 'boolean') return failed('INTERNAL_ERROR');
      if (result.ok) return valid(result.data) ? { ok: true, data: result.data } : failed('INTERNAL_ERROR');
      const code = record(result.error) && typeof result.error.code === 'string' && result.error.code in SAFE_ERRORS
        ? result.error.code as SafeError : 'INTERNAL_ERROR';
      return failed(code);
    } catch { return failed('NETWORK_ERROR'); }
  }
  return {
    getOverview: () => invoke('textbook-admin-query', 'getOverview', {}, isOverview),
    previewTextbook: resourceId => invoke('textbook-admin-query', 'previewTextbook', { resourceId }, isPreview),
    saveSettings: (layout, expectedVersion, operationId, publish) => invoke('textbook-admin-command',
      publish ? 'publishSettings' : 'saveSettings', { layout }, isSettings, { expectedVersion, operationId }),
    saveCatalogDraft: (resourceId, classIds, expectedVersion, operationId) => invoke('textbook-admin-command',
      'saveCatalogDraft', { resourceId, classIds }, isDraft, { expectedVersion, operationId }),
    changeCatalogStatus: (resourceId, expectedVersion, operationId, publish) => invoke('textbook-admin-command',
      publish ? 'publishCatalog' : 'disableCatalog', { resourceId }, isDraft, { expectedVersion, operationId }),
  };
}
