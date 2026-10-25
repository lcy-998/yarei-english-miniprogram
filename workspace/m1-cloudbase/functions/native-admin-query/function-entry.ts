import type { FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseExactObject } from '../../src/shared/strict-object';
import { NativeAdminQueryError, type NativeAdminQueryService } from '../../src/native-admin/query-service';
import { NativeAdminDataError, type NativeAdminDataService,
  type NativeAdminRecordFilter, type NativeAdminRecordKind,
  type NativeAdminSelectionKind } from '../../src/native-admin/data-service';
import { NativeWorkRestoreError, type NativeAdminWorkRestoreService } from '../../src/native-admin/work-restore-service';
import { NativeAdminGrantCandidateError, type NativeAdminGrantCandidateService } from '../../src/native-admin/grant-candidate-service';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies,
  type TrustedFunctionValidation } from '../shared/trusted-function';

export const NATIVE_ADMIN_QUERY_ACTIONS = ['getAccess', 'getOrganization', 'getOverview', 'listClasses', 'listUsers', 'listSelectionOptions', 'listGrants', 'listGrantCandidates', 'listAudit', 'listRecords', 'listDeletedWorkDrafts', 'exportRecords', 'getMediaReviewSummary', 'getMediaPreview', 'listMediaAudit', 'getQuestionPreview', 'listUserBindings'] as const;
// Question content is fetched only after a manager opens one specific record.
export type NativeAdminQueryAction = (typeof NATIVE_ADMIN_QUERY_ACTIONS)[number];

type NativeAdminQueryInput =
  | Readonly<{ action: 'getOrganization' }>
  | Readonly<{ action: 'getAccess' }>
  | Readonly<{ action: 'getOverview'; from: string; to: string }>
  | Readonly<{ action: 'listClasses'; query: string; limit: number; offset: number }>
  | Readonly<{ action: 'listSelectionOptions'; kind: NativeAdminSelectionKind;
    classId: string; query: string; limit: number; offset: number }>
  | Readonly<{ action: 'listGrants'; query: string; limit: number; offset: number }>
  | Readonly<{ action: 'listGrantCandidates'; query: string; limit: number; offset: number }>
  | Readonly<{ action: 'listAudit'; limit: number; offset: number }>
  | Readonly<{ action: 'listRecords'; kind: NativeAdminRecordKind; filter: NativeAdminRecordFilter; limit: number; offset: number }>
  | Readonly<{ action: 'listDeletedWorkDrafts'; studentId: string; limit: number; offset: number }>
  | Readonly<{ action: 'exportRecords'; kind: 'tasks'; filter: NativeAdminRecordFilter }>
  | Readonly<{ action: 'getMediaReviewSummary'; mediaId: string }>
  | Readonly<{ action: 'getMediaPreview'; mediaId: string }>
  | Readonly<{ action: 'listMediaAudit'; mediaId: string; limit: number; offset: number }>
  | Readonly<{ action: 'getQuestionPreview'; questionId: string }>
  | Readonly<{ action: 'listUserBindings'; userId: string }>
  | Readonly<{ action: 'listUsers'; classId: string; query: string; role: string; status: string; limit: number; offset: number }>;

export function validateNativeAdminQueryRequest(request: FunctionRequest<NativeAdminQueryAction, JsonObject>):
  TrustedFunctionValidation<NativeAdminQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) {
    return { ok: false as const, fieldErrors: { operationId: '查询不接受写操作参数。' } };
  }
  if (request.action === 'getAccess' || request.action === 'getOrganization') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true as const, value: { action: request.action } } : exact;
  }
  if (request.action === 'getOverview') {
    const exact = parseExactObject(request.payload, ['from', 'to']);
    if (!exact.ok || typeof exact.value.from !== 'string' || typeof exact.value.to !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/u.test(exact.value.from)
      || !/^\d{4}-\d{2}-\d{2}$/u.test(exact.value.to) || exact.value.from > exact.value.to) {
      return { ok: false, fieldErrors: { range: '统计日期范围无效。' } };
    }
    return { ok: true, value: { action: 'getOverview', from: exact.value.from, to: exact.value.to } };
  }
  if (request.action === 'listSelectionOptions') {
    const exact = parseExactObject(request.payload, ['kind', 'classId', 'page'], ['query']);
    if (!exact.ok) return exact;
    const kind = exact.value.kind;
    const classId = exact.value.classId;
    const query = exact.value.query ?? '';
    const page = parseExactObject(exact.value.page, ['limit', 'offset']);
    if (!page.ok || !['class_for_user', 'class_for_grant', 'teacher_for_class',
      'parent_for_binding', 'student_for_binding'].includes(String(kind))
      || typeof classId !== 'string' || classId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(classId)
      || kind === 'teacher_for_class' && !classId
      || typeof query !== 'string' || query.length > 100
      || !Number.isSafeInteger(page.value.limit) || Number(page.value.limit) < 1
      || Number(page.value.limit) > 50 || !Number.isSafeInteger(page.value.offset)
      || Number(page.value.offset) < 0 || Number(page.value.offset) > 10000) {
      return { ok: false, fieldErrors: { selection: '候选范围或筛选条件无效。' } };
    }
    return { ok: true, value: { action: 'listSelectionOptions',
      kind: kind as NativeAdminSelectionKind, classId,
      query, limit: Number(page.value.limit), offset: Number(page.value.offset) } };
  }
  if (request.action === 'exportRecords') {
    const exact = parseExactObject(request.payload, ['kind'], ['filter']);
    const filter = exact.ok ? parseRecordFilter(exact.value.filter) : null;
    return exact.ok && exact.value.kind === 'tasks' && filter !== null
      ? { ok: true, value: { action: 'exportRecords', kind: 'tasks', filter } }
      : { ok: false, fieldErrors: { kind: '导出范围无效。' } };
  }
  if (request.action === 'getMediaReviewSummary' || request.action === 'getMediaPreview') {
    const exact = parseExactObject(request.payload, ['mediaId']);
    return exact.ok && typeof exact.value.mediaId === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(exact.value.mediaId)
      ? { ok: true, value: { action: request.action, mediaId: exact.value.mediaId } }
      : { ok: false, fieldErrors: { mediaId: '媒体标识无效。' } };
  }
  if (request.action === 'listMediaAudit') {
    const exact = parseExactObject(request.payload, ['mediaId', 'page']);
    const page = exact.ok ? parseExactObject(exact.value.page, ['limit', 'offset']) : null;
    return exact.ok && typeof exact.value.mediaId === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(exact.value.mediaId)
      && page?.ok && Number.isSafeInteger(page.value.limit)
      && Number(page.value.limit) >= 1 && Number(page.value.limit) <= 50
      && Number.isSafeInteger(page.value.offset) && Number(page.value.offset) >= 0
      && Number(page.value.offset) <= 10000
      ? { ok: true, value: { action: 'listMediaAudit', mediaId: exact.value.mediaId,
        limit: Number(page.value.limit), offset: Number(page.value.offset) } }
      : { ok: false, fieldErrors: { mediaId: '媒体记录分页参数无效。' } };
  }
  if (request.action === 'getQuestionPreview') {
    const exact = parseExactObject(request.payload, ['questionId']);
    return exact.ok && typeof exact.value.questionId === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(exact.value.questionId)
      ? { ok: true, value: { action: 'getQuestionPreview', questionId: exact.value.questionId } }
      : { ok: false, fieldErrors: { questionId: '题目标识无效。' } };
  }
  if (request.action === 'listUserBindings') {
    const exact = parseExactObject(request.payload, ['userId']);
    return exact.ok && typeof exact.value.userId === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(exact.value.userId)
      ? { ok: true, value: { action: 'listUserBindings', userId: exact.value.userId } }
      : { ok: false, fieldErrors: { userId: '用户标识无效。' } };
  }
  const exact = parseExactObject(request.payload,
    request.action === 'listUsers' ? ['classId', 'page']
      : request.action === 'listDeletedWorkDrafts' ? ['studentId', 'page']
      : request.action === 'listRecords' ? ['kind', 'page'] : ['page'],
    request.action === 'listRecords' ? ['filter']
      : request.action === 'listUsers' ? ['query', 'role', 'status'] : request.action === 'listClasses'
        || request.action === 'listGrants' || request.action === 'listGrantCandidates' ? ['query'] : []);
  if (!exact.ok) return exact;
  const page = parseExactObject(exact.value.page, ['limit', 'offset']);
  if (!page.ok || !Number.isSafeInteger(page.value.limit) || Number(page.value.limit) < 1
    || Number(page.value.limit) > 50 || !Number.isSafeInteger(page.value.offset)
    || Number(page.value.offset) < 0 || Number(page.value.offset) > 10000) {
    return { ok: false as const, fieldErrors: { page: '分页参数无效。' } };
  }
  const limit = Number(page.value.limit);
  const offset = Number(page.value.offset);
  if (request.action === 'listClasses' || request.action === 'listGrants'
    || request.action === 'listGrantCandidates'
    || request.action === 'listAudit') {
    const query = exact.value.query;
    if (query !== undefined && (typeof query !== 'string' || query.length > 100)) {
      return { ok: false as const, fieldErrors: { query: '搜索词无效。' } };
    }
    return { ok: true as const,
      value: request.action === 'listAudit' ? { action: request.action, limit, offset }
        : { action: request.action, query: typeof query === 'string' ? query : '', limit, offset } };
  }
  if (request.action === 'listRecords') {
    const kind = exact.value.kind;
    if (kind !== 'textbooks' && kind !== 'questions' && kind !== 'tasks' && kind !== 'media') {
      return { ok: false as const, fieldErrors: { kind: '管理目录类型无效。' } };
    }
    const filter = parseRecordFilter(exact.value.filter);
    if (filter === null) return { ok: false as const, fieldErrors: { filter: '筛选条件无效。' } };
    return { ok: true as const, value: { action: 'listRecords', kind, filter, limit, offset } };
  }
  if (request.action === 'listDeletedWorkDrafts') {
    if (typeof exact.value.studentId !== 'string' || !exact.value.studentId.trim()
      || exact.value.studentId.length > 128) {
      return { ok: false as const, fieldErrors: { studentId: '学员标识无效。' } };
    }
    return { ok: true as const, value: { action: 'listDeletedWorkDrafts' as const,
      studentId: exact.value.studentId, limit, offset } };
  }
  if (typeof exact.value.classId !== 'string'
    || (exact.value.classId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(exact.value.classId))) {
    return { ok: false as const, fieldErrors: { classId: '班级标识无效。' } };
  }
  const role = exact.value.role ?? '';
  const status = exact.value.status ?? '';
  if (typeof role !== 'string' || !['', 'student', 'parent', 'teacher', 'admin'].includes(role)
    || typeof status !== 'string' || !['', 'active', 'disabled'].includes(status)
    || exact.value.query !== undefined && (typeof exact.value.query !== 'string' || exact.value.query.length > 100)) {
    return { ok: false, fieldErrors: { role: '用户类型、账号状态或搜索词无效。' } };
  }
  return { ok: true as const, value: { action: 'listUsers' as const,
    classId: exact.value.classId, query: typeof exact.value.query === 'string' ? exact.value.query : '', role, status, limit, offset } };
}

function parseRecordFilter(value: unknown): NativeAdminRecordFilter | null {
  if (value === undefined) return {};
  const parsed = parseExactObject(value, [], ['query', 'status', 'mediaKind', 'taskType', 'from', 'to']);
  if (!parsed.ok) return null;
  const { query, status, mediaKind, taskType, from, to } = parsed.value;
  if (query !== undefined && (typeof query !== 'string' || query.length > 100)) return null;
  if (status !== undefined && (typeof status !== 'string' || status.length > 40)) return null;
  if (mediaKind !== undefined && !['', 'listening', 'video', 'dubbing'].includes(String(mediaKind))) return null;
  if (taskType !== undefined && taskType !== 'all' && taskType !== 'classroom' && taskType !== 'activity') return null;
  if (from !== undefined && (typeof from !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(from))) return null;
  if (to !== undefined && (typeof to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(to))) return null;
  return { ...(typeof query === 'string' ? { query } : {}),
    ...(typeof status === 'string' ? { status } : {}),
    ...(mediaKind === '' || mediaKind === 'listening' || mediaKind === 'video'
      || mediaKind === 'dubbing' ? { mediaKind } : {}),
    ...(taskType === 'all' || taskType === 'classroom' || taskType === 'activity' ? { taskType } : {}),
    ...(typeof from === 'string' ? { from } : {}), ...(typeof to === 'string' ? { to } : {}) };
}

export interface NativeAdminQueryDependencies extends TrustedFunctionDependencies {
  readonly service: NativeAdminQueryService;
  readonly dataService?: NativeAdminDataService;
  readonly workRestore?: Pick<NativeAdminWorkRestoreService, 'listDeleted'>;
  readonly grantCandidates?: NativeAdminGrantCandidateService;
}

export function createNativeAdminQueryFunction(dependencies: NativeAdminQueryDependencies) {
  return createTrustedFunction<NativeAdminQueryAction, NativeAdminQueryInput, unknown>(
    'native-admin-query', NATIVE_ADMIN_QUERY_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof NativeAdminQueryError
      || error instanceof NativeAdminDataError
      || error instanceof NativeAdminGrantCandidateError
      || error instanceof NativeWorkRestoreError
      ? error.code : dependencies.mapFailure?.(phase, error) ?? 'SERVICE_UNAVAILABLE' },
    validateNativeAdminQueryRequest,
    async (input, actor): Promise<ServiceResult<unknown>> => {
      const meta = createMeta(dependencies.clock, dependencies.requestIds);
      if (input.action === 'getOverview' || input.action === 'exportRecords'
        || input.action === 'listRecords' && (input.kind === 'textbooks' || input.kind === 'tasks')) {
        return { ok: false, error: { code: 'FORBIDDEN',
          message: '当前原生管理范围不包含该操作', retryable: false }, meta };
      }
      if (input.action === 'getAccess') return success(await dependencies.service.getAccess(actor), meta);
      if (!dependencies.dataService) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用', retryable: true }, meta };
      if (input.action === 'getOrganization') return success(await dependencies.dataService.getOrganization(actor), meta);
      if (input.action === 'listClasses') return success(
        await dependencies.dataService.listClasses(actor, input.limit, input.offset, input.query), meta);
      if (input.action === 'listSelectionOptions') return success(
        await dependencies.dataService.listSelectionOptions(actor, input.kind,
          input.classId, input.limit, input.offset, input.query), meta);
      if (input.action === 'listGrants') return success(
        await dependencies.dataService.listGrants(actor, input.limit, input.offset, input.query), meta);
      if (input.action === 'listGrantCandidates') {
        if (!dependencies.grantCandidates) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
          message: '服务暂时不可用', retryable: true }, meta };
        return success(await dependencies.grantCandidates.list(actor, input.limit, input.offset, input.query), meta);
      }
      if (input.action === 'listAudit') return success(
        await dependencies.dataService.listAudit(actor, input.limit, input.offset), meta);
      if (input.action === 'listRecords') return success(
        await dependencies.dataService.listRecords(actor, input.kind, input.limit, input.offset, input.filter), meta);
      if (input.action === 'getMediaReviewSummary') return success(
        await dependencies.dataService.getMediaReviewSummary(actor, input.mediaId), meta);
      if (input.action === 'getMediaPreview') return success(
        await dependencies.dataService.getMediaPreview(actor, input.mediaId), meta);
      if (input.action === 'listMediaAudit') return success(
        await dependencies.dataService.listMediaAudit(actor, input.mediaId,
          input.limit, input.offset), meta);
      if (input.action === 'getQuestionPreview') return success(
        await dependencies.dataService.getQuestionPreview(actor, input.questionId), meta);
      if (input.action === 'listUserBindings') return success(
        await dependencies.dataService.listUserBindings(actor, input.userId), meta);
      if (input.action === 'listDeletedWorkDrafts') {
        return { ok: false, error: { code: 'FORBIDDEN',
          message: '已删草稿不可恢复', retryable: false }, meta };
      }
      return success(await dependencies.dataService.listUsers(actor,
        input.classId, input.limit, input.offset, input.query, input.role, input.status), meta);
    });
}
