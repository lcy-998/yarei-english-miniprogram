import type { ServiceResult } from '../../../domain/types'
import type { NativeAdminAccessView, NativeAdminClassPageView, NativeAdminGrantPageView,
  NativeAdminGrantInput, NativeAdminGrantView,
  NativeAdminRecordFilter, NativeAdminRecordKind, NativeAdminRecordPageView,
  NativeAdminSelectionKind, NativeAdminSelectionPageView,
  NativeAdminAuditPageView, NativeAdminQuestionPreviewView,
  NativeAdminOverviewRange,
  NativeAdminOverviewView, NativeAdminUserPageView,
  ArchiveNativeAdminClassInput, CreateNativeAdminClassInput, UpdateNativeAdminClassInput,
  AssignNativeAdminTeacherInput, RevokeNativeAdminTeacherInput, UpdateNativeAdminUserInput,
  DisableNativeAdminUserInput,
  NativeAdminClassArchiveView, NativeAdminClassMutationView, NativeAdminTeacherAssignmentView,
  NativeAdminUserMutationView } from '../../../domain/native-admin'
import type { NativeAdminDeletedWorkPageView, NativeAdminRestoredWorkView } from '../../../domain/native-admin'
import type { SaveNativeTextbookConfigInput, NativeTextbookConfigView,
  SetNativeTextbookConfigStatusInput, SetNativeQuestionStatusInput, NativeQuestionStatusView,
  SetNativeQuestionVisibilityInput, NativeQuestionVisibilityView,
  SetNativeQuestionBatchStatusInput, NativeQuestionBatchStatusView,
  NativeAdminUserBindingsView, UnbindNativeAdminUserInput, NativeAdminUnbindView,
  StopNativeManagedInput, NativeManagedStopView } from '../../../domain/native-admin'
import type { NativeAdminRecordsExportView } from '../../../domain/native-admin'
import type { NativeAdminGrantCandidatePageView } from '../../../domain/native-admin'
import type { NativeAdminOrganizationView, UpdateNativeAdminOrganizationInput,
  BindNativeAdminParentLinkInput, NativeAdminBoundParentLinkView,
  NativeAdminUserRoleFilter, NativeAdminUserStatusFilter, CreateNativeAdminUserInput,
  NativeAdminCreatedUserView } from '../../../domain/native-admin'
import type { NativeAdminMediaReviewSummaryView, NativeAdminMediaReviewInput,
  NativeAdminMediaActionView, NativeAdminMediaPreviewView,
  NativeAdminMediaAuditPageView } from '../../../domain/native-admin'
import { getCloudAppService } from '../../../repositories/repository-factory'

export async function getNativeAdminAccess(userId: string): Promise<ServiceResult<NativeAdminAccessView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminAccess(userId)
    : { ok: false, error: { code: 'FORBIDDEN', message: '当前账号没有管理工作区授权', retryable: false } }
}

export async function getNativeAdminOrganization(userId: string): Promise<ServiceResult<NativeAdminOrganizationView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminOrganization(userId) : unavailable()
}

export async function updateNativeAdminOrganization(userId: string,
  input: UpdateNativeAdminOrganizationInput, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeAdminOrganizationView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.updateNativeAdminOrganization(userId, input, expectedVersion, operationId) : unavailable()
}

export async function bindNativeAdminParentLink(userId: string,
  input: BindNativeAdminParentLinkInput,
  operationId: string): Promise<ServiceResult<NativeAdminBoundParentLinkView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.bindNativeAdminParentLink(userId, input, operationId) : unavailable()
}

export async function createNativeAdminUser(userId: string,
  input: CreateNativeAdminUserInput,
  operationId: string): Promise<ServiceResult<NativeAdminCreatedUserView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.createNativeAdminUser(userId, input, operationId) : unavailable()
}

function unavailable<T>(): ServiceResult<T> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '管理数据需要受保护的云端服务，当前尚未开放', retryable: false } }
}

export async function getNativeAdminOverview(userId: string, range?: NativeAdminOverviewRange): Promise<ServiceResult<NativeAdminOverviewView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminOverview(userId, range) : unavailable()
}

export async function listNativeAdminClasses(userId: string, limit = 20,
  offset = 0, query = ''): Promise<ServiceResult<NativeAdminClassPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminClasses(userId, limit, offset, query) : unavailable()
}

export async function listNativeAdminSelectionOptions(userId: string,
  kind: NativeAdminSelectionKind, classId = '', limit = 20, offset = 0,
  query = ''): Promise<ServiceResult<NativeAdminSelectionPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminSelectionOptions(userId, kind, classId, limit, offset, query)
    : unavailable()
}

export async function listNativeAdminUsers(userId: string, classId: string,
  limit = 20, offset = 0, query = '', role: NativeAdminUserRoleFilter = '',
  status: NativeAdminUserStatusFilter = ''): Promise<ServiceResult<NativeAdminUserPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminUsers(userId, classId, limit, offset, query, role, status) : unavailable()
}

export async function listNativeAdminGrants(userId: string, limit = 20,
  offset = 0, query = ''): Promise<ServiceResult<NativeAdminGrantPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminGrants(userId, limit, offset, query) : unavailable()
}

export async function listNativeAdminGrantCandidates(userId: string, limit = 20,
  offset = 0, query = ''): Promise<ServiceResult<NativeAdminGrantCandidatePageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminGrantCandidates(userId, limit, offset, query) : unavailable()
}

export async function listNativeAdminAudit(userId: string, limit = 20,
  offset = 0): Promise<ServiceResult<NativeAdminAuditPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminAudit(userId, limit, offset) : unavailable()
}

export async function getNativeAdminQuestionPreview(userId: string,
  questionId: string): Promise<ServiceResult<NativeAdminQuestionPreviewView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminQuestionPreview(userId, questionId) : unavailable()
}

export async function getNativeAdminUserBindings(userId: string, targetUserId: string): Promise<ServiceResult<NativeAdminUserBindingsView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminUserBindings(userId, targetUserId) : unavailable()
}

export async function listNativeAdminRecords(userId: string, kind: NativeAdminRecordKind,
  limit = 20, offset = 0, filter?: NativeAdminRecordFilter): Promise<ServiceResult<NativeAdminRecordPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminRecords(userId, kind, limit, offset, filter) : unavailable()
}

export async function setNativeAdminGrant(userId: string, input: NativeAdminGrantInput,
  expectedGrantVersion: number, operationId: string): Promise<ServiceResult<NativeAdminGrantView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.setNativeAdminGrant(userId, input, expectedGrantVersion, operationId) : unavailable()
}

export async function createNativeAdminClass(userId: string, input: CreateNativeAdminClassInput,
  operationId: string): Promise<ServiceResult<NativeAdminClassMutationView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.createNativeAdminClass(userId, input, 0, operationId) : unavailable()
}

export async function updateNativeAdminClass(userId: string, input: UpdateNativeAdminClassInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminClassMutationView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.updateNativeAdminClass(userId, input, expectedVersion, operationId) : unavailable()
}

export async function archiveNativeAdminClass(userId: string, input: ArchiveNativeAdminClassInput,
  expectedVersion: number, destinationExpectedVersion: number | null,
  operationId: string): Promise<ServiceResult<NativeAdminClassArchiveView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.archiveNativeAdminClass(userId, input, expectedVersion,
    destinationExpectedVersion, operationId) : unavailable()
}

export async function assignNativeAdminTeacher(userId: string, input: AssignNativeAdminTeacherInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminTeacherAssignmentView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.assignNativeAdminTeacher(userId, input, expectedVersion, operationId) : unavailable()
}

export async function revokeNativeAdminTeacher(userId: string,
  input: RevokeNativeAdminTeacherInput, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeAdminTeacherAssignmentView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.revokeNativeAdminTeacher(userId, input, expectedVersion, operationId) : unavailable()
}

export async function updateNativeAdminUser(userId: string, input: UpdateNativeAdminUserInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminUserMutationView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.updateNativeAdminUser(userId, input, expectedVersion, operationId) : unavailable()
}

export async function disableNativeAdminUser(userId: string, input: DisableNativeAdminUserInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminUserMutationView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.disableNativeAdminUser(userId, input, expectedVersion, operationId) : unavailable()
}

export async function unbindNativeAdminUser(userId: string, input: UnbindNativeAdminUserInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminUnbindView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.unbindNativeAdminUser(userId, input, expectedVersion, operationId) : unavailable()
}

export async function listNativeAdminDeletedWorks(userId: string, studentId: string,
  limit = 20, offset = 0): Promise<ServiceResult<NativeAdminDeletedWorkPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminDeletedWorks(userId, studentId, limit, offset) : unavailable()
}

export async function restoreNativeAdminWork(userId: string,
  input: { studentId: string; workId: string; reason: string }, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeAdminRestoredWorkView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.restoreNativeAdminWork(userId, input, expectedVersion, operationId) : unavailable()
}

export async function saveNativeTextbookConfig(userId: string, input: SaveNativeTextbookConfigInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeTextbookConfigView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.saveNativeTextbookConfig(userId, input, expectedVersion, operationId) : unavailable()
}

export async function setNativeTextbookConfigStatus(userId: string,
  input: SetNativeTextbookConfigStatusInput, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeTextbookConfigView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.setNativeTextbookConfigStatus(userId, input, expectedVersion, operationId) : unavailable()
}

export async function setNativeQuestionStatus(userId: string, input: SetNativeQuestionStatusInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeQuestionStatusView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.setNativeQuestionStatus(userId, input, expectedVersion, operationId) : unavailable()
}

export async function setNativeQuestionVisibility(userId: string,
  input: SetNativeQuestionVisibilityInput, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeQuestionVisibilityView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.setNativeQuestionVisibility(userId, input, expectedVersion, operationId) : unavailable()
}

export async function setNativeQuestionBatchStatus(userId: string,
  input: SetNativeQuestionBatchStatusInput, operationId: string): Promise<ServiceResult<NativeQuestionBatchStatusView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.setNativeQuestionBatchStatus(userId, input, operationId) : unavailable()
}

export async function stopNativeManaged(userId: string, input: StopNativeManagedInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeManagedStopView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.stopNativeManaged(userId, input, expectedVersion, operationId) : unavailable()
}

export async function exportNativeAdminRecords(userId: string,
  kind: 'tasks', filter?: NativeAdminRecordFilter): Promise<ServiceResult<NativeAdminRecordsExportView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.exportNativeAdminRecords(userId, kind, filter) : unavailable()
}

export async function getNativeAdminMediaReview(userId: string,
  mediaId: string): Promise<ServiceResult<NativeAdminMediaReviewSummaryView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminMediaReview(userId, mediaId) : unavailable()
}

export async function getNativeAdminMediaPreview(userId: string,
  mediaId: string): Promise<ServiceResult<NativeAdminMediaPreviewView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getNativeAdminMediaPreview(userId, mediaId) : unavailable()
}

export async function listNativeAdminMediaAudit(userId: string, mediaId: string,
  limit = 20, offset = 0): Promise<ServiceResult<NativeAdminMediaAuditPageView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listNativeAdminMediaAudit(userId, mediaId, limit, offset) : unavailable()
}

export async function reportNativeAdminMediaIssue(userId: string, mediaId: string,
  reason: string, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.reportNativeAdminMediaIssue(userId, mediaId, reason,
    expectedVersion, operationId) : unavailable()
}

export async function reviewNativeAdminMedia(userId: string, input: NativeAdminMediaReviewInput,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.reviewNativeAdminMedia(userId, input, expectedVersion, operationId) : unavailable()
}

export async function publishNativeAdminMedia(userId: string, mediaId: string,
  expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.publishNativeAdminMedia(userId, mediaId, expectedVersion, operationId) : unavailable()
}

export async function unpublishNativeAdminMedia(userId: string, mediaId: string,
  reason: string, expectedVersion: number,
  operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.unpublishNativeAdminMedia(userId, mediaId, reason, expectedVersion, operationId) : unavailable()
}
