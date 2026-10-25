export type NativeAdminPermission = 'dashboard.read' | 'organization.manage' | 'user.manage'
  | 'authorization.manage' | 'textbook.manage' | 'question.manage' | 'task.manage' | 'media.review'
  | 'student_work.restore'

export interface NativeAdminAccessView {
  grantVersion: number
  permissions: NativeAdminPermission[]
  scope: { organizationWide: boolean; classIds: string[] }
}

export interface NativeAdminOrganizationView {
  id: string
  name: string
  status: 'active' | 'disabled'
  version: number
}
export interface UpdateNativeAdminOrganizationInput { name: string; reason: string }
export interface BindNativeAdminParentLinkInput { parentId: string; studentId: string; reason: string }
export interface NativeAdminBoundParentLinkView { linkId: string; status: 'active'; version: number }
export type NativeAdminUserRoleFilter = '' | 'student' | 'parent' | 'teacher' | 'admin'
export type NativeAdminUserStatusFilter = '' | 'active' | 'disabled'
export interface CreateNativeAdminUserInput { displayName: string; mobile: string;
  role: 'student' | 'parent' | 'teacher' | 'admin'; classId: string; reason: string }
export interface NativeAdminCreatedUserView { id: string; displayName: string;
  role: 'student' | 'parent' | 'teacher' | 'admin'; status: 'active';
  version: number; setupStatus: 'self_service_required' }

export interface NativeAdminOverviewView {
  organizationCount: number
  classCount: number
  userCount: number | null
  taskCount: number | null
  activeTaskCount: number | null
  pendingReviewCount: number | null
}

export interface NativeAdminRecordFilter {
  query?: string
  status?: string
  taskType?: 'all' | 'classroom' | 'activity'
  mediaKind?: '' | 'listening' | 'video' | 'dubbing'
  from?: string
  to?: string
}
export interface NativeAdminOverviewRange { from: string; to: string }

export interface NativeAdminAuditPageView {
  items: Array<{ id: string; action: string; targetType: string; targetId: string;
    result: 'succeeded' | 'denied' | 'failed'; occurredAt: string; actorUserId: string }>
  nextOffset: number | null
}

export interface NativeAdminClassPageView {
  items: Array<{ id: string; name: string; grade: string; term: string;
    status: 'active' | 'disabled'; studentCount: number | null;
    teacherIds: string[]; teacherAssignments: Array<{ teacherId: string;
      permissions: NativeAdminTeacherClassPermission[]; status: 'active' | 'revoked'; version: number }>;
    version: number }>
  nextOffset: number | null
}

export type NativeAdminSelectionKind = 'class_for_user' | 'class_for_grant'
  | 'teacher_for_class' | 'parent_for_binding' | 'student_for_binding'
export interface NativeAdminSelectionPageView {
  items: Array<{ id: string; label: string; detail: string }>
  nextOffset: number | null
}

export interface NativeAdminUserPageView {
  items: Array<{ id: string; displayName: string; roleLabel: string;
    status: 'active' | 'disabled'; version: number; bindingCount: number;
    studentNumber?: string; mobileMasked?: string; role: string;
    classNames: string[]; lastLoginAt: string | null }>
  nextOffset: number | null
}

export interface NativeAdminUserBindingsView { userId: string; items: Array<{ id: string;
  parentId: string; parentName: string; studentId: string; studentName: string;
  status: 'active' | 'revoked'; confirmedAt: string | null; version: number }> }
export interface UnbindNativeAdminUserInput { linkId: string; reason: string }
export interface NativeAdminUnbindView { linkId: string; status: 'revoked'; version: number }

export type NativeAdminTeacherClassPermission = 'class.read' | 'student.read' | 'student.manage'
  | 'student.bind-code.issue' | 'content.read' | 'task.read' | 'task.publish'
  | 'submission.review' | 'student.import' | 'media.upload'

export interface CreateNativeAdminClassInput { name: string; grade: number; term: string; reason: string }
export interface UpdateNativeAdminClassInput extends CreateNativeAdminClassInput { classId: string }
export interface ArchiveNativeAdminClassInput { classId: string; destinationClassId: string | null; reason: string }
export interface AssignNativeAdminTeacherInput { classId: string; teacherId: string;
  permissions: NativeAdminTeacherClassPermission[]; reason: string }
export interface RevokeNativeAdminTeacherInput { classId: string; teacherId: string; reason: string }
export interface UpdateNativeAdminUserInput { userId: string; displayName: string; reason: string }
export interface DisableNativeAdminUserInput { userId: string; reason: string }

export interface NativeAdminClassMutationView { id: string; name: string; grade: number;
  term: string; status: 'active' | 'disabled'; version: number }
export interface NativeAdminClassArchiveView { id: string; status: 'disabled';
  migratedStudentCount: number; destinationClassId: string | null; version: number }
export interface NativeAdminTeacherAssignmentView { classId: string; teacherId: string;
  permissions: NativeAdminTeacherClassPermission[]; version: number }
export interface NativeAdminUserMutationView { id: string; displayName: string;
  status: 'active' | 'disabled'; version: number }

export interface NativeAdminDeletedWorkPageView {
  items: Array<{ id: string; studentId: string; materialTitle: string | null;
    deletedAt: string; recoverableUntil: string; restorable: boolean;
    blockedReason: 'expired' | 'cleanup_locked' | 'staging_deleted' | 'invalid_record' | null;
    version: number }>
  nextOffset: number | null
}

export interface NativeAdminRestoredWorkView { id: string; studentId: string;
  materialId: string; version: number; restoredAt: string; restoredByUserId: string }

export interface SaveNativeTextbookConfigInput { resourceId: string; classIds: string[]; reason: string }
export interface SetNativeTextbookConfigStatusInput { resourceId: string;
  status: 'published' | 'disabled'; reason: string }
export interface NativeTextbookConfigView { resourceId: string; classIds: string[];
  status: 'draft' | 'published' | 'disabled'; version: number }
export interface SetNativeQuestionStatusInput { questionId: string;
  status: 'published' | 'offline'; reason: string }
export interface NativeQuestionStatusView { questionId: string; status: 'published' | 'offline'; version: number }
export interface SetNativeQuestionBatchStatusInput { status: 'published' | 'offline';
  questions: Array<{ questionId: string; expectedVersion: number }>; reason: string }
export interface NativeQuestionBatchStatusView { status: 'published' | 'offline'; changedCount: number;
  items: Array<{ questionId: string; version: number }> }
export interface SetNativeQuestionVisibilityInput { questionId: string; organizationWide: boolean;
  classIds: string[]; reason: string }
export interface NativeQuestionVisibilityView { questionId: string; organizationWide: boolean;
  classIds: string[]; version: number }
export interface StopNativeManagedInput { kind: 'classroom' | 'activity'; id: string; reason: string }
export interface NativeManagedStopView { kind: 'classroom' | 'activity'; id: string;
  status: string; version: number }
export interface NativeAdminRecordsExportView { fileName: string; csv: string; rowCount: number }
export interface NativeAdminMediaReviewSummaryView {
  id: string
  title: string
  kind: 'listening' | 'video' | 'dubbing'
  status: string
  statusLabel: string
  recordVersion: number
  scanStatus: 'pending' | 'clean' | 'failed'
  transcodeStatus: 'pending' | 'ready' | 'failed'
  sourceScanEvidencePresent: boolean
  outputScanEvidencePresent: boolean
  transcodeEvidencePresent: boolean
  copyrightEvidencePresent: boolean
  questionCount: number
  clipCount: number
  subtitleCount: number
  continuousPlaybackEnforced: boolean
  allowedClassIds: string[]
  reviewerIsOwner: boolean
}
export interface NativeAdminMediaReviewInput { mediaId: string;
  decision: 'approved' | 'rejected'; reason: string }
export interface NativeAdminMediaActionView { id: string; status: string;
  recordVersion: number; reviewVersion: number | null }

export interface NativeAdminMediaPreviewView {
  id: string
  kind: 'listening' | 'video' | 'dubbing'
  temporaryUrl: string
  expiresAt: string
  clips: Array<{ questionId: string; segmentId: string; startMs: number; endMs: number }>
  subtitles: Array<{ startMs: number; endMs: number; text: string; translationText?: string }>
}

export interface NativeAdminMediaAuditPageView {
  items: Array<{ id: string; action: string; actorUserId: string;
    occurredAt: string; issueReason: string | null }>
  nextOffset: number | null
}

export interface NativeAdminGrantPageView {
  items: Array<{ teacherId: string; status: 'active' | 'revoked';
    permissions: NativeAdminPermission[]; classIds: string[];
    organizationWide: boolean; version: number; userVersion: number }>
  nextOffset: number | null
}

export interface NativeAdminGrantCandidatePageView {
  items: Array<{ teacherId: string; displayName: string; userVersion: number;
    authorizationVersion: number; grantVersion: number;
    grantStatus: 'none' | 'active' | 'revoked';
    permissions: NativeAdminPermission[];
    scope: { organizationWide: boolean; classIds: string[] } }>
  nextOffset: number | null
}

export interface NativeAdminGrantInput {
  teacherId: string
  status: 'active' | 'revoked'
  permissions: NativeAdminPermission[]
  scope: { organizationWide: boolean; classIds: string[] }
  expectedUserVersion: number
  reason: string
}

export interface NativeAdminGrantView {
  organizationId: string
  teacherId: string
  status: 'active' | 'revoked'
  permissions: NativeAdminPermission[]
  scope: { organizationWide: boolean; classIds: string[] }
  version: number
}

export type NativeAdminRecordKind = 'textbooks' | 'questions' | 'tasks' | 'media'

export interface NativeAdminRecordPageView {
  items: Array<{ id: string; kind: 'textbook' | 'question' | 'classroom' | 'activity' | 'media';
    title: string; status: string; statusLabel: string; detail: string; version: number;
    classIds?: string[]; organizationWide?: boolean; creatorLabel?: string; classLabel?: string;
    startsAt?: string; dueAt?: string; participantCount?: number;
    completedCount?: number; pendingReviewCount?: number }>
  nextOffset: number | null
}

export interface NativeAdminQuestionPreviewView { id: string; title: string; version: number;
  questionType: string; stem: string; answer: string; explanation: string;
  organizationWide: boolean; classIds: string[] }
