import type { AssignmentStatus } from '../task-core/types';

export type TeacherStudentStatusFilter = 'all' | 'normal' | 'attention' | 'disabled';

export interface TeacherStudentFilters {
  readonly classId?: string;
  readonly keyword?: string;
  readonly status: TeacherStudentStatusFilter;
}

export interface TeacherStudentPageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface TeacherStudentClassOption {
  readonly id: string;
  readonly name: string;
  readonly grade: string;
  readonly term: string;
  readonly version?: number;
}

export interface TeacherStudentPerformanceSummary {
  readonly assignedCount: number;
  readonly completedCount: number;
  readonly overdueCount: number;
  readonly redoCount: number;
  readonly completionRate: number;
  readonly averageScore: number | null;
}

export interface TeacherStudentListItem {
  readonly studentId: string;
  readonly displayName: string;
  readonly studentNumber: string;
  readonly accountStatus: 'active' | 'disabled';
  readonly needsAttention: boolean;
  readonly classInfo: TeacherStudentClassOption;
  readonly performance: TeacherStudentPerformanceSummary;
}

export interface TeacherStudentPage {
  readonly classes: readonly TeacherStudentClassOption[];
  readonly items: readonly TeacherStudentListItem[];
  readonly total: number;
  readonly nextCursor: string | null;
}

export interface TeacherStudentParentSummary {
  readonly linkId: string;
  readonly displayNameMasked: string;
  readonly mobileMasked: string | null;
  readonly confirmedAt: string;
}

export interface TeacherStudentTaskItem {
  readonly taskId: string;
  readonly title: string;
  readonly status: AssignmentStatus;
  readonly submittedAt: string | null;
  readonly score: number | null;
}

export interface TeacherStudentDetail {
  readonly studentId: string;
  readonly displayName: string;
  readonly studentNumber: string;
  readonly accountStatus: 'active' | 'disabled';
  readonly needsAttention: boolean;
  readonly classInfo: TeacherStudentClassOption;
  readonly parents: readonly TeacherStudentParentSummary[];
  readonly performance: TeacherStudentPerformanceSummary;
  readonly recentTasks: readonly TeacherStudentTaskItem[];
  readonly userVersion?: number;
  readonly membershipVersion?: number;
  readonly membershipVersions?: Readonly<Record<string, number>>;
}

export interface UpdateTeacherStudentProfileCommand {
  readonly studentId: string;
  readonly classId: string;
  readonly displayName: string;
  readonly expectedUserVersion: number;
  readonly expectedMembershipVersion: number;
  readonly reason: string;
  readonly operationId: string;
}

export interface SetTeacherStudentStatusCommand {
  readonly studentId: string;
  readonly classId: string;
  readonly status: 'active' | 'disabled';
  readonly expectedUserVersion: number;
  readonly expectedMembershipVersion: number;
  readonly expectedClassVersion: number;
  readonly reason: string;
  readonly operationId: string;
}

export interface TransferTeacherStudentCommand {
  readonly studentId: string;
  readonly sourceClassId: string;
  readonly targetClassId: string;
  readonly expectedUserVersion: number;
  readonly expectedMembershipVersion: number;
  readonly expectedTargetMembershipVersion: number;
  readonly expectedSourceClassVersion: number;
  readonly expectedTargetClassVersion: number;
  readonly reason: string;
  readonly operationId: string;
}

export interface TeacherStudentMutationReceipt {
  readonly studentId: string;
  readonly displayName: string;
  readonly accountStatus: 'active' | 'disabled';
  readonly classId: string;
  readonly userVersion: number;
  readonly membershipVersion: number;
  readonly classVersion: number;
}

export interface TeacherStudentTransferReceipt extends TeacherStudentMutationReceipt {
  readonly sourceClassId: string;
  readonly sourceClassVersion: number;
}
