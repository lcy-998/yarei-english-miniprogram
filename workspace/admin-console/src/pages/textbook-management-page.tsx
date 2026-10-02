import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, ErrorState, Icon, LoadingState, Modal } from '../components/ui';
import type { CloudBaseAdminRuntime } from '../cloud/cloudbase-admin-runtime';
import type { AdminTextbookBook, AdminTextbookClient, AdminTextbookOverview,
  AdminTextbookPreview, TextbookDashboardField, TextbookLayout } from '../cloud/admin-textbook-client';
import type { AdminSnapshot } from '../domain/models';
import { MemoryTextbookAdminClient } from '../services/memory-textbook-admin-client';
import './textbook-management-page.css';

let latestSnapshot: AdminSnapshot;
const memoryClient = new MemoryTextbookAdminClient(() => latestSnapshot);
const FIELD_CHOICES: Array<{ id: TextbookDashboardField; label: string }> = [
  { id: 'grade', label: '年级' }, { id: 'studentCount', label: '学员人数' },
  { id: 'configuredBookCount', label: '已配置课本数' }, { id: 'progress', label: '当前进度' },
  { id: 'updatedAt', label: '最近更新' },
];
const STATUS_LABEL: Record<AdminTextbookBook['status'], string> = {
  draft: '未上架', published: '已发布', offline: '已停用',
};
function defaultLayout(overview: AdminTextbookOverview): TextbookLayout {
  return { classTextbooksEnabled: true, synchronizedTextbooksEnabled: true,
    visibleClassIds: overview.classes.filter(item => item.status === 'active').map(item => item.id),
    dashboardFields: FIELD_CHOICES.map(item => item.id) };
}
function operationId(): string { return `textbook-admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }

export function TextbookManagementPage({ runtime, cloudReady, snapshot, notify }: {
  runtime: CloudBaseAdminRuntime | undefined;
  cloudReady: boolean;
  snapshot: AdminSnapshot;
  notify: (message: string, type?: 'success' | 'error') => void;
}) {
  latestSnapshot = snapshot;
  const [client, setClient] = useState<AdminTextbookClient>(memoryClient);
  const [overview, setOverview] = useState<AdminTextbookOverview>();
  const [layout, setLayout] = useState<TextbookLayout>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selectedBook, setSelectedBook] = useState<AdminTextbookBook>();
  const [bookClassIds, setBookClassIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<AdminTextbookPreview>();
  const [pendingStatus, setPendingStatus] = useState<{ book: AdminTextbookBook; publish: boolean }>();
  const operations = useRef<Record<string, string>>({});

  const load = async (activeClient = client) => {
    setLoading(true); setError('');
    const result = await activeClient.getOverview();
    setLoading(false);
    if (!result.ok) { setError(result.error.message); return; }
    setOverview(result.data);
    setLayout(result.data.settings?.draft ?? defaultLayout(result.data));
  };

  useEffect(() => {
    const selected = cloudReady && runtime ? runtime.textbooks : memoryClient;
    setClient(selected);
    void load(selected);
  }, [runtime, cloudReady]);

  const rows = useMemo(() => (overview?.books ?? []).filter(book => {
    const query = keyword.trim().toLocaleLowerCase();
    return (!query || `${book.title} ${book.edition} ${book.grade}`.toLocaleLowerCase().includes(query))
      && (!classFilter || book.visibleClassIds.includes(classFilter) || book.draft?.classIds.includes(classFilter));
  }), [overview, keyword, classFilter]);
  const configured = overview?.settings?.published !== null && overview?.settings !== undefined;

  const updateLayout = (patch: Partial<TextbookLayout>) => {
    if (!layout) return;
    setLayout({ ...layout, ...patch });
    delete operations.current.settings;
    delete operations.current['settings-publish'];
    setActionError('');
  };
  const saveLayout = async (publish: boolean) => {
    if (!layout || !overview || saving) return;
    if (!layout.visibleClassIds.length || !layout.dashboardFields.length) {
      setActionError('至少选择一个可见班级和一个班级大盘字段。'); return;
    }
    const key = publish ? 'settings-publish' : 'settings';
    const id = operations.current[key] ?? operationId(); operations.current[key] = id;
    setSaving(true); setActionError('');
    const result = await client.saveSettings(layout, overview.settings?.version ?? 0, id, publish);
    setSaving(false);
    if (!result.ok) { setActionError(result.error.message); return; }
    delete operations.current[key];
    notify(cloudReady ? (publish ? '教材中心展示设置已发布' : '教材中心配置草稿已保存')
      : (publish ? '本地演示设置已记录，未发布到云端' : '本地演示草稿已保存，未写入云端'));
    await load();
  };
  const openBook = (book: AdminTextbookBook) => {
    setSelectedBook(book); setBookClassIds(book.draft?.classIds ?? book.visibleClassIds);
    setActionError(''); delete operations.current.book;
  };
  const saveBook = async () => {
    if (!selectedBook || !bookClassIds.length || saving) {
      setActionError('请至少选择一个可见班级。'); return;
    }
    const id = operations.current.book ?? operationId(); operations.current.book = id;
    setSaving(true); setActionError('');
    const result = await client.saveCatalogDraft(selectedBook.id, bookClassIds, selectedBook.draft?.version ?? 0, id);
    setSaving(false);
    if (!result.ok) { setActionError(result.error.message); return; }
    delete operations.current.book;
    setSelectedBook({ ...selectedBook, draft: result.data });
    notify(cloudReady ? '课本可见范围草稿已保存' : '本地演示范围已保存，未写入云端');
    await load();
  };
  const changeBookStatus = async () => {
    if (!pendingStatus || saving) return;
    const key = pendingStatus.publish ? 'book-publish' : 'book-disable';
    const id = operations.current[key] ?? operationId(); operations.current[key] = id;
    setSaving(true); setActionError('');
    const result = await client.changeCatalogStatus(pendingStatus.book.id,
      pendingStatus.book.draft?.version ?? 0, id, pendingStatus.publish);
    setSaving(false);
    if (!result.ok) { setActionError(result.error.message); return; }
    delete operations.current[key];
    notify(cloudReady ? (pendingStatus.publish ? '课本已发布给授权教师' : '课本已停用，历史任务保留')
      : '本地演示状态已记录，未写入云端');
    setPendingStatus(undefined); setSelectedBook(undefined);
    await load();
  };
  const showPreview = async (book: AdminTextbookBook) => {
    setActionError('');
    const result = await client.previewTextbook(book.id);
    if (!result.ok) { setActionError(result.error.message); return; }
    setPreview(result.data);
  };

  return <>
    <section className="page-hero"><span className="page-hero__icon"><Icon name="book" /></span><div><h2>教材中心管理</h2><p>配置教师端班级教材与同步学教材的展示及授权范围</p></div><Button variant="secondary" icon="refresh" onClick={() => void load()}>刷新</Button></section>
    {!cloudReady && <p className="textbook-demo-note">当前展示本地虚构数据。云端教材配置需连接非生产后台后验证。</p>}
    {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : overview && layout && <>
      <section className="panel textbook-admin-panel"><div className="panel-heading"><h2>教材中心展示设置</h2><span className="textbook-admin-status">{configured ? '已发布' : overview.settings ? '草稿' : '未配置'}</span></div>
        <div className="textbook-admin-grid"><div><h3>教师端模块</h3><label><input type="checkbox" checked={layout.classTextbooksEnabled} onChange={event => updateLayout({ classTextbooksEnabled: event.target.checked })} />班级教材</label><label><input type="checkbox" checked={layout.synchronizedTextbooksEnabled} onChange={event => updateLayout({ synchronizedTextbooksEnabled: event.target.checked })} />同步学教材</label><p>学校习题库与音视频材料按各自里程碑管理。</p></div>
          <div><h3>可见班级</h3>{overview.classes.filter(item => item.status === 'active' || layout.visibleClassIds.includes(item.id)).map(item => <label key={item.id}><input type="checkbox" checked={layout.visibleClassIds.includes(item.id)} onChange={event => updateLayout({ visibleClassIds: event.target.checked ? [...layout.visibleClassIds, item.id] : layout.visibleClassIds.filter(id => id !== item.id) })} />{item.name}　{item.grade}{item.status !== 'active' ? '（已归档，请取消勾选）' : ''}</label>)}{!overview.classes.some(item => item.status === 'active') && <p>暂无可配置班级</p>}</div>
          <div><h3>班级大盘字段</h3>{FIELD_CHOICES.map(field => <label key={field.id}><input type="checkbox" checked={layout.dashboardFields.includes(field.id)} onChange={event => updateLayout({ dashboardFields: event.target.checked ? [...layout.dashboardFields, field.id] : layout.dashboardFields.filter(id => id !== field.id) })} />{field.label}</label>)}</div></div>
        <div className="textbook-admin-actions"><Button variant="secondary" disabled={saving} onClick={() => void saveLayout(false)}>保存草稿</Button><Button disabled={saving || !layout.visibleClassIds.length} onClick={() => void saveLayout(true)}>发布教师端设置</Button></div>
        {overview.settings && <p className="textbook-admin-meta">版本 {overview.settings.version}　最近更新 {overview.settings.updatedAt.slice(0, 16)}　上次发布 {overview.settings.publishedAt?.slice(0, 16) ?? '暂无'}</p>}
      </section>
      <section className="panel textbook-admin-panel"><div className="panel-heading"><h2>同步学教材目录</h2><span>共 {rows.length} 本</span></div><div className="textbook-admin-filters"><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索课本、年级或版本"/><select value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="">全部班级</option>{overview.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        {rows.length ? <div className="table-scroll"><table className="textbook-admin-table"><thead><tr><th>课本</th><th>年级 / 学期</th><th>教材版本</th><th>目录</th><th>班级可见范围</th><th>状态 / 更新</th><th>操作</th></tr></thead><tbody>{rows.map(book => <tr key={book.id}><td><strong>{book.title}</strong><small>{book.id}</small></td><td>{book.grade}<br/>{book.term}</td><td>{book.edition}</td><td>{book.chapterCount} 个单元</td><td>{book.visibleClassIds.map(id => overview.classes.find(item => item.id === id)?.name ?? id).join('、') || '未发布范围'}</td><td><span className={`textbook-admin-status status-${book.status}`}>{STATUS_LABEL[book.status]}</span><small>{book.updatedAt?.slice(0, 16) ?? '未记录'}</small></td><td><button onClick={() => void showPreview(book)}>教师视角预览</button><button onClick={() => openBook(book)}>设置范围</button><button disabled={!book.draft || book.draft.status !== 'draft'} onClick={() => setPendingStatus({ book, publish: true })}>发布</button><button className="danger-link" disabled={book.status !== 'published' || !book.draft} onClick={() => setPendingStatus({ book, publish: false })}>停用</button></td></tr>)}</tbody></table></div> : <EmptyState title="暂无同步课本" description="当前没有已登记的授权教材；真实内容和版权接入将在试点前完成。" />}
      </section>
    </>}
    {actionError && !selectedBook && !pendingStatus && <p className="form-error" role="alert">{actionError}</p>}
    {selectedBook && overview && <Modal title={`设置课本范围：${selectedBook.title}`} onClose={() => { if (!saving) setSelectedBook(undefined); }}><div className="textbook-admin-modal"><p>仅勾选当前学校可见班级。保存为草稿后发布，教师端才会使用新范围。</p>{overview.classes.filter(item => item.status === 'active' || bookClassIds.includes(item.id)).map(item => <label key={item.id}><input type="checkbox" checked={bookClassIds.includes(item.id)} onChange={event => { setBookClassIds(event.target.checked ? [...bookClassIds, item.id] : bookClassIds.filter(id => id !== item.id)); delete operations.current.book; }} />{item.name}　{item.grade}{item.status !== 'active' ? '（已归档，请取消勾选）' : ''}</label>)}{actionError && <p className="form-error" role="alert">{actionError}</p>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={() => setSelectedBook(undefined)}>取消</Button><Button disabled={saving || !bookClassIds.length} onClick={() => void saveBook()}>{saving ? '保存中…' : '保存可见范围'}</Button></div></div></Modal>}
    {preview && <Modal title="教师视角预览" onClose={() => setPreview(undefined)}><div className="textbook-admin-modal"><h3>{preview.title}</h3><p>{preview.grade}　{preview.term}　{preview.edition}　{STATUS_LABEL[preview.status]}</p><h4>单元 / 课次目录</h4>{preview.chapters.length ? preview.chapters.map(chapter => <div key={chapter.id} className="textbook-admin-chapter"><strong>{chapter.title}</strong>{chapter.lessons.length ? <span>{chapter.lessons.map(lesson => lesson.title).join('、')}</span> : <span>暂无课次数据</span>}</div>) : <p>暂无章节目录</p>}<p>教材正文不可在此编辑；已发布任务使用原内容快照。</p><div className="form-actions"><Button onClick={() => setPreview(undefined)}>关闭</Button></div></div></Modal>}
    {pendingStatus && <Modal title={pendingStatus.publish ? '发布同步课本' : '停用同步课本'} onClose={() => { if (!saving) setPendingStatus(undefined); }}><div className="textbook-admin-modal"><p>{pendingStatus.publish ? `确认向所选班级发布“${pendingStatus.book.title}”？` : `确认停用“${pendingStatus.book.title}”？教师将不能新引用，历史任务和提交保留。`}</p>{actionError && <p className="form-error">{actionError}</p>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={() => setPendingStatus(undefined)}>取消</Button><Button variant={pendingStatus.publish ? 'primary' : 'danger'} disabled={saving} onClick={() => void changeBookStatus()}>{saving ? '处理中…' : '确认'}</Button></div></div></Modal>}
  </>;
}
