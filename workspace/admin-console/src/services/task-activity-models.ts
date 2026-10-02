export type ManagedKind = 'classroom' | 'activity' | 'template';
export interface ManagedFilters {
  startsOn: string;
  endsOn: string;
  kind?: ManagedKind;
  status?: string;
  keyword?: string;
}
export interface ManagedItem {
  id: string;
  kind: ManagedKind;
  title: string;
  teacherId: string | null;
  teacherNameMasked: string;
  classIds: string[];
  classNames: string[];
  startsAt: string | null;
  dueAt: string | null;
  status: string;
  completedCount: number | null;
  totalCount: number | null;
  completionRate: number | null;
  pendingReviewCount: number | null;
  pendingCommentCount: number | null;
  aiAssisted: false;
  anomaly: string | null;
  version: number;
}
export interface ManagedList { items: ManagedItem[]; total: number; nextOffset: number | null }
export interface ManagedDetail { item: ManagedItem; submissions: Array<{ studentId: string; studentNameMasked: string;
  status: string; submittedAt: string | null; score: number | null; hasFeedback: boolean }> }
export interface ManagedExport { fileName: string; csv: string }
export interface StopManagedResult { id: string; kind: ManagedKind; status: string; version: number }
export type ActivityResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export interface TaskActivityClient {
  list(filters: ManagedFilters, page: { limit: number; offset: number }): Promise<ActivityResult<ManagedList>>;
  detail(kind: ManagedKind, id: string): Promise<ActivityResult<ManagedDetail>>;
  exportCsv(filters: ManagedFilters): Promise<ActivityResult<ManagedExport>>;
  stop(input: { kind: ManagedKind; id: string; expectedVersion: number; operationId: string; reason: string }): Promise<ActivityResult<StopManagedResult>>;
}

export function selectTaskActivityClient(memoryClient: TaskActivityClient, cloudClient: TaskActivityClient | undefined,
  cloudReady: boolean): TaskActivityClient {
  return cloudReady && cloudClient ? cloudClient : memoryClient;
}
