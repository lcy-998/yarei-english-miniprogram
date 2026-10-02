import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import {
  ROLE_PERMISSIONS,
  ROLE_SCOPE_TYPES,
  TEACHER_CLASS_PERMISSIONS,
  USER_ROLES,
  type RolePermission,
  type RoleScopeType,
  type TeacherClassPermission,
  type UserRole,
} from '../org-content/types';
import { SCHOOL_QUESTION_TYPES, type SchoolQuestionFilters, type StudentCatalogFilters, type TaskCatalogFilters } from '../org-content/types';
import type { QuestionAdminFilters, QuestionBatchItem, QuestionVisibility } from '../question-admin/types';

export type ContractValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export const RELATIONSHIP_COMMAND_ACTIONS = ['issueBindingCode', 'bindChild', 'unbindChild'] as const;
export type RelationshipCommandAction = (typeof RELATIONSHIP_COMMAND_ACTIONS)[number];

export type RelationshipCommandInput =
  | Readonly<{ action: 'issueBindingCode'; studentId: string; operationId: string }>
  | Readonly<{ action: 'bindChild'; studentNumber: string; code: string; operationId: string }>
  | Readonly<{
      action: 'unbindChild';
      childId: string;
      reason: string;
      expectedVersion: number;
      operationId: string;
    }>;

export const CONTENT_QUERY_ACTIONS = [
  'getMyClass',
  'listSchoolQuestions',
  'listSchoolQuestionFacets',
  'getSchoolQuestion',
  'listTaskCatalogResources',
  'listTaskCatalogFacets',
  'getTaskCatalogResource',
  'listStudentCatalog',
  'listStudentCatalogFacets',
  'listReadingResources',
  'getReadingResource',
  'listVocabularyPacks',
  'getVocabularyPack',
] as const;
export type ContentQueryAction = (typeof CONTENT_QUERY_ACTIONS)[number];

export type ContentQueryInput =
  | Readonly<{ action: 'getMyClass' | 'listReadingResources' | 'listVocabularyPacks' }>
  | Readonly<{ action: 'listSchoolQuestions'; filters: SchoolQuestionFilters; page: Readonly<{ limit: number; offset: number }> }>
  | Readonly<{ action: 'listSchoolQuestionFacets'; targetClassIds?: readonly string[] }>
  | Readonly<{ action: 'getSchoolQuestion'; resourceId: string; targetClassIds?: readonly string[] }>
  | Readonly<{ action: 'listTaskCatalogResources'; filters: TaskCatalogFilters; page: Readonly<{ limit: number; offset: number }> }>
  | Readonly<{ action: 'listTaskCatalogFacets'; type: TaskCatalogFilters['type']; targetClassIds?: readonly string[] }>
  | Readonly<{ action: 'getTaskCatalogResource'; resourceId: string; targetClassIds?: readonly string[] }>
  | Readonly<{ action: 'listStudentCatalog'; filters: StudentCatalogFilters; page: Readonly<{ limit: number; offset: number }> }>
  | Readonly<{ action: 'listStudentCatalogFacets'; type: StudentCatalogFilters['type']; category?: StudentCatalogFilters['category'] }>
  | Readonly<{ action: 'getReadingResource' | 'getVocabularyPack'; resourceId: string }>;

export const ORGANIZATION_ADMIN_ACTIONS = [
  'listClasses',
  'getDashboardOverview',
  'listRoleAssignments',
  'listAuditLogs',
  'createClass',
  'updateClass',
  'disableClass',
  'listUsers',
  'createUser',
  'updateUser',
  'disableUser',
  'assignRole',
  'revokeRole',
  'grantTeacherClass',
  'revokeTeacherClass',
  'listAdminQuestions',
  'getAdminQuestion',
  'setQuestionVisibility',
  'batchSetQuestionVisibility',
  'batchSetQuestionStatus',
  'listDeletedWorkDrafts',
  'restoreWorkDraft',
] as const;
export type OrganizationAdminAction = (typeof ORGANIZATION_ADMIN_ACTIONS)[number];

export type OrganizationAdminInput =
  | Readonly<{ action: 'listDeletedWorkDrafts'; studentId: string;
      page: Readonly<{ limit: number; offset: number }> }>
  | Readonly<{ action: 'restoreWorkDraft'; studentId: string; workId: string; reason: string;
      expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'listAdminQuestions'; filters: QuestionAdminFilters; page: Readonly<{ limit: number; offset: number }> }>
  | Readonly<{ action: 'getAdminQuestion'; id: string }>
  | Readonly<{ action: 'setQuestionVisibility'; id: string; visibility: QuestionVisibility; reason: string;
      expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'batchSetQuestionVisibility'; items: readonly QuestionBatchItem[];
      visibility: QuestionVisibility; reason: string; expectedVersion: 1; operationId: string }>
  | Readonly<{ action: 'batchSetQuestionStatus'; items: readonly QuestionBatchItem[];
      status: 'published' | 'offline'; reason: string; expectedVersion: 1; operationId: string }>
  | Readonly<{ action: 'listClasses' }>
  | Readonly<{ action: 'getDashboardOverview'; from?: string; to?: string }>
  | Readonly<{
      action: 'listRoleAssignments';
      filter: Readonly<{ userId?: string; role?: UserRole; status?: 'active' | 'revoked'; scopeType?: RoleScopeType }>;
      page: Readonly<{ limit: number; offset: number }>;
    }>
  | Readonly<{
      action: 'listAuditLogs';
      filter: Readonly<{
        actorUserId?: string;
        action?: string;
        result?: 'succeeded' | 'denied' | 'failed';
        targetType?: string;
        from?: string;
        to?: string;
      }>;
      page: Readonly<{ limit: number; offset: number }>;
    }>
  | Readonly<{ action: 'createClass'; name: string; grade: string; term: string; reason: string; expectedVersion: 1; operationId: string }>
  | Readonly<{ action: 'updateClass'; classId: string; name: string; grade: string; term: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'disableClass'; classId: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'listUsers'; classId?: string; role?: UserRole; status?: 'active' | 'disabled'; keyword?: string }>
  | Readonly<{ action: 'createUser'; displayName: string; mobile: string; role: UserRole; classId?: string; reason: string; expectedVersion: 1; operationId: string }>
  | Readonly<{ action: 'updateUser'; userId: string; displayName: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'disableUser'; userId: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{
      action: 'assignRole';
      userId: string;
      role: UserRole;
      permissions: readonly RolePermission[];
      scopeType: RoleScopeType;
      scopeIds: readonly string[];
      reason: string;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{ action: 'revokeRole'; userId: string; role: UserRole; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{
      action: 'grantTeacherClass';
      teacherId: string;
      classId: string;
      permissions: readonly TeacherClassPermission[];
      reason: string;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'revokeTeacherClass';
      teacherId: string;
      classId: string;
      reason: string;
      expectedVersion: number;
      operationId: string;
    }>;

export function validateRelationshipCommandRequest(
  request: FunctionRequest<RelationshipCommandAction, JsonObject>,
): ContractValidation<RelationshipCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');

  if (request.action === 'issueBindingCode') {
    if (request.expectedVersion !== undefined) return invalid('expectedVersion', '签发绑定码不支持版本号。');
    const exact = parseExactObject(request.payload, ['studentId']);
    if (!exact.ok) return exact;
    const studentId = requiredId(exact.value.studentId, 'studentId');
    if (!studentId.ok) return studentId;
    return { ok: true, value: { action: request.action, studentId: studentId.value, operationId: request.operationId } };
  }

  if (request.action === 'bindChild') {
    if (request.expectedVersion !== undefined) return invalid('expectedVersion', '绑定孩子不支持版本号。');
    const exact = parseExactObject(request.payload, ['studentNumber', 'code']);
    if (!exact.ok) return exact;
    const studentNumber = requiredBoundedString(exact.value.studentNumber, 'studentNumber', 128);
    if (!studentNumber.ok) return studentNumber;
    if (typeof exact.value.code !== 'string' || !/^\d{6}$/.test(exact.value.code)) {
      return invalid('code', '绑定码必须是 6 位数字。');
    }
    return {
      ok: true,
      value: { action: request.action, studentNumber: studentNumber.value, code: exact.value.code, operationId: request.operationId },
    };
  }

  if (request.expectedVersion === undefined) return invalid('expectedVersion', '解绑必须提供当前关系版本。');
  const exact = parseExactObject(request.payload, ['childId', 'reason']);
  if (!exact.ok) return exact;
  const childId = requiredId(exact.value.childId, 'childId');
  if (!childId.ok) return childId;
  const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: {
      action: request.action,
      childId: childId.value,
      reason: reason.value,
      expectedVersion: request.expectedVersion,
      operationId: request.operationId,
    },
  };
}

export function validateContentQueryRequest(
  request: FunctionRequest<ContentQueryAction, JsonObject>,
): ContractValidation<ContentQueryInput> {
  const envelopeError = rejectQueryWriteFields<ContentQueryInput>(request);
  if (envelopeError !== null) return envelopeError;
  if (request.action === 'getMyClass' || request.action === 'listReadingResources' || request.action === 'listVocabularyPacks') {
    const exact = parseExactObject(request.payload, []);
    if (!exact.ok) return exact;
    return { ok: true, value: { action: request.action } };
  }
  if (request.action === 'listStudentCatalog') {
    const exact = parseExactObject(request.payload, ['filters', 'page']);
    if (!exact.ok) return exact;
    const filters = parseExactObjectValue(exact.value.filters, ['type'],
      ['category', 'grade', 'textbook', 'unit', 'difficulty', 'theme', 'keyword'], 'filters');
    if (!filters.ok) return filters;
    if (filters.value.type !== 'reading' && filters.value.type !== 'vocabulary') return invalid('filters.type', '目录类型无效。');
    const type = filters.value.type;
    const category = optionalEnum(filters.value.category, 'filters.category',
      ['original', 'synchronized', 'picture_book', 'current_events', 'chapter_book'] as const);
    const grade = optionalBoundedString(filters.value.grade, 'filters.grade', 100);
    const textbook = optionalBoundedString(filters.value.textbook, 'filters.textbook', 100);
    const unit = optionalBoundedString(filters.value.unit, 'filters.unit', 100);
    const difficulty = optionalBoundedString(filters.value.difficulty, 'filters.difficulty', 100);
    const theme = optionalBoundedString(filters.value.theme, 'filters.theme', 100);
    const keyword = optionalBoundedString(filters.value.keyword, 'filters.keyword', 100);
    for (const result of [category, grade, textbook, unit, difficulty, theme, keyword]) if (!result.ok) return result;
    if (!category.ok || !grade.ok || !textbook.ok || !unit.ok || !difficulty.ok || !theme.ok || !keyword.ok) {
      return invalid('filters', '筛选条件无效。');
    }
    if ((type === 'vocabulary' && (category.value || difficulty.value || theme.value))
      || (type === 'reading' && unit.value)) return invalid('filters', '筛选条件与目录类型不匹配。');
    const page = parseQuestionPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action,
      filters: { type, ...compactOptional({ category: category.value, grade: grade.value,
        textbook: textbook.value, unit: unit.value, difficulty: difficulty.value,
        theme: theme.value, keyword: keyword.value }) }, page: page.value } };
  }
  if (request.action === 'listStudentCatalogFacets') {
    const exact = parseExactObject(request.payload, ['type'], ['category']);
    if (!exact.ok) return exact;
    if (exact.value.type !== 'reading' && exact.value.type !== 'vocabulary') return invalid('type', '目录类型无效。');
    const category = optionalEnum(exact.value.category, 'category',
      ['original', 'synchronized', 'picture_book', 'current_events', 'chapter_book'] as const);
    if (!category.ok) return category;
    if (exact.value.type === 'vocabulary' && category.value) return invalid('category', '词包不支持阅读分类。');
    return { ok: true, value: { action: request.action, type: exact.value.type,
      ...(category.value === undefined ? {} : { category: category.value }) } };
  }
  if (request.action === 'listSchoolQuestions') {
    const exact = parseExactObject(request.payload, ['filters', 'page']);
    if (!exact.ok) return exact;
    const filters = parseExactObjectValue(exact.value.filters, [], [
      'grade', 'textbook', 'unit', 'knowledgePoint', 'questionType', 'difficulty', 'keyword', 'targetClassIds',
    ], 'filters');
    if (!filters.ok) return filters;
    const grade = optionalBoundedString(filters.value.grade, 'filters.grade', 100);
    const textbook = optionalBoundedString(filters.value.textbook, 'filters.textbook', 100);
    const unit = optionalBoundedString(filters.value.unit, 'filters.unit', 100);
    const knowledgePoint = optionalBoundedString(filters.value.knowledgePoint, 'filters.knowledgePoint', 100);
    const questionType = optionalEnum(filters.value.questionType, 'filters.questionType', SCHOOL_QUESTION_TYPES);
    const difficulty = optionalBoundedString(filters.value.difficulty, 'filters.difficulty', 100);
    const keyword = optionalBoundedString(filters.value.keyword, 'filters.keyword', 100);
    if (!grade.ok) return grade;
    if (!textbook.ok) return textbook;
    if (!unit.ok) return unit;
    if (!knowledgePoint.ok) return knowledgePoint;
    if (!questionType.ok) return questionType;
    if (!difficulty.ok) return difficulty;
    if (!keyword.ok) return keyword;
    const targetClassIds = filters.value.targetClassIds === undefined
      ? { ok: true as const, value: undefined }
      : parseIds(filters.value.targetClassIds, 'filters.targetClassIds');
    if (!targetClassIds.ok) return targetClassIds;
    const page = parseQuestionPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: {
      action: request.action,
      filters: compactOptional({ grade: grade.value, textbook: textbook.value, unit: unit.value,
        knowledgePoint: knowledgePoint.value, questionType: questionType.value, difficulty: difficulty.value,
        keyword: keyword.value, targetClassIds: targetClassIds.value }),
      page: page.value,
    } };
  }
  if (request.action === 'listTaskCatalogResources') {
    const exact = parseExactObject(request.payload, ['filters', 'page']);
    if (!exact.ok) return exact;
    const filters = parseExactObjectValue(exact.value.filters, ['type'], [
      'source', 'category', 'grade', 'term', 'textbook', 'unit', 'difficulty', 'keyword', 'targetClassIds',
    ], 'filters');
    if (!filters.ok) return filters;
    if (filters.value.type !== 'reading' && filters.value.type !== 'vocabulary') {
      return invalid('filters.type', '目录类型仅支持阅读和单词。');
    }
    const grade = optionalBoundedString(filters.value.grade, 'filters.grade', 100);
    const source = optionalEnum(filters.value.source, 'filters.source', ['reading_book', 'synchronized_textbook', 'word_pack'] as const);
    const category = optionalEnum(filters.value.category, 'filters.category', ['original', 'synchronized', 'picture_book', 'current_events', 'chapter_book'] as const);
    const term = optionalBoundedString(filters.value.term, 'filters.term', 100);
    const textbook = optionalBoundedString(filters.value.textbook, 'filters.textbook', 100);
    const unit = optionalBoundedString(filters.value.unit, 'filters.unit', 100);
    const difficulty = optionalBoundedString(filters.value.difficulty, 'filters.difficulty', 100);
    const keyword = optionalBoundedString(filters.value.keyword, 'filters.keyword', 100);
    if (!grade.ok) return grade;
    if (!source.ok) return source;
    if (!category.ok) return category;
    if (!term.ok) return term;
    if (!textbook.ok) return textbook;
    if (!unit.ok) return unit;
    if (!difficulty.ok) return difficulty;
    if (!keyword.ok) return keyword;
    const targetClassIds = filters.value.targetClassIds === undefined
      ? { ok: true as const, value: undefined }
      : parseIds(filters.value.targetClassIds, 'filters.targetClassIds');
    if (!targetClassIds.ok) return targetClassIds;
    const page = parseQuestionPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action,
      filters: { type: filters.value.type, ...compactOptional({ source: source.value, category: category.value, grade: grade.value,
        term: term.value, textbook: textbook.value,
        unit: unit.value, difficulty: difficulty.value, keyword: keyword.value, targetClassIds: targetClassIds.value }) },
      page: page.value } };
  }
  if (request.action === 'listTaskCatalogFacets') {
    const exact = parseExactObject(request.payload, ['type'], ['targetClassIds']);
    if (!exact.ok) return exact;
    if (exact.value.type !== 'reading' && exact.value.type !== 'vocabulary') return invalid('type', '目录类型无效。');
    const targetClassIds = exact.value.targetClassIds === undefined
      ? { ok: true as const, value: undefined }
      : parseIds(exact.value.targetClassIds, 'targetClassIds');
    if (!targetClassIds.ok) return targetClassIds;
    return { ok: true, value: { action: request.action, type: exact.value.type,
      ...(targetClassIds.value === undefined ? {} : { targetClassIds: targetClassIds.value }) } };
  }
  if (request.action === 'getTaskCatalogResource') {
    const exact = parseExactObject(request.payload, ['resourceId'], ['targetClassIds']);
    if (!exact.ok) return exact;
    const resourceId = requiredId(exact.value.resourceId, 'resourceId');
    if (!resourceId.ok) return resourceId;
    const targetClassIds = exact.value.targetClassIds === undefined
      ? { ok: true as const, value: undefined }
      : parseIds(exact.value.targetClassIds, 'targetClassIds');
    if (!targetClassIds.ok) return targetClassIds;
    return { ok: true, value: { action: request.action, resourceId: resourceId.value,
      ...(targetClassIds.value === undefined ? {} : { targetClassIds: targetClassIds.value }) } };
  }
  if (request.action === 'listSchoolQuestionFacets') {
    const exact = parseExactObject(request.payload, [], ['targetClassIds']);
    if (!exact.ok) return exact;
    const targetClassIds = exact.value.targetClassIds === undefined
      ? { ok: true as const, value: undefined }
      : parseIds(exact.value.targetClassIds, 'targetClassIds');
    if (!targetClassIds.ok) return targetClassIds;
    return { ok: true, value: { action: request.action,
      ...(targetClassIds.value === undefined ? {} : { targetClassIds: targetClassIds.value }) } };
  }
  if (request.action === 'getSchoolQuestion') {
    const exact = parseExactObject(request.payload, ['resourceId'], ['targetClassIds']);
    if (!exact.ok) return exact;
    const resourceId = requiredId(exact.value.resourceId, 'resourceId');
    if (!resourceId.ok) return resourceId;
    const targetClassIds = exact.value.targetClassIds === undefined
      ? { ok: true as const, value: undefined }
      : parseIds(exact.value.targetClassIds, 'targetClassIds');
    if (!targetClassIds.ok) return targetClassIds;
    return { ok: true, value: { action: request.action, resourceId: resourceId.value,
      ...(targetClassIds.value === undefined ? {} : { targetClassIds: targetClassIds.value }) } };
  }
  const exact = parseExactObject(request.payload, ['resourceId']);
  if (!exact.ok) return exact;
  const resourceId = requiredId(exact.value.resourceId, 'resourceId');
  if (!resourceId.ok) return resourceId;
  return { ok: true, value: { action: request.action, resourceId: resourceId.value } };
}

function parseQuestionPage(value: unknown): ContractValidation<Readonly<{ limit: number; offset: number }>> {
  const parsed = parseExactObjectValue(value, ['limit', 'offset'], [], 'page');
  if (!parsed.ok) return parsed;
  if (!Number.isSafeInteger(parsed.value.limit) || typeof parsed.value.limit !== 'number'
    || parsed.value.limit < 1 || parsed.value.limit > 50) return invalid('page.limit', '每页数量必须为 1 到 50 的整数。');
  if (!Number.isSafeInteger(parsed.value.offset) || typeof parsed.value.offset !== 'number'
    || parsed.value.offset < 0 || parsed.value.offset > 10000) return invalid('page.offset', '分页偏移必须为 0 到 10000 的整数。');
  return { ok: true, value: { limit: parsed.value.limit, offset: parsed.value.offset } };
}

export function validateOrganizationAdminRequest(
  request: FunctionRequest<OrganizationAdminAction, JsonObject>,
): ContractValidation<OrganizationAdminInput> {
  if (request.action === 'listDeletedWorkDrafts') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, ['studentId', 'page']);
    if (!exact.ok) return exact;
    const studentId = requiredId(exact.value.studentId, 'studentId');
    if (!studentId.ok) return studentId;
    const page = parseAdminPage(exact.value.page);
    return page.ok ? { ok: true, value: { action: request.action,
      studentId: studentId.value, page: page.value } } : page;
  }
  if (request.action === 'listAdminQuestions') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, ['filters', 'page']);
    if (!exact.ok) return exact;
    const filter = parseExactObjectValue(exact.value.filters, [], ['keyword', 'status', 'questionType', 'classId'], 'filters');
    if (!filter.ok) return filter;
    const keyword = optionalBoundedString(filter.value.keyword, 'filters.keyword', 50);
    const status = optionalEnum(filter.value.status, 'filters.status', ['draft', 'published', 'offline'] as const);
    const questionType = optionalEnum(filter.value.questionType, 'filters.questionType', SCHOOL_QUESTION_TYPES);
    const classId = optionalId(filter.value.classId, 'filters.classId');
    if (!keyword.ok) return keyword;
    if (!status.ok) return status;
    if (!questionType.ok) return questionType;
    if (!classId.ok) return classId;
    const page = parseAdminPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action, page: page.value,
      filters: compactOptional({ keyword: keyword.value, status: status.value,
        questionType: questionType.value, classId: classId.value }) } };
  }
  if (request.action === 'getAdminQuestion') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, ['id']);
    if (!exact.ok) return exact;
    const id = requiredId(exact.value.id, 'id');
    return id.ok ? { ok: true, value: { action: request.action, id: id.value } } : id;
  }
  if (request.action === 'listClasses') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, []);
    if (!exact.ok) return exact;
    return { ok: true, value: { action: request.action } };
  }

  if (request.action === 'getDashboardOverview') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, [], ['from', 'to']);
    if (!exact.ok) return exact;
    const range = parseOptionalTimeRange(exact.value.from, exact.value.to);
    if (!range.ok) return range;
    return { ok: true, value: { action: request.action, ...range.value } };
  }

  if (request.action === 'listRoleAssignments') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, ['filter', 'page']);
    if (!exact.ok) return exact;
    const filterObject = parseExactObjectValue(exact.value.filter, [], ['userId', 'role', 'status', 'scopeType'], 'filter');
    if (!filterObject.ok) return filterObject;
    const userId = optionalId(filterObject.value.userId, 'filter.userId');
    const role = optionalEnum(filterObject.value.role, 'filter.role', USER_ROLES);
    const status = optionalEnum(filterObject.value.status, 'filter.status', ['active', 'revoked'] as const);
    const scopeType = optionalEnum(filterObject.value.scopeType, 'filter.scopeType', ROLE_SCOPE_TYPES);
    if (!userId.ok) return userId;
    if (!role.ok) return role;
    if (!status.ok) return status;
    if (!scopeType.ok) return scopeType;
    const page = parseAdminPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action, filter: compactOptional({ userId: userId.value, role: role.value, status: status.value, scopeType: scopeType.value }), page: page.value } };
  }

  if (request.action === 'listAuditLogs') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, ['filter', 'page']);
    if (!exact.ok) return exact;
    const filterObject = parseExactObjectValue(exact.value.filter, [], ['actorUserId', 'action', 'result', 'targetType', 'from', 'to'], 'filter');
    if (!filterObject.ok) return filterObject;
    const actorUserId = optionalId(filterObject.value.actorUserId, 'filter.actorUserId');
    const action = optionalBoundedString(filterObject.value.action, 'filter.action', 80);
    const result = optionalEnum(filterObject.value.result, 'filter.result', ['succeeded', 'denied', 'failed'] as const);
    const targetType = optionalBoundedString(filterObject.value.targetType, 'filter.targetType', 80);
    if (!actorUserId.ok) return actorUserId;
    if (!action.ok) return action;
    if (!result.ok) return result;
    if (!targetType.ok) return targetType;
    const range = parseOptionalTimeRange(filterObject.value.from, filterObject.value.to);
    if (!range.ok) return range;
    const page = parseAdminPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action, filter: compactOptional({ actorUserId: actorUserId.value, action: action.value, result: result.value, targetType: targetType.value, ...range.value }), page: page.value } };
  }

  if (request.action === 'listUsers') {
    const envelopeError = rejectQueryWriteFields<OrganizationAdminInput>(request);
    if (envelopeError !== null) return envelopeError;
    const exact = parseExactObject(request.payload, [], ['classId', 'role', 'status', 'keyword']);
    if (!exact.ok) return exact;
    const classId = optionalId(exact.value.classId, 'classId');
    if (!classId.ok) return classId;
    const role = optionalEnum(exact.value.role, 'role', USER_ROLES);
    if (!role.ok) return role;
    const status = optionalEnum(exact.value.status, 'status', ['active', 'disabled'] as const);
    if (!status.ok) return status;
    const keyword = optionalBoundedString(exact.value.keyword, 'keyword', 50);
    if (!keyword.ok) return keyword;
    return {
      ok: true,
      value: {
        action: request.action,
        ...(classId.value === undefined ? {} : { classId: classId.value }),
        ...(role.value === undefined ? {} : { role: role.value }),
        ...(status.value === undefined ? {} : { status: status.value }),
        ...(keyword.value === undefined ? {} : { keyword: keyword.value }),
      },
    };
  }

  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');
  const expectedVersion = parseExpectedVersion(request.expectedVersion);
  if (!expectedVersion.ok) return expectedVersion;

  switch (request.action) {
    case 'restoreWorkDraft': {
      const exact = parseExactObject(request.payload, ['studentId', 'workId', 'reason']);
      if (!exact.ok) return exact;
      const studentId = requiredId(exact.value.studentId, 'studentId');
      const workId = requiredId(exact.value.workId, 'workId');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 200);
      if (!studentId.ok) return studentId;
      if (!workId.ok) return workId;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, studentId: studentId.value,
        workId: workId.value, reason: reason.value, expectedVersion: expectedVersion.value,
        operationId: request.operationId } };
    }
    case 'setQuestionVisibility': {
      const exact = parseExactObject(request.payload, ['id', 'visibility', 'reason']);
      if (!exact.ok) return exact;
      const id = requiredId(exact.value.id, 'id');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!id.ok) return id;
      if (!reason.ok) return reason;
      const raw = parseExactObjectValue(exact.value.visibility, ['type'], ['classIds'], 'visibility');
      if (!raw.ok) return raw;
      let visibility: QuestionVisibility;
      if (raw.value.type === 'organization' && raw.value.classIds === undefined) visibility = { type: 'organization' };
      else if (raw.value.type === 'classes' && Array.isArray(raw.value.classIds)
        && raw.value.classIds.length >= 1 && raw.value.classIds.length <= 100
        && raw.value.classIds.every(id => typeof id === 'string' && id.trim() && id.length <= 128)
        && new Set(raw.value.classIds).size === raw.value.classIds.length) {
        visibility = { type: 'classes', classIds: raw.value.classIds as string[] };
      } else return invalid('visibility', '可见范围无效。');
      return { ok: true, value: { action: request.action, id: id.value, visibility,
        reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'batchSetQuestionVisibility': {
      if (expectedVersion.value !== 1) return invalid('expectedVersion', '批量操作使用条目版本号。');
      const exact = parseExactObject(request.payload, ['items', 'visibility', 'reason']);
      if (!exact.ok) return exact;
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!reason.ok) return reason;
      const raw = parseExactObjectValue(exact.value.visibility, ['type'], ['classIds'], 'visibility');
      if (!raw.ok) return raw;
      let visibility: QuestionVisibility;
      if (raw.value.type === 'organization' && raw.value.classIds === undefined) visibility = { type: 'organization' };
      else if (raw.value.type === 'classes' && Array.isArray(raw.value.classIds)
        && raw.value.classIds.length >= 1 && raw.value.classIds.length <= 100
        && raw.value.classIds.every(id => typeof id === 'string' && id.trim() && id.length <= 128)
        && new Set(raw.value.classIds).size === raw.value.classIds.length) {
        visibility = { type: 'classes', classIds: raw.value.classIds as string[] };
      } else return invalid('visibility', '可见范围无效。');
      if (!Array.isArray(exact.value.items) || exact.value.items.length < 1 || exact.value.items.length > 20) {
        return invalid('items', '每次最多处理 20 道题。');
      }
      const items: QuestionBatchItem[] = [];
      for (const [index, item] of exact.value.items.entries()) {
        const parsed = parseExactObjectValue(item, ['id', 'expectedVersion'], [], `items.${index}`);
        if (!parsed.ok) return parsed;
        const id = requiredId(parsed.value.id, `items.${index}.id`);
        if (!id.ok || !Number.isSafeInteger(parsed.value.expectedVersion)
          || Number(parsed.value.expectedVersion) < 1) return invalid(`items.${index}`, '题目与版本号无效。');
        items.push({ id: id.value, expectedVersion: Number(parsed.value.expectedVersion) });
      }
      if (new Set(items.map(item => item.id)).size !== items.length) return invalid('items', '题目不能重复选择。');
      return { ok: true, value: { action: request.action, items, visibility,
        reason: reason.value, expectedVersion: 1, operationId: request.operationId } };
    }
    case 'batchSetQuestionStatus': {
      if (expectedVersion.value !== 1) return invalid('expectedVersion', '批量操作使用条目版本号。');
      const exact = parseExactObject(request.payload, ['items', 'status', 'reason']);
      if (!exact.ok) return exact;
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!reason.ok) return reason;
      if (exact.value.status !== 'published' && exact.value.status !== 'offline') return invalid('status', '上架状态无效。');
      if (!Array.isArray(exact.value.items) || exact.value.items.length < 1 || exact.value.items.length > 20) {
        return invalid('items', '每次最多处理 20 道题。');
      }
      const items: QuestionBatchItem[] = [];
      for (const [index, raw] of exact.value.items.entries()) {
        const parsed = parseExactObjectValue(raw, ['id', 'expectedVersion'], [], `items.${index}`);
        if (!parsed.ok) return parsed;
        const id = requiredId(parsed.value.id, `items.${index}.id`);
        if (!id.ok) return id;
        if (!Number.isSafeInteger(parsed.value.expectedVersion) || Number(parsed.value.expectedVersion) < 1) {
          return invalid(`items.${index}.expectedVersion`, '题目版本号无效。');
        }
        items.push({ id: id.value, expectedVersion: Number(parsed.value.expectedVersion) });
      }
      if (new Set(items.map(item => item.id)).size !== items.length) return invalid('items', '题目不能重复选择。');
      return { ok: true, value: { action: request.action, items, status: exact.value.status,
        reason: reason.value, expectedVersion: 1, operationId: request.operationId } };
    }
    case 'createClass': {
      if (expectedVersion.value !== 1) return invalid('expectedVersion', '新建班级的初始版本号必须为 1。');
      const exact = parseExactObject(request.payload, ['name', 'grade', 'term', 'reason']);
      if (!exact.ok) return exact;
      const name = requiredBoundedString(exact.value.name, 'name', 50);
      const grade = requiredBoundedString(exact.value.grade, 'grade', 30);
      const term = requiredBoundedString(exact.value.term, 'term', 30);
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!name.ok) return name;
      if (!grade.ok) return grade;
      if (!term.ok) return term;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, name: name.value, grade: grade.value, term: term.value, reason: reason.value, expectedVersion: 1, operationId: request.operationId } };
    }
    case 'updateClass': {
      const exact = parseExactObject(request.payload, ['classId', 'name', 'grade', 'term', 'reason']);
      if (!exact.ok) return exact;
      const classId = requiredId(exact.value.classId, 'classId');
      const name = requiredBoundedString(exact.value.name, 'name', 50);
      const grade = requiredBoundedString(exact.value.grade, 'grade', 30);
      const term = requiredBoundedString(exact.value.term, 'term', 30);
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!classId.ok) return classId;
      if (!name.ok) return name;
      if (!grade.ok) return grade;
      if (!term.ok) return term;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, classId: classId.value, name: name.value, grade: grade.value, term: term.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'disableClass': {
      const exact = parseExactObject(request.payload, ['classId', 'reason']);
      if (!exact.ok) return exact;
      const classId = requiredId(exact.value.classId, 'classId');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!classId.ok) return classId;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, classId: classId.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'createUser': {
      if (expectedVersion.value !== 1) return invalid('expectedVersion', '新建用户的初始版本号必须为 1。');
      const exact = parseExactObject(request.payload, ['displayName', 'mobile', 'role', 'reason'], ['classId']);
      if (!exact.ok) return exact;
      const displayName = requiredBoundedString(exact.value.displayName, 'displayName', 50);
      if (!displayName.ok) return displayName;
      if (typeof exact.value.mobile !== 'string' || !/^1\d{10}$/.test(exact.value.mobile)) return invalid('mobile', '手机号格式无效。');
      const role = requiredEnum(exact.value.role, 'role', USER_ROLES);
      if (!role.ok) return role;
      const classId = optionalId(exact.value.classId, 'classId');
      if (!classId.ok) return classId;
      if (role.value === 'student' && classId.value === undefined) return invalid('classId', '学生账号必须选择班级。');
      if (role.value !== 'student' && classId.value !== undefined) return invalid('classId', '仅学生账号可在创建时选择班级。');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, displayName: displayName.value, mobile: exact.value.mobile, role: role.value, ...(classId.value === undefined ? {} : { classId: classId.value }), reason: reason.value, expectedVersion: 1, operationId: request.operationId } };
    }
    case 'disableUser': {
      const exact = parseExactObject(request.payload, ['userId', 'reason']);
      if (!exact.ok) return exact;
      const userId = requiredId(exact.value.userId, 'userId');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!userId.ok) return userId;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, userId: userId.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'updateUser': {
      const exact = parseExactObject(request.payload, ['userId', 'displayName', 'reason']);
      if (!exact.ok) return exact;
      const userId = requiredId(exact.value.userId, 'userId');
      const displayName = requiredBoundedString(exact.value.displayName, 'displayName', 50);
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!userId.ok) return userId;
      if (!displayName.ok) return displayName;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, userId: userId.value, displayName: displayName.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'assignRole': {
      const exact = parseExactObject(request.payload, ['userId', 'role', 'permissions', 'scopeType', 'scopeIds', 'reason']);
      if (!exact.ok) return exact;
      const userId = requiredId(exact.value.userId, 'userId');
      const role = requiredEnum(exact.value.role, 'role', USER_ROLES);
      const permissions = parseRolePermissions(exact.value.permissions);
      const scopeType = requiredEnum(exact.value.scopeType, 'scopeType', ROLE_SCOPE_TYPES);
      const scopeIds = parseIds(exact.value.scopeIds, 'scopeIds');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!userId.ok) return userId;
      if (!role.ok) return role;
      if (!permissions.ok) return permissions;
      if (!scopeType.ok) return scopeType;
      if (!scopeIds.ok) return scopeIds;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, userId: userId.value, role: role.value, permissions: permissions.value, scopeType: scopeType.value, scopeIds: scopeIds.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'revokeRole': {
      const exact = parseExactObject(request.payload, ['userId', 'role', 'reason']);
      if (!exact.ok) return exact;
      const userId = requiredId(exact.value.userId, 'userId');
      const role = requiredEnum(exact.value.role, 'role', USER_ROLES);
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!userId.ok) return userId;
      if (!role.ok) return role;
      if (!reason.ok) return reason;
      return { ok: true, value: { action: request.action, userId: userId.value, role: role.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
    case 'grantTeacherClass':
    case 'revokeTeacherClass': {
      const exact = parseExactObject(request.payload, ['teacherId', 'classId', 'reason', ...(request.action === 'grantTeacherClass' ? ['permissions'] : [])]);
      if (!exact.ok) return exact;
      const teacherId = requiredId(exact.value.teacherId, 'teacherId');
      const classId = requiredId(exact.value.classId, 'classId');
      const reason = requiredBoundedString(exact.value.reason, 'reason', 300);
      if (!teacherId.ok) return teacherId;
      if (!classId.ok) return classId;
      if (!reason.ok) return reason;
      if (request.action === 'grantTeacherClass') {
        const permissions = parseTeacherPermissions(exact.value.permissions);
        if (!permissions.ok) return permissions;
        return { ok: true, value: { action: request.action, teacherId: teacherId.value, classId: classId.value, permissions: permissions.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
      }
      return { ok: true, value: { action: request.action, teacherId: teacherId.value, classId: classId.value, reason: reason.value, expectedVersion: expectedVersion.value, operationId: request.operationId } };
    }
  }
}

function rejectQueryWriteFields<T>(request: Readonly<{ operationId?: string; expectedVersion?: number }>): ContractValidation<T> | null {
  if (request.operationId !== undefined) return invalid('operationId', '查询操作不支持操作标识。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询操作不支持版本号。');
  return null;
}

function parseExactObjectValue(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  field: string,
): ContractValidation<Readonly<Record<string, unknown>>> {
  const parsed = parseExactObject(value, requiredKeys, optionalKeys);
  if (parsed.ok) return parsed;
  const [nestedField, message] = Object.entries(parsed.fieldErrors)[0] ?? [field, '字段格式无效。'];
  return invalid(`${field}.${nestedField === 'payload' ? field : nestedField}`, message);
}

function parseAdminPage(value: unknown): ContractValidation<Readonly<{ limit: number; offset: number }>> {
  const parsed = parseExactObjectValue(value, ['limit', 'offset'], [], 'page');
  if (!parsed.ok) return parsed;
  if (!Number.isSafeInteger(parsed.value.limit) || typeof parsed.value.limit !== 'number'
    || parsed.value.limit < 1 || parsed.value.limit > 50) return invalid('page.limit', '每页数量必须为 1 到 50 的整数。');
  if (!Number.isSafeInteger(parsed.value.offset) || typeof parsed.value.offset !== 'number'
    || parsed.value.offset < 0 || parsed.value.offset > 1_000) return invalid('page.offset', '分页偏移必须为 0 到 1000 的整数。');
  return { ok: true, value: { limit: parsed.value.limit, offset: parsed.value.offset } };
}

function parseOptionalTimeRange(
  fromValue: unknown,
  toValue: unknown,
): ContractValidation<Readonly<{ from?: string; to?: string }>> {
  if (fromValue === undefined && toValue === undefined) return { ok: true, value: {} };
  if (typeof fromValue !== 'string' || typeof toValue !== 'string') return invalid('from', '起止时间必须同时提供。');
  if (!isIsoDateTime(fromValue)) return invalid('from', '开始时间必须是带时区的 ISO 8601 时间。');
  if (!isIsoDateTime(toValue)) return invalid('to', '结束时间必须是带时区的 ISO 8601 时间。');
  const fromMs = Date.parse(fromValue);
  const toMs = Date.parse(toValue);
  if (toMs < fromMs) return invalid('to', '结束时间不得早于开始时间。');
  if (toMs - fromMs > 31 * 24 * 60 * 60 * 1_000) return invalid('to', '查询时间范围不得超过 31 天。');
  return { ok: true, value: { from: fromValue, to: toValue } };
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function compactOptional<T extends Readonly<Record<string, unknown>>>(value: T): {
  readonly [K in keyof T]?: Exclude<T[K], undefined>;
} {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    readonly [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function parseTeacherPermissions(value: unknown): ContractValidation<readonly TeacherClassPermission[]> {
  if (!Array.isArray(value) || value.length === 0) return invalid('permissions', '至少选择一项教师班级权限。');
  const permissions: TeacherClassPermission[] = [];
  for (const [index, permission] of value.entries()) {
    if (typeof permission !== 'string' || !TEACHER_CLASS_PERMISSIONS.includes(permission as TeacherClassPermission)) {
      return invalid(`permissions[${index}]`, '教师班级权限无效。');
    }
    permissions.push(permission as TeacherClassPermission);
  }
  return { ok: true, value: [...new Set(permissions)] };
}

function parseRolePermissions(value: unknown): ContractValidation<readonly RolePermission[]> {
  if (!Array.isArray(value) || value.length === 0) return invalid('permissions', '至少选择一项角色权限。');
  const permissions: RolePermission[] = [];
  for (const [index, permission] of value.entries()) {
    if (typeof permission !== 'string' || !ROLE_PERMISSIONS.includes(permission as RolePermission)) {
      return invalid(`permissions[${index}]`, '角色权限无效。');
    }
    permissions.push(permission as RolePermission);
  }
  return { ok: true, value: [...new Set(permissions)] };
}

function parseIds(value: unknown, field: string): ContractValidation<readonly string[]> {
  if (!Array.isArray(value) || value.length === 0) return invalid(field, '至少选择一个数据范围。');
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = requiredId(item, `${field}[${index}]`);
    if (!parsed.ok) return parsed;
    ids.push(parsed.value);
  }
  return { ok: true, value: [...new Set(ids)] };
}

function parseExpectedVersion(value: number | undefined): ContractValidation<number> {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) return invalid('expectedVersion', '写操作必须提供正整数版本号。');
  return { ok: true, value };
}

function requiredEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): ContractValidation<T> {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return invalid(field, '字段值无效。');
  return { ok: true, value: value as T };
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): ContractValidation<T | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return requiredEnum(value, field, allowed);
}

function optionalId(value: unknown, field: string): ContractValidation<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return requiredId(value, field);
}

function optionalBoundedString(value: unknown, field: string, maximumLength: number): ContractValidation<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || value.length > maximumLength) return invalid(field, '字段格式无效。');
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length === 0 ? undefined : trimmed };
}

function requiredId(value: unknown, field: string): ContractValidation<string> {
  return requiredBoundedString(value, field, 128);
}

function requiredBoundedString(value: unknown, field: string, maximumLength: number): ContractValidation<string> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    return invalid(field, '字段格式无效。');
  }
  return { ok: true, value };
}

function invalid<T>(field: string, message: string): ContractValidation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}
