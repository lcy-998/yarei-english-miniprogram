import { useMemo, useState, type FormEvent } from 'react';
import type { AdminSnapshot, UserAccount, UserKind } from '../domain/models';
import type { AdminService, CreateUserInput } from '../services/admin-service';
import { Button, ConfirmDialog, EmptyState, Icon, Modal, StatusTag } from '../components/ui';

const kindNames: Record<UserKind, string> = { student: '学生', parent: '家长', teacher: '教师', staff: '员工' };
const emptyForm = (): CreateUserInput => ({ schoolId: 'school-demo-001', kind: 'student', name: '', mobile: '', roleLabel: '学生', classId: 'class-grade3-02' });

export function UsersPage({ snapshot, service, onChanged, notify }: { snapshot: AdminSnapshot; service: AdminService; onChanged: () => Promise<void>; notify: (message: string, type?: 'success' | 'error') => void }) {
  const [tab, setTab] = useState<'all' | UserKind>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateUserInput>(emptyForm());
  const [editing, setEditing] = useState<UserAccount>();
  const [disableTarget, setDisableTarget] = useState<UserAccount>();
  const [bindingTarget, setBindingTarget] = useState<UserAccount>();
  const [bindingDelta, setBindingDelta] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => snapshot.users.filter((user) => (tab === 'all' || user.kind === tab) && (status === '全部状态' || user.status === status) && `${user.name}${user.mobileMasked}`.toLowerCase().includes(search.toLowerCase())), [snapshot.users, tab, status, search]);
  const openCreate = () => { setEditing(undefined); setForm(emptyForm()); setError(''); setFormOpen(true); };
  const openEdit = (user: UserAccount) => { setEditing(user); setForm({ schoolId: user.schoolId, kind: user.kind, name: user.name, mobile: '', roleLabel: user.roleLabel, classId: user.classId }); setError(''); setFormOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    const result = editing ? await service.updateUser(editing.id, form.name, form.roleLabel, editing.version) : await service.createUser(form);
    setSaving(false); if (!result.ok) { setError(result.message); return; }
    notify(editing ? '用户信息已保存' : '用户创建成功'); setFormOpen(false); await onChanged();
  };
  const disable = async () => {
    if (!disableTarget) return;
    const result = await service.disableUser(disableTarget.id, disableTarget.version);
    if (!result.ok) notify(result.message, 'error'); else { notify('账号已停用'); await onChanged(); }
    setDisableTarget(undefined);
  };
  const reset = async (user: UserAccount) => {
    const result = await service.resetPassword(user.id);
    notify(result.ok ? `已生成安全重置流程：${result.data.resetTicket}` : result.message, result.ok ? 'success' : 'error');
    if (result.ok) await onChanged();
  };
  const updateBinding = async () => {
    if (!bindingTarget) return;
    const result = await service.updateBindingCount(bindingTarget.id, bindingDelta, bindingTarget.version);
    if (!result.ok) { setError(result.message); return; }
    notify(bindingDelta > 0 ? '绑定关系已增加' : '绑定关系已解除'); setBindingTarget(undefined); await onChanged();
  };
  return <>
    <section className="page-hero"><span className="page-hero__icon"><Icon name="users" /></span><div><h2>用户管理</h2><p>管理学生、家长、教师和员工账号及绑定关系</p></div><Button icon="add" onClick={openCreate}>新建用户</Button></section>
    <section className="panel users-panel">
      <div className="user-filters"><div className="tabs">{([['all', '全部'], ['student', '学生'], ['parent', '家长'], ['teacher', '教师'], ['staff', '员工']] as const).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div><select value={status} onChange={(event) => setStatus(event.target.value)}><option>全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select><label className="search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名或手机号" /></label></div>
      <p className="list-count">共 {rows.length} 位用户</p>
      {rows.length === 0 ? <EmptyState title="暂无匹配用户" description="请调整用户类型、状态或关键词" /> : <div className="table-scroll"><table><thead><tr><th>用户</th><th>类型</th><th>手机号</th><th>角色/班级</th><th>绑定</th><th>账号状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{rows.map((user) => <tr key={user.id}><td><div className={`user-cell user-${user.kind}`}><span>{user.name.slice(0, 1)}</span><strong>{user.name}</strong></div></td><td><span className={`kind-tag kind-${user.kind}`}>{kindNames[user.kind]}</span></td><td>{user.mobileMasked}</td><td>{user.roleLabel}</td><td>{user.bindingCount ? `${user.kind === 'parent' ? '孩子' : user.kind === 'student' ? '家长' : '班级'} ${user.bindingCount}` : '—'}</td><td><StatusTag status={user.status} /></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '从未登录'}</td><td className="row-actions"><button onClick={() => openEdit(user)}>编辑</button>{(user.kind === 'student' || user.kind === 'parent') && <button onClick={() => { setBindingTarget(user); setBindingDelta(1); setError(''); }}>绑定关系</button>}{(user.kind === 'teacher' || user.kind === 'staff') && <button onClick={() => reset(user)}>重置密码</button>}<button className="danger-link" disabled={user.status === 'disabled'} onClick={() => setDisableTarget(user)}>停用</button></td></tr>)}</tbody></table></div>}
    </section>
    {formOpen && <Modal title={editing ? '编辑用户' : '新建用户'} onClose={() => setFormOpen(false)}><form className="form" onSubmit={save}><div className="form-row"><label>用户类型<select disabled={Boolean(editing)} value={form.kind} onChange={(event) => { const kind = event.target.value as UserKind; setForm({ ...form, kind, roleLabel: kindNames[kind], classId: kind === 'student' || kind === 'teacher' ? 'class-grade3-02' : undefined }); }}><option value="student">学生</option><option value="parent">家长</option><option value="teacher">教师</option><option value="staff">员工</option></select></label><label>姓名<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="请输入姓名" /></label></div>{!editing && <label>手机号<input value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value.replace(/\D/g, '').slice(0, 11) })} placeholder="仅用于创建虚构测试账号" /></label>}<label>角色<input value={form.roleLabel} onChange={(event) => setForm({ ...form, roleLabel: event.target.value })} /></label>{(form.kind === 'student' || form.kind === 'teacher') && <label>所属班级<select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>{snapshot.classes.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{error && <p className="form-error">{error}</p>}<div className="form-actions"><Button variant="secondary" onClick={() => setFormOpen(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></div></form></Modal>}
    {bindingTarget && <Modal title={`绑定关系 · ${bindingTarget.name}`} onClose={() => setBindingTarget(undefined)}><div className="form"><p className="form-hint">当前绑定 {bindingTarget.bindingCount} 个{bindingTarget.kind === 'parent' ? '孩子' : '家长'}。家长最多 5 个孩子，学生最多 3 个家长。</p><div className="binding-choice"><button className={bindingDelta === 1 ? 'active' : ''} onClick={() => setBindingDelta(1)}>新增一条虚构绑定</button><button className={bindingDelta === -1 ? 'active' : ''} onClick={() => setBindingDelta(-1)}>解除一条绑定</button></div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><Button variant="secondary" onClick={() => setBindingTarget(undefined)}>取消</Button><Button onClick={updateBinding}>{bindingDelta > 0 ? '确认绑定' : '确认解绑'}</Button></div></div></Modal>}
    {disableTarget && <ConfirmDialog title="确认停用账号？" description={`${disableTarget.name} 停用后将不能登录。系统会阻止停用当前登录管理员。`} confirmText="确认停用" onCancel={() => setDisableTarget(undefined)} onConfirm={disable} />}
  </>;
}
