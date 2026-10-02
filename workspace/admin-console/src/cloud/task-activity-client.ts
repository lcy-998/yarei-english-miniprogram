import type { CloudBaseBrowserApp } from './cloudbase-admin-runtime';
import type { AdminSessionStore } from './admin-session-client';
import type { ActivityResult, ManagedDetail, ManagedExport, ManagedFilters, ManagedItem,
  ManagedKind, ManagedList, StopManagedResult, TaskActivityClient } from '../services/task-activity-models';

type Action = 'list' | 'detail' | 'exportCsv' | 'stop';
const QUERY = 'admin-task-activity-query';
const COMMAND = 'admin-task-activity-command';
function fail<T>(code: string, message: string): ActivityResult<T> { return { ok: false, code, message }; }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === 'string'; }
function item(value: unknown): value is ManagedItem {
  return record(value) && text(value.id) && text(value.title)
    && (value.kind === 'classroom' || value.kind === 'activity' || value.kind === 'template')
    && text(value.teacherNameMasked) && Array.isArray(value.classIds) && value.classIds.every(text)
    && Array.isArray(value.classNames) && value.classNames.every(text)
    && text(value.status) && Number.isSafeInteger(value.version)
    && value.aiAssisted === false;
}
function parseList(value: unknown): ManagedList | null {
  return record(value) && Array.isArray(value.items) && value.items.every(item)
    && Number.isSafeInteger(value.total) && (value.nextOffset === null || Number.isSafeInteger(value.nextOffset))
    ? value as unknown as ManagedList : null;
}
function parseDetail(value: unknown): ManagedDetail | null {
  return record(value) && item(value.item) && Array.isArray(value.submissions)
    && value.submissions.every((row) => record(row) && text(row.studentId) && text(row.studentNameMasked)
      && text(row.status) && (row.submittedAt === null || text(row.submittedAt))
      && (row.score === null || typeof row.score === 'number') && typeof row.hasFeedback === 'boolean')
    ? value as unknown as ManagedDetail : null;
}
function parseExport(value: unknown): ManagedExport | null {
  return record(value) && text(value.fileName) && text(value.csv)
    ? { fileName: value.fileName, csv: value.csv } : null;
}
function parseStop(value: unknown): StopManagedResult | null {
  return record(value) && text(value.id) && text(value.status)
    && (value.kind === 'classroom' || value.kind === 'activity' || value.kind === 'template')
    && Number.isSafeInteger(value.version) ? value as unknown as StopManagedResult : null;
}

export function createTaskActivityClient(app: CloudBaseBrowserApp, sessions: AdminSessionStore,
  now: () => Date = () => new Date()): TaskActivityClient {
  async function invoke<T>(action: Action, payload: object, parse: (value: unknown) => T | null,
    write?: { expectedVersion: number; operationId: string }): Promise<ActivityResult<T>> {
    let stored: unknown;
    try { stored = await sessions.current(); }
    catch { return fail('SERVICE_UNAVAILABLE', '后台会话读取失败'); }
    if (!record(stored) || stored.audience !== 'admin-console' || !text(stored.token)
      || stored.token.length < 16 || !text(stored.expiresAt)
      || Date.parse(stored.expiresAt) <= now().getTime()) return fail('UNAUTHENTICATED', '请重新登录后台');
    try {
      const response = await app.callFunction({ name: write ? COMMAND : QUERY,
        data: { apiVersion: 'm1.v1', action, payload, businessSessionToken: stored.token,
          ...(write ? { expectedVersion: write.expectedVersion, operationId: write.operationId } : {}) }, parse: true });
      const result = response.result;
      if (!record(result) || typeof result.ok !== 'boolean') return fail('INTERNAL_ERROR', '后台数据返回异常');
      if (result.ok) {
        const data = parse(result.data);
        return data === null ? fail('INTERNAL_ERROR', '后台数据结构异常') : { ok: true, data };
      }
      const problem = result.error;
      return record(problem) && text(problem.code) && text(problem.message)
        ? fail(problem.code, problem.message) : fail('INTERNAL_ERROR', '后台服务处理失败');
    } catch { return fail('NETWORK_ERROR', '网络异常，请稍后重试'); }
  }
  return {
    list(filters, page) { return invoke('list', { filters, page }, parseList); },
    detail(kind: ManagedKind, id: string) { return invoke('detail', { kind, id }, parseDetail); },
    exportCsv(filters: ManagedFilters) { return invoke('exportCsv', { filters }, parseExport); },
    stop(input) { return invoke('stop', { kind: input.kind, id: input.id, reason: input.reason },
      parseStop, { expectedVersion: input.expectedVersion, operationId: input.operationId }); },
  };
}
