import type { FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseExactObject } from '../../src/shared/strict-object';
import { createMeta, failure, success } from '../../src/shared/result';
import type { TeacherStudentBulkImportService, TeacherStudentBulkImportResult } from '../../src/teacher-students/bulk-import-command';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export const TEACHER_STUDENT_IMPORT_ACTIONS = ['importTeacherStudents'] as const;
type ImportAction = (typeof TEACHER_STUDENT_IMPORT_ACTIONS)[number];

export function validateTeacherStudentImportRequest(request: FunctionRequest<ImportAction, JsonObject>) {
  if (request.expectedVersion !== undefined || typeof request.operationId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(request.operationId)) {
    return { ok: false as const, fieldErrors: { operationId: '需要有效的导入操作号。' } };
  }
  const exact = parseExactObject(request.payload, ['csvBase64']);
  if (!exact.ok) return exact;
  const encoded = exact.value.csvBase64;
  if (typeof encoded !== 'string' || !encoded || encoded.length > 1_400_000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return { ok: false as const, fieldErrors: { csvBase64: 'CSV 文件编码无效或超过限制。' } };
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > 1024 * 1024 || bytes.toString('base64') !== encoded) {
    return { ok: false as const, fieldErrors: { csvBase64: 'CSV 文件编码无效或超过限制。' } };
  }
  return { ok: true as const, value: { bytes: new Uint8Array(bytes), operationId: request.operationId } };
}

export interface TeacherStudentImportFunctionDependencies extends TrustedFunctionDependencies {
  readonly service: Pick<TeacherStudentBulkImportService, 'execute'>;
}

export function createTeacherStudentImportFunction(dependencies: TeacherStudentImportFunctionDependencies) {
  return createTrustedFunction('teacher-student-import-command', TEACHER_STUDENT_IMPORT_ACTIONS,
    dependencies, validateTeacherStudentImportRequest,
    async (input, actor): Promise<ServiceResult<JsonObject>> => {
      const result = await dependencies.service.execute(actor, input.bytes, input.operationId);
      return mapImportResult(result, dependencies);
    });
}

function mapImportResult(result: TeacherStudentBulkImportResult,
  dependencies: TrustedFunctionDependencies): ServiceResult<JsonObject> {
  const meta = createMeta(dependencies.clock, dependencies.requestIds);
  if (!result.ok) return failure(result.code, meta);
  return success<JsonObject>({ fileDigest: result.fileDigest, totalRowCount: result.totalRowCount,
    outcomes: result.outcomes.map(row => ({ ...row })),
    validationErrors: result.validationErrors.map(row => ({ ...row })) }, meta);
}
