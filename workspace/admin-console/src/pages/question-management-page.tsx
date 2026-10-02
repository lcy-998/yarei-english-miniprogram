import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminQuestionDetail, AdminQuestionFilters, AdminQuestionSummary,
  AdminQuestionVisibility } from '../cloud/admin-cloud-contract';
import type { ClassRoom } from '../domain/models';
import type { QuestionAdministration } from '../services/question-admin-service';
import { Button, EmptyState, Icon, Modal } from '../components/ui';

const PAGE_SIZE = 20;
const TYPE_LABELS: Record<AdminQuestionSummary['questionType'], string> = {
  single_choice: '单选题', multiple_choice: '多选题', fill: '填空题', subjective: '主观题',
};
const STATUS_LABELS: Record<AdminQuestionSummary['status'], string> = {
  draft: '草稿', published: '已上架', offline: '已下架',
};
function operationId(): string { return `admin-question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }

export function QuestionManagementPage({ service, classes, notify, onChanged }: {
  service: QuestionAdministration; classes: readonly ClassRoom[];
  notify: (message: string, type?: 'success' | 'error') => void; onChanged: () => Promise<void>;
}) {
  const [draftKeyword, setDraftKeyword] = useState('');
  const [filters, setFilters] = useState<AdminQuestionFilters>({});
  const [rows, setRows] = useState<readonly AdminQuestionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, AdminQuestionSummary>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedPage, setFailedPage] = useState<{ offset: number; append: boolean }>();
  const requestEpoch = useRef(0);
  const [preview, setPreview] = useState<AdminQuestionDetail>();
  const [visibilityRows, setVisibilityRows] = useState<AdminQuestionSummary[]>([]);
  const [visibilityType, setVisibilityType] = useState<'organization' | 'classes'>('classes');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [visibilityReason, setVisibilityReason] = useState('');
  const [visibilityOperation, setVisibilityOperation] = useState(operationId());
  const [statusAction, setStatusAction] = useState<{ items: AdminQuestionSummary[]; status: 'published' | 'offline' }>();
  const [statusReason, setStatusReason] = useState('');
  const [statusOperation, setStatusOperation] = useState(operationId());
  const [formError, setFormError] = useState('');

  const load = useCallback(async (pageOffset: number, append: boolean) => {
    const request = ++requestEpoch.current;
    setLoading(true); setError(''); setFailedPage(undefined);
    const result = await service.list(filters, PAGE_SIZE, pageOffset);
    if (request !== requestEpoch.current) return;
    setLoading(false);
    if (!result.ok) { setError(result.message); setFailedPage({ offset: pageOffset, append }); return; }
    setRows(previous => append ? [...previous, ...result.data.items] : result.data.items);
    setTotal(result.data.total); setNextOffset(result.data.nextOffset);
  }, [service, filters]);
  useEffect(() => {
    void load(0, false);
    return () => { requestEpoch.current += 1; };
  }, [load]);

  const chooseFilter = (patch: Partial<AdminQuestionFilters>) => {
    requestEpoch.current += 1;
    setRows([]); setTotal(0); setNextOffset(null); setSelected({}); setError(''); setFailedPage(undefined);
    setFilters(previous => ({ ...previous, ...patch }));
  };
  const previewQuestion = async (id: string) => {
    setBusy(true); setFormError('');
    const result = await service.get(id);
    setBusy(false);
    if (!result.ok) { notify(result.message, 'error'); return; }
    setPreview(result.data);
  };
  const openVisibility = (items: AdminQuestionSummary[]) => {
    if (!items.length) return;
    if (items.length > 20) { notify('每次最多批量处理 20 道题', 'error'); return; }
    const first = items[0]!;
    setVisibilityRows(items); setVisibilityType(first.visibility.type);
    setClassIds(first.visibility.type === 'classes' ? [...first.visibility.classIds] : []);
    setVisibilityReason(''); setVisibilityOperation(operationId()); setFormError('');
  };
  const saveVisibility = async () => {
    if (!visibilityRows.length || busy) return;
    if (visibilityType === 'classes' && !classIds.length) { setFormError('至少选择一个可见班级'); return; }
    if (!visibilityReason.trim()) { setFormError('请填写调整原因'); return; }
    const visibility: AdminQuestionVisibility = visibilityType === 'organization' ? { type: 'organization' }
      : { type: 'classes', classIds };
    setBusy(true); setFormError('');
    const result = visibilityRows.length === 1
      ? await service.setVisibility(visibilityRows[0]!.id, visibility, visibilityRows[0]!.version,
        visibilityReason.trim(), visibilityOperation)
      : await service.batchSetVisibility(visibilityRows.map(row => ({ id: row.id, expectedVersion: row.version })),
        visibility, visibilityReason.trim(), visibilityOperation);
    setBusy(false);
    if (!result.ok) { setFormError(result.message); return; }
    setVisibilityRows([]); setSelected({}); notify('题目可见范围已保存'); await load(0, false); await onChanged();
  };
  const openStatus = (items: AdminQuestionSummary[], status: 'published' | 'offline') => {
    if (!items.length) return;
    if (items.length > 20) { notify('每次最多批量处理 20 道题', 'error'); return; }
    setStatusAction({ items, status }); setStatusReason(''); setStatusOperation(operationId()); setFormError('');
  };
  const saveStatus = async () => {
    if (!statusAction || busy) return;
    if (!statusReason.trim()) { setFormError('请填写操作原因'); return; }
    setBusy(true); setFormError('');
    const result = await service.batchSetStatus(statusAction.items.map(item => ({ id: item.id, expectedVersion: item.version })),
      statusAction.status, statusReason.trim(), statusOperation);
    setBusy(false);
    if (!result.ok) { setFormError(result.message); return; }
    setStatusAction(undefined); setSelected({}); notify(statusAction.status === 'published' ? '题目已上架' : '题目已下架');
    await load(0, false); await onChanged();
  };
  const visibleIds = rows.map(item => item.id);
  const visibleAllSelected = visibleIds.length > 0 && visibleIds.every(id => selected[id]);
  const toggleVisible = () => setSelected(previous => visibleAllSelected
    ? Object.fromEntries(Object.entries(previous).filter(([id]) => !visibleIds.includes(id)))
    : { ...previous, ...Object.fromEntries(rows.map(item => [item.id, item])) });
  const selectedRows = Object.values(selected);

  return <>
    <section className="page-hero"><span className="page-hero__icon"><Icon name="exercise" /></span><div><h2>学校习题库管理</h2><p>维护题目可见范围与上下架状态，题干、答案和解析只读。</p></div></section>
    <section className="panel question-admin-panel">
      <div className="question-admin-filters">
        <label className="search"><Icon name="search" /><input value={draftKeyword} onChange={event => setDraftKeyword(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') chooseFilter({ keyword: draftKeyword.trim() || undefined }); }} placeholder="搜索题目或知识点" /></label>
        <Button variant="secondary" onClick={() => chooseFilter({ keyword: draftKeyword.trim() || undefined })}>搜索</Button>
        <select aria-label="题型" value={filters.questionType ?? ''} onChange={event => chooseFilter({ questionType: event.target.value as AdminQuestionFilters['questionType'] || undefined })}>
          <option value="">全部题型</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="班级" value={filters.classId ?? ''} onChange={event => chooseFilter({ classId: event.target.value || undefined })}>
          <option value="">全部班级</option>{classes.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="状态" value={filters.status ?? ''} onChange={event => chooseFilter({ status: event.target.value as AdminQuestionFilters['status'] || undefined })}>
          <option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="question-admin-toolbar"><span>共 {total} 道题　已选 {selectedRows.length} 道</span>
        <div className="row-actions"><Button variant="secondary" disabled={!selectedRows.length} onClick={() => openVisibility(selectedRows)}>设置可见范围</Button>
          <Button variant="secondary" disabled={!selectedRows.length} onClick={() => openStatus(selectedRows, 'published')}>批量上架</Button>
          <Button variant="secondary" disabled={!selectedRows.length} onClick={() => openStatus(selectedRows, 'offline')}>批量下架</Button></div>
      </div>
      {loading && !rows.length ? <div className="question-admin-state">正在加载题目…</div>
        : error && !rows.length ? <div className="question-admin-state" role="alert">{error}<Button variant="secondary" onClick={() => void load(0, false)}>重试</Button></div>
          : !rows.length ? <EmptyState title="暂无题目" description="当前条件下没有可管理的题目，请调整筛选条件。" />
            : <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="选择当前已加载题目" checked={visibleAllSelected} onChange={toggleVisible} /></th><th>题目摘要</th><th>题型</th><th>年级/单元</th><th>知识点</th><th>难度</th><th>可见范围</th><th>上架状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>{rows.map(item => <tr key={item.id}><td><input type="checkbox" checked={Boolean(selected[item.id])} onChange={event => setSelected(previous => event.target.checked ? { ...previous, [item.id]: item } : Object.fromEntries(Object.entries(previous).filter(([id]) => id !== item.id)))} aria-label={`选择${item.title}`} /></td>
                <td><strong>{item.stemSummary}</strong></td><td>{TYPE_LABELS[item.questionType]}</td><td>{item.grade}<br />{item.unit ?? '未标注单元'}</td><td>{item.knowledgePoint ?? '未标注'}</td><td>{item.difficulty ?? '未标注'}</td>
                <td>{item.visibility.type === 'organization' ? '全校' : item.visibility.classIds.map(id => classes.find(classroom => classroom.id === id)?.name ?? id).join('、')}</td>
                <td><span className={`question-admin-status status-${item.status}`}>{STATUS_LABELS[item.status]}</span></td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('zh-CN') : '未记录'}</td>
                <td className="row-actions"><button onClick={() => void previewQuestion(item.id)}>预览</button><button onClick={() => openVisibility([item])}>授权</button>
                  <button className={item.status === 'published' ? 'danger-link' : ''} onClick={() => openStatus([item], item.status === 'published' ? 'offline' : 'published')}>{item.status === 'published' ? '下架' : '上架'}</button></td></tr>)}</tbody></table></div>}
      {error && rows.length > 0 && <p className="form-error" role="alert">{error} <button onClick={() => failedPage && void load(failedPage.offset, failedPage.append)}>重试加载</button></p>}
      {nextOffset !== null && <div className="question-admin-pagination"><Button variant="secondary" disabled={loading} onClick={() => void load(nextOffset, true)}>{loading ? '加载中…' : '加载更多'}</Button></div>}
      <small className="question-admin-page-note">已加载 {rows.length} 道；批量操作只处理明确勾选的题目。</small>
    </section>
    {preview && <Modal title="题目预览" onClose={() => setPreview(undefined)}><div className="question-admin-preview"><p className="form-hint">题干、答案和解析仅支持查看，不可在本页修改。</p>
      <h3>题目</h3><p>{preview.stem}</p>{preview.options.map((option, index) => <p key={index}>{option}</p>)}
      <h3>正确答案</h3><p>{typeof preview.correctAnswer === 'string' ? preview.correctAnswer : JSON.stringify(preview.correctAnswer)}</p>
      <h3>解析</h3><p>{preview.explanation || '暂无解析'}</p></div></Modal>}
    {visibilityRows.length > 0 && <Modal title={`设置可见范围　${visibilityRows.length} 道题`} onClose={() => setVisibilityRows([])}><div className="form">
      <label>可见范围<select value={visibilityType} onChange={event => { setVisibilityType(event.target.value as 'organization' | 'classes'); setVisibilityOperation(operationId()); }}><option value="classes">指定班级</option><option value="organization">全校</option></select></label>
      {visibilityType === 'classes' && <div className="check-list">{classes.filter(item => item.status === 'active').map(item => <label key={item.id}><input type="checkbox" checked={classIds.includes(item.id)} onChange={event => { setClassIds(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id)); setVisibilityOperation(operationId()); }} /><span>{item.name}</span></label>)}</div>}
      <label>调整原因<textarea value={visibilityReason} onChange={event => { setVisibilityReason(event.target.value); setVisibilityOperation(operationId()); }} placeholder="填写授权调整原因" /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="form-actions"><Button variant="secondary" onClick={() => setVisibilityRows([])}>取消</Button><Button disabled={busy} onClick={() => void saveVisibility()}>{busy ? '保存中…' : '保存授权'}</Button></div>
    </div></Modal>}
    {statusAction && <Modal title={statusAction.status === 'published' ? '确认上架题目？' : '确认下架题目？'} onClose={() => setStatusAction(undefined)}><div className="form">
      <p>本次处理 {statusAction.items.length} 道题。下架后教师不能在新任务中引用，已发布任务保留原内容快照。</p>
      <label>操作原因<textarea value={statusReason} onChange={event => { setStatusReason(event.target.value); setStatusOperation(operationId()); }} placeholder="填写操作原因" /></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="form-actions"><Button variant="secondary" onClick={() => setStatusAction(undefined)}>取消</Button><Button disabled={busy} onClick={() => void saveStatus()}>{busy ? '处理中…' : statusAction.status === 'published' ? '确认上架' : '确认下架'}</Button></div>
    </div></Modal>}
  </>;
}
