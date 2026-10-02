import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, ErrorState, Icon, LoadingState, Modal } from '../components/ui';
import type { CloudBaseAdminRuntime } from '../cloud/cloudbase-admin-runtime';
import { MemoryTaskActivityClient } from '../services/memory-task-activities';
import { selectTaskActivityClient, type ManagedDetail, type ManagedFilters, type ManagedItem,
  type ManagedKind, type TaskActivityClient } from '../services/task-activity-models';
import './task-activities-page.css';

const memoryClient = new MemoryTaskActivityClient({ actorId: 'admin-zhou', actorName: '周老师',
  schoolIds: ['school-demo-001'], permissions: ['dashboard.view', 'organization.edit'] });
const kindOptions: Array<{ value: '' | ManagedKind; label: string }> = [
  { value: '', label: '全部类型' }, { value: 'classroom', label: '课堂任务' },
  { value: 'activity', label: '打卡活动' }, { value: 'template', label: '任务模板' },
];
const kindName: Record<ManagedKind, string> = { classroom: '课堂任务', activity: '打卡活动', template: '任务模板' };
const statusName: Record<string, string> = { draft: '草稿', scheduled: '待开始', active: '进行中',
  expired: '已过期', withdrawn: '已撤回', closed: '已停用', completed: '已完成',
  published: '已发布', deleted: '已删除' };
function statusLabel(item: ManagedItem): string {
  return item.kind === 'template' ? item.status === 'active' ? '可用' : '已停用'
    : statusName[item.status] ?? item.status;
}

function dateOffset(days: number): string {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const initialFilters = (): ManagedFilters => ({ startsOn: dateOffset(-29), endsOn: dateOffset(0) });
function canStop(item: ManagedItem): boolean {
  return item.kind === 'classroom' ? ['draft', 'scheduled', 'active', 'expired'].includes(item.status)
    : item.kind === 'activity' ? ['draft', 'published'].includes(item.status) : item.status === 'active';
}

export function TaskActivitiesPage({ runtime, cloudReady, notify }: { runtime: CloudBaseAdminRuntime | undefined;
  cloudReady: boolean;
  notify: (message: string, type?: 'success' | 'error') => void }) {
  const [client, setClient] = useState<TaskActivityClient>(memoryClient);
  const [filters, setFilters] = useState<ManagedFilters>(initialFilters);
  const [applied, setApplied] = useState<ManagedFilters>(initialFilters);
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [detail, setDetail] = useState<ManagedDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [stopTarget, setStopTarget] = useState<ManagedItem>();
  const [stopReason, setStopReason] = useState('');
  const [stopOperationId, setStopOperationId] = useState('');
  const [busy, setBusy] = useState(false);
  const requestEpoch = useRef(0);

  const load = async (currentClient = client, currentFilters = applied, offset = 0) => {
    const request = ++requestEpoch.current;
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    setError('');
    const result = await currentClient.list(currentFilters, { limit: 25, offset });
    if (request !== requestEpoch.current) return;
    setLoading(false); setLoadingMore(false);
    if (!result.ok) { setError(result.message); return; }
    setItems((existing) => offset === 0 ? result.data.items : [...existing, ...result.data.items]);
    setTotal(result.data.total); setNextOffset(result.data.nextOffset);
  };

  useEffect(() => {
    const selected = selectTaskActivityClient(memoryClient, runtime?.taskActivities, cloudReady);
    setClient(selected);
    void load(selected, applied);
    return () => { requestEpoch.current += 1; };
  }, [runtime, cloudReady]);

  const apply = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.endsOn)
      || filters.startsOn > filters.endsOn) { setActionError('请选择有效的起止日期'); return; }
    setActionError(''); setApplied(filters); setNextOffset(null); void load(client, filters);
  };
  const openDetail = async (item: ManagedItem) => {
    setDetailLoading(true); setActionError('');
    const result = await client.detail(item.kind, item.id);
    setDetailLoading(false);
    if (!result.ok) { setActionError(result.message); return; }
    setDetail(result.data);
  };
  const prepareStop = (item: ManagedItem) => {
    setStopTarget(item); setStopReason(''); setActionError('');
    setStopOperationId(`admin-stop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  };
  const stop = async () => {
    if (!stopTarget || !stopReason.trim() || busy) { setActionError('请填写停用原因'); return; }
    setBusy(true); setActionError('');
    const result = await client.stop({ kind: stopTarget.kind, id: stopTarget.id,
      expectedVersion: stopTarget.version, operationId: stopOperationId, reason: stopReason.trim() });
    setBusy(false);
    if (!result.ok) { setActionError(result.message); return; }
    notify('任务或活动已停用'); setStopTarget(undefined); setDetail(undefined);
    await load(client, applied);
  };
  const exportCsv = async () => {
    if (busy) return;
    setBusy(true); setActionError('');
    const result = await client.exportCsv(applied);
    setBusy(false);
    if (!result.ok) { setActionError(result.message); return; }
    try {
      const file = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = result.data.fileName;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('当前筛选的 CSV 已生成');
    } catch { setActionError('导出失败，请重试'); }
  };
  const statusOptions = ['', 'draft', 'scheduled', 'active', 'expired', 'published', 'completed', 'withdrawn', 'closed', 'deleted'];
  return <>
    <section className="page-hero"><span className="page-hero__icon"><Icon name="tasks" /></span><div><h2>任务与活动管理</h2><p>查看授权学校的课堂任务、打卡活动与教师模板</p></div><Button icon="refresh" variant="secondary" onClick={() => void load()}>刷新</Button></section>
    <section className="panel managed-panel">
      {!cloudReady && <p className="managed-demo-note">当前为虚构数据预览；停用需连接授权的非生产后台。</p>}
      <div className="managed-filters">
        <label>布置方式<select value={filters.kind ?? ''} onChange={(event) => setFilters({ ...filters,
          kind: event.target.value ? event.target.value as ManagedKind : undefined })}>{kindOptions.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}</select></label>
        <label>状态<select value={filters.status ?? ''} onChange={(event) => setFilters({ ...filters,
          status: event.target.value || undefined })}>{statusOptions.map((status) => <option key={status || 'all'} value={status}>{status
            ? filters.kind === 'template' && status === 'active' ? '可用'
              : filters.kind === 'template' && status === 'deleted' ? '已停用'
                : statusName[status] ?? status : '全部状态'}</option>)}</select></label>
        <label>开始日期<input type="date" value={filters.startsOn} onChange={(event) => setFilters({ ...filters, startsOn: event.target.value })} /></label>
        <label>结束日期<input type="date" value={filters.endsOn} onChange={(event) => setFilters({ ...filters, endsOn: event.target.value })} /></label>
        <label className="managed-search">关键词<input value={filters.keyword ?? ''} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} placeholder="任务名、教师或班级" /></label>
        <Button onClick={apply}>筛选</Button>
      </div>
      <div className="managed-toolbar"><span>共 {total} 条记录　当前显示 {items.length} 条</span><Button variant="secondary" onClick={() => void exportCsv()} disabled={busy || loading}>导出当前筛选 CSV</Button></div>
      {actionError && <p className="managed-error" role="alert">{actionError}</p>}
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} />
        : items.length === 0 ? <EmptyState title="暂无任务或活动" description="请调整类型、状态或日期范围" />
          : <div className="table-scroll"><table className="managed-table"><thead><tr><th>布置方式 / 名称</th><th>创建教师</th><th>班级</th><th>开始 / 截止</th><th>完成率</th><th>待检查 / 待点评</th><th>AI 辅助</th><th>状态 / 异常</th><th>操作</th></tr></thead><tbody>
            {items.map((item) => <tr key={`${item.kind}:${item.id}`}><td><span className={`managed-kind managed-kind--${item.kind}`}>{kindName[item.kind]}</span><strong>{item.title}</strong></td><td>{item.teacherNameMasked}</td><td>{item.classNames.join('、') || '—'}</td><td>{item.startsAt?.slice(0, 16) ?? '—'}<br />{item.dueAt?.slice(0, 16) ?? '—'}</td><td>{item.completionRate === null ? '未记录' : `${item.completionRate}%`}<small>{item.completedCount === null ? '—' : `${item.completedCount}/${item.totalCount}`}</small></td><td>{item.pendingReviewCount ?? '—'} / {item.pendingCommentCount ?? '—'}</td><td>否</td><td><span className="managed-status">{statusLabel(item)}</span>{item.anomaly && <small className="managed-anomaly">{item.anomaly}</small>}</td><td className="row-actions"><button onClick={() => void openDetail(item)}>查看</button><button className="danger-link" disabled={!cloudReady || !canStop(item)} onClick={() => prepareStop(item)}>停用</button></td></tr>)}
          </tbody></table></div>}
      {nextOffset !== null && <div className="managed-more"><Button variant="secondary" disabled={loading || loadingMore} onClick={() => void load(client, applied, nextOffset)}>{loadingMore ? '加载中…' : '加载更多'}</Button></div>}
    </section>
    {detailLoading && <Modal title="读取详情" onClose={() => setDetailLoading(false)}><LoadingState /></Modal>}
    {detail && <Modal title={`${kindName[detail.item.kind]}详情`} onClose={() => setDetail(undefined)}><div className="managed-detail"><h3>{detail.item.title}</h3><p>{detail.item.teacherNameMasked}　{detail.item.classNames.join('、') || '无班级'}</p><p>{statusLabel(detail.item)}　完成率 {detail.item.completionRate === null ? '未记录' : `${detail.item.completionRate}%`}</p><h4>提交概览</h4>{detail.submissions.length ? <ul>{detail.submissions.map((row) => <li key={row.studentId}><strong>{row.studentNameMasked}</strong><span>{row.status}</span><span>{row.submittedAt?.slice(0, 16) ?? '未提交'}</span><span>{row.score === null ? '未评分' : `${row.score} 分`}</span></li>)}</ul> : <p>当前没有可核对的提交记录。</p>}</div></Modal>}
    {stopTarget && <Modal title={`停用${kindName[stopTarget.kind]}`} onClose={() => { if (!busy) setStopTarget(undefined); }}><div className="form"><p className="form-hint">确认停用“{stopTarget.title}”？历史任务、提交和点评会保留。此操作将记录管理员、原因和版本。</p><label>停用原因<textarea maxLength={200} value={stopReason} onChange={(event) => setStopReason(event.target.value)} placeholder="填写停用依据" /></label>{actionError && <p className="form-error">{actionError}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setStopTarget(undefined)}>取消</Button><Button variant="danger" disabled={busy || !stopReason.trim()} onClick={() => void stop()}>{busy ? '处理中…' : '确认停用'}</Button></div></div></Modal>}
  </>;
}
