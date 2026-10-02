import type { AdminSession, ServiceResult } from '../domain/models';
import type { AdminRepository } from './admin-repository';
import type { CloudBaseAdminRuntime } from '../cloud/cloudbase-admin-runtime';
import type { AdminQuestionDetail, AdminQuestionFilters, AdminQuestionSummary, AdminQuestionVisibility,
  AdminPageView } from '../cloud/admin-cloud-contract';

export interface QuestionAdministration {
  list(filters: AdminQuestionFilters, limit: number, offset: number): Promise<ServiceResult<AdminPageView<AdminQuestionSummary>>>;
  get(id: string): Promise<ServiceResult<AdminQuestionDetail>>;
  setVisibility(id: string, visibility: AdminQuestionVisibility, expectedVersion: number,
    reason: string, operationId: string): Promise<ServiceResult<AdminQuestionDetail>>;
  batchSetVisibility(items: readonly Readonly<{ id: string; expectedVersion: number }>[],
    visibility: AdminQuestionVisibility, reason: string, operationId: string): Promise<ServiceResult<readonly AdminQuestionDetail[]>>;
  batchSetStatus(items: readonly Readonly<{ id: string; expectedVersion: number }>[], status: 'published' | 'offline',
    reason: string, operationId: string): Promise<ServiceResult<readonly AdminQuestionDetail[]>>;
}

const DEMO_QUESTIONS: readonly AdminQuestionDetail[] = [
  { id: 'res_exercise_bird_demo', title: '动物主题选择题', stemSummary: 'Which animal can fly?',
    grade: '三年级', unit: 'Unit 3', difficulty: '中等', knowledgePoint: '动物', questionType: 'single_choice',
    status: 'published', visibility: { type: 'classes', classIds: ['class-grade3-02'] }, updatedAt: '2026-09-26T01:00:00.000Z',
    version: 1, stem: 'Which animal can fly?', options: ['A. bird', 'B. lion', 'C. elephant'],
    correctAnswer: 'A. bird', explanation: 'Birds can fly.' },
  { id: 'res_exercise_lion_demo', title: '动物主题填空题', stemSummary: 'The lion is _____.',
    grade: '三年级', unit: 'Unit 3', difficulty: '基础', knowledgePoint: '动物', questionType: 'fill',
    status: 'published', visibility: { type: 'classes', classIds: ['class-grade3-02'] }, updatedAt: '2026-09-25T08:00:00.000Z',
    version: 1, stem: 'The lion is _____.', options: [], correctAnswer: 'strong', explanation: 'The lion is strong.' },
];

function ok<T>(data: T): ServiceResult<T> { return { ok: true, data }; }
function fail<T>(code: string, message: string): ServiceResult<T> { return { ok: false, code, message }; }
function clone<T>(value: T): T { return structuredClone(value); }

export class MemoryQuestionAdminService implements QuestionAdministration {
  private rows = clone(DEMO_QUESTIONS) as AdminQuestionDetail[];
  private receipts = new Map<string, { fingerprint: string; result: readonly AdminQuestionDetail[] }>();
  constructor(private readonly repository: AdminRepository, private readonly session: AdminSession,
    private readonly now: () => string = () => new Date().toISOString()) {}

  async list(filters: AdminQuestionFilters, limit: number, offset: number): Promise<ServiceResult<AdminPageView<AdminQuestionSummary>>> {
    if (!this.session.permissions.includes('organization.view')) return fail('FORBIDDEN', '无题库查看权限');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) {
      return fail('VALIDATION_ERROR', '分页参数无效');
    }
    const keyword = filters.keyword?.toLowerCase().trim();
    const rows = this.rows.filter(row => this.scope(row) && (!filters.status || row.status === filters.status)
      && (!filters.questionType || row.questionType === filters.questionType)
      && (!filters.classId || row.visibility.type === 'organization'
        || row.visibility.classIds.includes(filters.classId))
      && (!keyword || `${row.title} ${row.stem} ${row.knowledgePoint ?? ''}`.toLowerCase().includes(keyword)))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
    const items = rows.slice(offset, offset + limit).map(({ stem: _stem, options: _options,
      correctAnswer: _correctAnswer, explanation: _explanation, ...summary }) => summary);
    return ok({ items: clone(items), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null });
  }
  async get(id: string): Promise<ServiceResult<AdminQuestionDetail>> {
    if (!this.session.permissions.includes('organization.view')) return fail('FORBIDDEN', '无题库查看权限');
    const row = this.rows.find(item => item.id === id);
    return row && this.scope(row) ? ok(clone(row)) : fail('NOT_FOUND', '题目不存在或不在授权范围');
  }
  async setVisibility(id: string, visibility: AdminQuestionVisibility, expectedVersion: number,
    reason: string, operationId: string): Promise<ServiceResult<AdminQuestionDetail>> {
    if (!this.session.permissions.includes('organization.edit')) return fail('FORBIDDEN', '无题库管理权限');
    const fingerprint = JSON.stringify({ id, visibility, expectedVersion, reason });
    const prior = this.receipts.get(operationId);
    if (prior) return prior.fingerprint === fingerprint && prior.result[0] ? ok(clone(prior.result[0])) : fail('CONFLICT', '操作标识已用于其他内容');
    const row = this.rows.find(item => item.id === id);
    if (!row || !this.scope(row)) return fail('NOT_FOUND', '题目不存在或不在授权范围');
    if (row.version !== expectedVersion) return fail('CONFLICT', '题目已更新，请刷新后重试');
    const snapshot = await this.repository.read();
    const ids = visibility.type === 'classes' ? [...new Set(visibility.classIds)] : [];
    if (!reason.trim() || visibility.type === 'classes' && (!ids.length || ids.length !== visibility.classIds.length
      || !ids.every(classId => snapshot.classes.some(item => item.id === classId && item.status === 'active'
        && this.session.schoolIds.includes(item.schoolId))))) return fail('VALIDATION_ERROR', '请填写原因并选择有效的可见班级');
    const changed: AdminQuestionDetail = { ...row, visibility: clone(visibility), version: row.version + 1, updatedAt: this.now() };
    this.rows = this.rows.map(item => item.id === id ? changed : item);
    this.receipts.set(operationId, { fingerprint, result: [clone(changed)] });
    await this.audit('设置题目可见范围', id, reason);
    return ok(clone(changed));
  }
  async batchSetStatus(items: readonly Readonly<{ id: string; expectedVersion: number }>[],
    status: 'published' | 'offline', reason: string, operationId: string): Promise<ServiceResult<readonly AdminQuestionDetail[]>> {
    if (!this.session.permissions.includes('organization.edit')) return fail('FORBIDDEN', '无题库管理权限');
    const fingerprint = JSON.stringify({ items, status, reason });
    const prior = this.receipts.get(operationId);
    if (prior) return prior.fingerprint === fingerprint ? ok(clone(prior.result)) : fail('CONFLICT', '操作标识已用于其他内容');
    if (!items.length || items.length > 20 || new Set(items.map(item => item.id)).size !== items.length || !reason.trim()) {
      return fail('VALIDATION_ERROR', '请选择 1—20 道题并填写操作原因');
    }
    const selected = items.map(item => this.rows.find(row => row.id === item.id));
    if (selected.some(row => !row || !this.scope(row))) return fail('NOT_FOUND', '选择中含无权处理的题目');
    if (selected.some((row, index) => row?.version !== items[index]!.expectedVersion)) return fail('CONFLICT', '题目已更新，请刷新后重试');
    const changed = selected.map(row => ({ ...row!, status, version: row!.version + 1, updatedAt: this.now() }));
    const next = new Map(changed.map(row => [row.id, row]));
    this.rows = this.rows.map(row => next.get(row.id) ?? row);
    this.receipts.set(operationId, { fingerprint, result: clone(changed) });
    await this.audit(status === 'published' ? '批量上架题目' : '批量下架题目', items.map(item => item.id).join(','), reason);
    return ok(clone(changed));
  }
  async batchSetVisibility(items: readonly Readonly<{ id: string; expectedVersion: number }>[],
    visibility: AdminQuestionVisibility, reason: string, operationId: string): Promise<ServiceResult<readonly AdminQuestionDetail[]>> {
    if (!this.session.permissions.includes('organization.edit')) return fail('FORBIDDEN', '无题库管理权限');
    const fingerprint = JSON.stringify({ items, visibility, reason });
    const prior = this.receipts.get(operationId);
    if (prior) return prior.fingerprint === fingerprint ? ok(clone(prior.result)) : fail('CONFLICT', '操作标识已用于其他内容');
    if (!items.length || items.length > 20 || new Set(items.map(item => item.id)).size !== items.length || !reason.trim()) {
      return fail('VALIDATION_ERROR', '请选择 1—20 道题并填写原因');
    }
    const snapshot = await this.repository.read();
    if (visibility.type === 'classes' && (!visibility.classIds.length
      || !visibility.classIds.every(id => snapshot.classes.some(item => item.id === id && item.status === 'active'
        && this.session.schoolIds.includes(item.schoolId))))) return fail('VALIDATION_ERROR', '可见班级无效');
    const selected = items.map(item => this.rows.find(row => row.id === item.id));
    if (selected.some(row => !row || !this.scope(row))) return fail('NOT_FOUND', '选择中含无权处理的题目');
    if (selected.some((row, index) => row?.version !== items[index]!.expectedVersion)) return fail('CONFLICT', '题目已更新，请刷新后重试');
    const changed = selected.map(row => ({ ...row!, visibility: clone(visibility), version: row!.version + 1, updatedAt: this.now() }));
    const next = new Map(changed.map(row => [row.id, row]));
    this.rows = this.rows.map(row => next.get(row.id) ?? row);
    this.receipts.set(operationId, { fingerprint, result: clone(changed) });
    await this.audit('批量设置题目可见范围', items.map(item => item.id).join(','), reason);
    return ok(clone(changed));
  }
  private scope(row: AdminQuestionSummary): boolean {
    return this.session.schoolIds.includes('school-demo-001')
      && (row.visibility.type === 'organization' || row.visibility.classIds.includes('class-grade3-02'));
  }
  private async audit(action: string, target: string, reason: string): Promise<void> {
    const snapshot = await this.repository.read();
    snapshot.audits.unshift({ id: `audit-question-${Date.now().toString(36)}`, actorId: this.session.actorId,
      action, target, reason, createdAt: this.now(), result: 'success' });
    await this.repository.replace(snapshot);
  }
}

export class CloudQuestionAdminService implements QuestionAdministration {
  constructor(private readonly runtime: CloudBaseAdminRuntime) {}
  async list(filters: AdminQuestionFilters, limit: number, offset: number): Promise<ServiceResult<AdminPageView<AdminQuestionSummary>>> {
    return adapt(await this.runtime.organization.listAdminQuestions({ filters, page: { limit, offset } }));
  }
  async get(id: string): Promise<ServiceResult<AdminQuestionDetail>> {
    return adapt(await this.runtime.organization.getAdminQuestion(id));
  }
  async setVisibility(id: string, visibility: AdminQuestionVisibility, expectedVersion: number,
    reason: string, operationId: string): Promise<ServiceResult<AdminQuestionDetail>> {
    return adapt(await this.runtime.organization.setQuestionVisibility({ id, visibility, expectedVersion, reason, operationId }));
  }
  async batchSetStatus(items: readonly Readonly<{ id: string; expectedVersion: number }>[], status: 'published' | 'offline',
    reason: string, operationId: string): Promise<ServiceResult<readonly AdminQuestionDetail[]>> {
    return adapt(await this.runtime.organization.batchSetQuestionStatus({ items, status, reason, operationId }));
  }
  async batchSetVisibility(items: readonly Readonly<{ id: string; expectedVersion: number }>[],
    visibility: AdminQuestionVisibility, reason: string, operationId: string): Promise<ServiceResult<readonly AdminQuestionDetail[]>> {
    return adapt(await this.runtime.organization.batchSetQuestionVisibility({ items, visibility, reason, operationId }));
  }
}

function adapt<T>(result: Awaited<ReturnType<CloudBaseAdminRuntime['organization']['getAdminQuestion']>> | {
  ok: true; data: T } | { ok: false; error: { code: string; message: string } }): ServiceResult<T> {
  return result.ok ? ok(result.data as T) : fail(result.error.code, result.error.message);
}
