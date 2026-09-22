import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type {
  TeacherStudentFilters,
  TeacherStudentPageRequest,
  SetTeacherStudentStatusCommand,
  TransferTeacherStudentCommand,
  UpdateTeacherStudentProfileCommand,
} from '../teacher-students/types';

export const TEACHER_STUDENT_QUERY_ACTIONS = ['listStudents', 'getStudent'] as const;
export type TeacherStudentQueryAction = (typeof TEACHER_STUDENT_QUERY_ACTIONS)[number];

export type TeacherStudentQueryInput =
  | Readonly<{ action: 'listStudents'; filters: TeacherStudentFilters; page: TeacherStudentPageRequest }>
  | Readonly<{ action: 'getStudent'; studentId: string }>;

export const TEACHER_STUDENT_COMMAND_ACTIONS = ['updateProfile', 'setStatus', 'transfer'] as const;
export type TeacherStudentCommandAction = (typeof TEACHER_STUDENT_COMMAND_ACTIONS)[number];

export type TeacherStudentCommandInput =
  | Readonly<{ action: 'updateProfile'; command: UpdateTeacherStudentProfileCommand }>
  | Readonly<{ action: 'setStatus'; command: SetTeacherStudentStatusCommand }>
  | Readonly<{ action: 'transfer'; command: TransferTeacherStudentCommand }>;

export type TeacherStudentContractValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function validateTeacherStudentQueryRequest(
  request: FunctionRequest<TeacherStudentQueryAction, JsonObject>,
): TeacherStudentContractValidation<TeacherStudentQueryInput> {
  if (request.operationId !== undefined) return invalid('operationId', '查询操作不支持操作标识。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询操作不支持版本号。');

  if (request.action === 'getStudent') {
    const exact = parseExactObject(request.payload, ['studentId']);
    if (!exact.ok) return exact;
    const studentId = requiredString(exact.value.studentId, 'studentId', 128);
    return studentId.ok ? { ok: true, value: { action: request.action, studentId: studentId.value } } : studentId;
  }

  const exact = parseExactObject(request.payload, ['filters', 'page']);
  if (!exact.ok) return exact;
  const filtersObject = parseExactObject(exact.value.filters, ['status'], ['classId', 'keyword']);
  if (!filtersObject.ok) return prefixErrors(filtersObject, 'filters');
  const pageObject = parseExactObject(exact.value.page, ['limit'], ['cursor']);
  if (!pageObject.ok) return prefixErrors(pageObject, 'page');
  const status = filtersObject.value.status;
  if (status !== 'all' && status !== 'normal' && status !== 'attention' && status !== 'disabled') {
    return invalid('filters.status', '学员状态筛选无效。');
  }
  const classId = optionalString(filtersObject.value.classId, 'filters.classId', 128);
  if (!classId.ok) return classId;
  const keyword = optionalString(filtersObject.value.keyword, 'filters.keyword', 50);
  if (!keyword.ok) return keyword;
  const limit = pageObject.value.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return invalid('page.limit', '每页数量必须为 1—50 的整数。');
  }
  const cursor = optionalString(pageObject.value.cursor, 'page.cursor', 512);
  if (!cursor.ok) return cursor;
  return {
    ok: true,
    value: {
      action: request.action,
      filters: {
        status,
        ...(classId.value === undefined ? {} : { classId: classId.value }),
        ...(keyword.value === undefined ? {} : { keyword: keyword.value }),
      },
      page: { limit, ...(cursor.value === undefined ? {} : { cursor: cursor.value }) },
    },
  };
}

export function validateTeacherStudentCommandRequest(
  request: FunctionRequest<TeacherStudentCommandAction, JsonObject>,
): TeacherStudentContractValidation<TeacherStudentCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');
  if (request.expectedVersion === undefined) return invalid('expectedVersion', '写操作必须提供当前学生版本。');

  if (request.action === 'updateProfile') {
    const exact = parseExactObject(
      request.payload,
      ['studentId', 'classId', 'displayName', 'expectedMembershipVersion', 'reason'],
    );
    if (!exact.ok) return exact;
    const studentId = requiredString(exact.value.studentId, 'studentId', 128);
    const classId = requiredString(exact.value.classId, 'classId', 128);
    const displayName = requiredString(exact.value.displayName, 'displayName', 50);
    const expectedMembershipVersion = positiveVersion(exact.value.expectedMembershipVersion, 'expectedMembershipVersion');
    const reason = requiredString(exact.value.reason, 'reason', 200);
    if (!studentId.ok) return studentId;
    if (!classId.ok) return classId;
    if (!displayName.ok) return displayName;
    if (!expectedMembershipVersion.ok) return expectedMembershipVersion;
    if (!reason.ok) return reason;
    return {
      ok: true,
      value: {
        action: request.action,
        command: {
          studentId: studentId.value,
          classId: classId.value,
          displayName: displayName.value,
          expectedUserVersion: request.expectedVersion,
          expectedMembershipVersion: expectedMembershipVersion.value,
          reason: reason.value,
          operationId: request.operationId,
        },
      },
    };
  }

  if (request.action === 'setStatus') {
    const exact = parseExactObject(
      request.payload,
      ['studentId', 'classId', 'status', 'expectedMembershipVersion', 'expectedClassVersion', 'reason'],
    );
    if (!exact.ok) return exact;
    const studentId = requiredString(exact.value.studentId, 'studentId', 128);
    const classId = requiredString(exact.value.classId, 'classId', 128);
    const expectedMembershipVersion = positiveVersion(exact.value.expectedMembershipVersion, 'expectedMembershipVersion');
    const expectedClassVersion = positiveVersion(exact.value.expectedClassVersion, 'expectedClassVersion');
    const reason = requiredString(exact.value.reason, 'reason', 200);
    if (!studentId.ok) return studentId;
    if (!classId.ok) return classId;
    if (exact.value.status !== 'active' && exact.value.status !== 'disabled') {
      return invalid('status', '账号状态无效。');
    }
    if (!expectedMembershipVersion.ok) return expectedMembershipVersion;
    if (!expectedClassVersion.ok) return expectedClassVersion;
    if (!reason.ok) return reason;
    return {
      ok: true,
      value: {
        action: request.action,
        command: {
          studentId: studentId.value,
          classId: classId.value,
          status: exact.value.status,
          expectedUserVersion: request.expectedVersion,
          expectedMembershipVersion: expectedMembershipVersion.value,
          expectedClassVersion: expectedClassVersion.value,
          reason: reason.value,
          operationId: request.operationId,
        },
      },
    };
  }

  const exact = parseExactObject(request.payload, [
    'studentId',
    'sourceClassId',
    'targetClassId',
    'expectedMembershipVersion',
    'expectedTargetMembershipVersion',
    'expectedSourceClassVersion',
    'expectedTargetClassVersion',
    'reason',
  ]);
  if (!exact.ok) return exact;
  const studentId = requiredString(exact.value.studentId, 'studentId', 128);
  const sourceClassId = requiredString(exact.value.sourceClassId, 'sourceClassId', 128);
  const targetClassId = requiredString(exact.value.targetClassId, 'targetClassId', 128);
  const expectedMembershipVersion = positiveVersion(exact.value.expectedMembershipVersion, 'expectedMembershipVersion');
  const expectedTargetMembershipVersion = nonNegativeVersion(
    exact.value.expectedTargetMembershipVersion,
    'expectedTargetMembershipVersion',
  );
  const expectedSourceClassVersion = positiveVersion(exact.value.expectedSourceClassVersion, 'expectedSourceClassVersion');
  const expectedTargetClassVersion = positiveVersion(exact.value.expectedTargetClassVersion, 'expectedTargetClassVersion');
  const reason = requiredString(exact.value.reason, 'reason', 200);
  if (!studentId.ok) return studentId;
  if (!sourceClassId.ok) return sourceClassId;
  if (!targetClassId.ok) return targetClassId;
  if (sourceClassId.value === targetClassId.value) return invalid('targetClassId', '目标班级必须与当前班级不同。');
  if (!expectedMembershipVersion.ok) return expectedMembershipVersion;
  if (!expectedTargetMembershipVersion.ok) return expectedTargetMembershipVersion;
  if (!expectedSourceClassVersion.ok) return expectedSourceClassVersion;
  if (!expectedTargetClassVersion.ok) return expectedTargetClassVersion;
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: {
      action: request.action,
      command: {
        studentId: studentId.value,
        sourceClassId: sourceClassId.value,
        targetClassId: targetClassId.value,
        expectedUserVersion: request.expectedVersion,
        expectedMembershipVersion: expectedMembershipVersion.value,
        expectedTargetMembershipVersion: expectedTargetMembershipVersion.value,
        expectedSourceClassVersion: expectedSourceClassVersion.value,
        expectedTargetClassVersion: expectedTargetClassVersion.value,
        reason: reason.value,
        operationId: request.operationId,
      },
    },
  };
}

function requiredString(value: unknown, field: string, maxLength: number): TeacherStudentContractValidation<string> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    return invalid(field, '字段格式无效。');
  }
  return { ok: true, value: value.trim() };
}

function optionalString(value: unknown, field: string, maxLength: number): TeacherStudentContractValidation<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || value.length > maxLength) return invalid(field, '字段格式无效。');
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length === 0 ? undefined : trimmed };
}

function positiveVersion(value: unknown, field: string): TeacherStudentContractValidation<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalid(field, '版本号必须是正整数。');
  }
  return { ok: true, value };
}

function nonNegativeVersion(value: unknown, field: string): TeacherStudentContractValidation<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalid(field, '版本号必须是非负整数。');
  }
  return { ok: true, value };
}

function invalid<T>(field: string, message: string): TeacherStudentContractValidation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}

function prefixErrors<T>(
  result: Readonly<{ ok: false; fieldErrors: Readonly<Record<string, string>> }>,
  prefix: string,
): TeacherStudentContractValidation<T> {
  return {
    ok: false,
    fieldErrors: Object.fromEntries(Object.entries(result.fieldErrors).map(([field, message]) => [`${prefix}.${field}`, message])),
  };
}
