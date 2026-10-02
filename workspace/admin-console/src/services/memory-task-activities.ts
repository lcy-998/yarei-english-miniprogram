import type { AdminSession } from '../domain/models';
import type { ActivityResult, ManagedDetail, ManagedExport, ManagedFilters, ManagedItem, ManagedKind,
  ManagedList, StopManagedResult, TaskActivityClient } from './task-activity-models';

const copy = <T>(value: T): T => structuredClone(value);
const fail = <T>(code: string, message: string): ActivityResult<T> => ({ ok: false, code, message });
const ok = <T>(data: T): ActivityResult<T> => ({ ok: true, data });
function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function dateOffset(days: number): string { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); }

export class MemoryTaskActivityClient implements TaskActivityClient {
  private items: ManagedItem[];
  private readonly submissions = [
    { studentId: 'student-xiaoyu', studentNameMasked: '小*', status: 'completed', submittedAt: `${dateOffset(-2)}T14:00:00+08:00`, score: 91, hasFeedback: true },
    { studentId: 'student-demo-02', studentNameMasked: '演示学员 02', status: 'awaiting_review', submittedAt: `${dateOffset(-1)}T15:00:00+08:00`, score: null, hasFeedback: false },
    { studentId: 'student-demo-03', studentNameMasked: '演示学员 03', status: 'not_started', submittedAt: null, score: null, hasFeedback: false },
  ];

  public constructor(private readonly session: AdminSession) {
    this.items = [
      { id: 'task-demo-animals', kind: 'classroom', title: '动物主题阅读与单词', teacherId: 'teacher-lin',
        teacherNameMasked: '林*师', classIds: ['class-grade3-02'], classNames: ['三年级 2 班'],
        startsAt: `${dateOffset(-3)}T08:00:00+08:00`, dueAt: `${dateOffset(2)}T20:00:00+08:00`,
        status: 'active', completedCount: 2, totalCount: 3, completionRate: Math.round(2 * 100 / 3),
        pendingReviewCount: 1, pendingCommentCount: 1, aiAssisted: false, anomaly: null, version: 1 },
      { id: 'activity-demo-reading', kind: 'activity', title: '七日阅读打卡', teacherId: 'teacher-lin',
        teacherNameMasked: '林*师', classIds: ['class-grade3-02'], classNames: ['三年级 2 班'],
        startsAt: dateOffset(-5), dueAt: dateOffset(2), status: 'published', completedCount: null,
        totalCount: 3, completionRate: null, pendingReviewCount: null, pendingCommentCount: null,
        aiAssisted: false, anomaly: null, version: 1 },
      { id: 'template-demo-reading', kind: 'template', title: '阅读加单词模板', teacherId: 'teacher-lin',
        teacherNameMasked: '林*师', classIds: [], classNames: [], startsAt: `${dateOffset(-4)}T09:00:00+08:00`,
        dueAt: null, status: 'active', completedCount: null, totalCount: null,
        completionRate: null, pendingReviewCount: null, pendingCommentCount: null,
        aiAssisted: false, anomaly: null, version: 1 },
    ];
  }

  public async list(filters: ManagedFilters, page: { limit: number; offset: number }): Promise<ActivityResult<ManagedList>> {
    if (!this.canRead()) return fail('FORBIDDEN', '当前管理员无权查看任务活动');
    if (!validFilters(filters) || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100
      || !Number.isSafeInteger(page.offset) || page.offset < 0) return fail('VALIDATION_ERROR', '筛选条件无效');
    const rows = this.filtered(filters);
    return ok({ items: copy(rows.slice(page.offset, page.offset + page.limit)), total: rows.length,
      nextOffset: page.offset + page.limit < rows.length ? page.offset + page.limit : null });
  }

  public async detail(kind: ManagedKind, id: string): Promise<ActivityResult<ManagedDetail>> {
    if (!this.canRead()) return fail('FORBIDDEN', '当前管理员无权查看详情');
    const item = this.items.find((row) => row.kind === kind && row.id === id && this.inScope(row));
    if (!item) return fail('NOT_FOUND', '任务活动不存在或不在授权范围');
    return ok({ item: copy(item), submissions: kind === 'classroom' ? copy(this.submissions) : [] });
  }

  public async exportCsv(filters: ManagedFilters): Promise<ActivityResult<ManagedExport>> {
    if (!this.canRead()) return fail('FORBIDDEN', '当前管理员无权导出任务活动');
    if (!validFilters(filters)) return fail('VALIDATION_ERROR', '筛选条件无效');
    const selected = this.filtered(filters);
    if (selected.length > 2000) return fail('VALIDATION_ERROR', '数据较多，请缩小筛选范围');
    const rows = [['类型', '名称', '创建教师', '班级', '开始时间', '截止时间', '状态', '完成数', '总人数', '完成率', '待检查', '待点评', 'AI 辅助', '异常'],
      ...selected.map((item) => [label(item.kind), item.title, item.teacherNameMasked,
        item.classNames.join('、'), item.startsAt ?? '', item.dueAt ?? '', item.status,
        item.completedCount === null ? '' : String(item.completedCount),
        item.totalCount === null ? '' : String(item.totalCount),
        item.completionRate === null ? '' : `${item.completionRate}%`,
        item.pendingReviewCount === null ? '' : String(item.pendingReviewCount),
        item.pendingCommentCount === null ? '' : String(item.pendingCommentCount), '否', item.anomaly ?? ''])];
    return ok({ fileName: `雅睿英语-任务活动-${filters.startsOn}-${filters.endsOn}.csv`,
      csv: '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n' });
  }

  public async stop(input: { kind: ManagedKind; id: string; expectedVersion: number; operationId: string; reason: string }): Promise<ActivityResult<StopManagedResult>> {
    if (!this.canManage()) return fail('FORBIDDEN', '当前管理员无停用权限');
    void input;
    return fail('SERVICE_UNAVAILABLE', '本地仅展示虚构记录；连接授权非生产后台后才能停用');
  }

  private canRead(): boolean { return this.session.permissions.includes('dashboard.view') && this.session.schoolIds.length > 0; }
  private canManage(): boolean { return this.canRead() && this.session.permissions.includes('organization.edit'); }
  private inScope(item: ManagedItem): boolean {
    void item;
    return this.session.schoolIds.includes('school-demo-001');
  }
  private filtered(filters: ManagedFilters): ManagedItem[] {
    return this.items.filter((item) => this.inScope(item)
      && (item.startsAt?.slice(0, 10) ?? '') >= filters.startsOn
      && (item.startsAt?.slice(0, 10) ?? '') <= filters.endsOn
      && (!filters.kind || item.kind === filters.kind) && (!filters.status || item.status === filters.status)
      && (!filters.keyword || [item.title, item.teacherNameMasked, ...item.classNames]
        .some((value) => value.toLocaleLowerCase().includes(filters.keyword!.trim().toLocaleLowerCase()))));
  }
}

function label(kind: ManagedKind): string { return { classroom: '课堂任务', activity: '打卡活动', template: '任务模板' }[kind]; }
function validFilters(filters: ManagedFilters): boolean {
  const start = Date.parse(`${filters.startsOn}T00:00:00Z`);
  const end = Date.parse(`${filters.endsOn}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start <= 366 * 86400000;
}
function csvCell(value: string): string {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
