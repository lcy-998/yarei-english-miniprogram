import { useMemo, useState, type FormEvent } from 'react';
import type { AdminSnapshot, ClassRoom } from '../domain/models';
import type { AdminService, CreateClassInput } from '../services/admin-service';
import { Button, ConfirmDialog, EmptyState, Icon, Modal, StatusTag } from '../components/ui';

const EMPTY_FORM: CreateClassInput = { schoolId: 'school-demo-001', name: '', grade: '三年级', term: '2026 秋季' };

export function OrganizationPage({ snapshot, service, onChanged, notify }: { snapshot: AdminSnapshot; service: AdminService; onChanged: () => Promise<void>; notify: (message: string, type?: 'success' | 'error') => void }) {
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('全部年级');
  const [status, setStatus] = useState('全部状态');
  const [form, setForm] = useState<CreateClassInput>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRoom>();
  const [assigning, setAssigning] = useState<ClassRoom>();
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [disableTarget, setDisableTarget] = useState<ClassRoom>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => snapshot.classes.filter((item) => (grade === '全部年级' || item.grade === grade) && (status === '全部状态' || item.status === status) && item.name.toLowerCase().includes(search.toLowerCase())), [snapshot.classes, grade, status, search]);
  const teachers = snapshot.users.filter((user) => user.kind === 'teacher' && user.status === 'active');
  const openCreate = () => { setForm({ ...EMPTY_FORM }); setEditing(undefined); setError(''); setFormOpen(true); };
  const openEdit = (item: ClassRoom) => { setEditing(item); setForm({ schoolId: item.schoolId, name: item.name, grade: item.grade, term: item.term }); setError(''); setFormOpen(true); };
  const closeForm = () => { setForm({ ...EMPTY_FORM }); setEditing(undefined); setError(''); setFormOpen(false); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    const result = editing ? await service.updateClass(editing.id, form, editing.version) : await service.createClass(form);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    notify(editing ? '班级信息已保存' : '班级创建成功'); closeForm(); await onChanged();
  };
  const saveTeachers = async () => {
    if (!assigning) return; setSaving(true); setError('');
    const result = await service.assignTeachers(assigning.id, teacherIds, assigning.version); setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    notify('教师分配已更新'); setAssigning(undefined); await onChanged();
  };
  const disable = async () => {
    if (!disableTarget) return;
    const result = await service.disableClass(disableTarget.id, disableTarget.version);
    if (!result.ok) notify(result.message, 'error'); else { notify('班级已停用'); await onChanged(); }
    setDisableTarget(undefined);
  };
  return <>
    <section className="page-hero"><span className="page-hero__icon"><Icon name="organization" /></span><div><h2>学校与班级</h2><p>维护学校组织、班级与教师分配</p></div><Button icon="add" onClick={openCreate}>新建班级</Button></section>
    <section className="organization-layout">
      <article className="panel organization-tree"><div className="panel-heading"><h2><Icon name="organization" />组织结构</h2></div><label className="search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索学校或班级" /></label><div className="tree-school"><b>⌄ <Icon name="school" />启航实验学校</b>{snapshot.classes.map((item, index) => <button key={item.id} className={index === 0 ? 'active' : ''}><Icon name="users" />{item.name}<span>{item.studentCount}人</span></button>)}</div></article>
      <article className="panel organization-table"><div className="panel-heading"><h2><Icon name="tasks" />班级列表</h2><div className="filters"><select value={grade} onChange={(event) => setGrade(event.target.value)}><option>全部年级</option><option>三年级</option><option>四年级</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option>全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></div></div>{rows.length === 0 ? <EmptyState title="暂无匹配班级" description="请调整搜索或筛选条件" /> : <div className="table-scroll"><table><thead><tr><th>班级名称</th><th>年级</th><th>学期</th><th>班主任/教师</th><th>学生人数</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.grade}</td><td>{item.term}</td><td>{item.teacherIds.map((id) => snapshot.users.find((user) => user.id === id)?.name).filter(Boolean).join('、') || '未分配'}</td><td>{item.studentCount}</td><td><StatusTag status={item.status} /></td><td className="row-actions"><button onClick={() => openEdit(item)}>编辑</button><button onClick={() => { setAssigning(item); setTeacherIds(item.teacherIds); setError(''); }}>分配教师</button><button className="danger-link" disabled={item.status === 'disabled'} onClick={() => setDisableTarget(item)}>停用</button></td></tr>)}</tbody></table></div>}</article>
    </section>
    {formOpen && <Modal title={editing ? '编辑班级' : '新建班级'} onClose={closeForm}><form className="form" onSubmit={save}><label>班级名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：五年级 1 班" /></label><div className="form-row"><label>年级<select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })}><option>三年级</option><option>四年级</option><option>五年级</option></select></label><label>学期<input value={form.term} onChange={(event) => setForm({ ...form, term: event.target.value })} /></label></div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><Button variant="secondary" onClick={closeForm}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></div></form></Modal>}
    {assigning && <Modal title={`分配教师　${assigning.name}`} onClose={() => setAssigning(undefined)}><div className="form"><p className="form-hint">可为同一班级分配多位启用状态的教师。</p><div className="check-list">{teachers.map((teacher) => <label key={teacher.id}><input type="checkbox" checked={teacherIds.includes(teacher.id)} onChange={(event) => setTeacherIds(event.target.checked ? [...teacherIds, teacher.id] : teacherIds.filter((id) => id !== teacher.id))} /><span>{teacher.name}<small>{teacher.mobileMasked}</small></span></label>)}</div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><Button variant="secondary" onClick={() => setAssigning(undefined)}>取消</Button><Button onClick={saveTeachers} disabled={saving}>{saving ? '保存中…' : '保存分配'}</Button></div></div></Modal>}
    {disableTarget && <ConfirmDialog title="确认停用班级？" description={`${disableTarget.name} 停用后将从可用班级列表移除；仍有未迁移学生时系统会拒绝操作。`} confirmText="确认停用" onCancel={() => setDisableTarget(undefined)} onConfirm={disable} />}
  </>;
}
