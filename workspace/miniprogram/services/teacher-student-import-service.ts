import type { ServiceResult } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'

export interface TeacherStudentBulkImportView {
  fileDigest: string
  totalRowCount: number
  outcomes: Array<
    | { lineNumber: number; status: 'created'; studentId: string; classId: string }
    | { lineNumber: number; status: 'rejected' | 'failed'; code: string }
  >
  validationErrors: Array<{ lineNumber: number; field: string; code: string; message: string }>
}

/** Account creation is only available through the protected CloudBase command. */
export async function importTeacherStudents(userId: string, csvBase64: string,
  operationId: string): Promise<ServiceResult<TeacherStudentBulkImportView>> {
  const cloud = getCloudAppService()
  if (!cloud) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '正式批量导入需要受保护的账号服务，当前尚未开放', retryable: false } }
  return cloud.importTeacherStudents(userId, csvBase64, operationId)
}
