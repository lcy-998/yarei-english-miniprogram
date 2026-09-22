import { useEffect, useMemo, useState } from 'react';
import { PERMISSION_GROUPS, type AdminSnapshot, type PermissionKey, type RoleDefinition } from '../domain/models';
import type { AdminService } from '../services/admin-service';
import { Button, Icon, Modal } from '../components/ui';

export function PermissionPage({ snapshot, service, onChanged, notify }: { snapshot: AdminSnapshot; service: AdminService; onChanged: () => Promise<void>; notify: (message: string, type?: 'success' | 'error') => void }) {
  const [roleId, setRoleId] = useState(snapshot.roles[0]?.id ?? '');
  const role = useMemo(() => snapshot.roles.find((item) => item.id === roleId) ?? snapshot.roles[0], [snapshot.roles, roleId]);
  const [permissions, setPermissions] = useState<PermissionKey[]>(role?.permissions ?? []);
  const [dataScope, setDataScope] = useState<RoleDefinition['dataScope']>(role?.dataScope ?? 'all-schools');
  const [schoolIds, setSchoolIds] = useState<string[]>(role?.schoolIds ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  useEffect(() => { if (role) { setPermissions(role.permissions); setDataScope(role.dataScope); setSchoolIds(role.schoolIds); setError(''); } }, [role]);
  if (!role) return null;
  const initial = new Set(role.permissions);
  const changed = permissions.filter((key) => !initial.has(key)).length + role.permissions.filter((key) => !permissions.includes(key)).length + (dataScope !== role.dataScope ? 1 : 0);
  const toggle = (key: PermissionKey) => setPermissions((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  const reset = () => { setPermissions(role.permissions); setDataScope(role.dataScope); setSchoolIds(role.schoolIds); setError(''); };
  const save = async () => {
    setSaving(true); setError('');
    const result = await service.updateRole({ roleId: role.id, permissions, dataScope, schoolIds, expectedVersion: role.version });
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    notify('权限配置已保存并发布'); await onChanged();
  };
  return <>
    <section className="permission-heading"><div><h2>权限管理</h2><p>配置角色、菜单、功能权限与数据范围</p></div><Button variant="secondary" icon="audit" onClick={() => setAuditOpen(true)}>查看变更记录</Button></section>
    <section className="permission-layout">
      <article className="panel role-list"><div className="panel-heading"><h2>角色列表</h2><Button icon="add" disabled>新建角色</Button></div><label className="search"><Icon name="search" /><input placeholder="搜索角色" /></label>{snapshot.roles.map((item) => <button key={item.id} className={item.id === role.id ? 'active' : ''} onClick={() => setRoleId(item.id)}><span><strong>{item.name}</strong>{item.system && <small>系统</small>}</span>{!item.system && <span>{item.memberCount} 人　›</span>}</button>)}</article>
      <article className="panel permission-tree"><h2>权限配置</h2><div className="permission-tabs"><button className="active">菜单权限</button><button>功能权限</button></div>{PERMISSION_GROUPS.map((group) => <section key={group.title} className="permission-group"><h3><span>⌄</span><label><input type="checkbox" checked={group.items.every((item) => permissions.includes(item.key))} onChange={(event) => { const keys = group.items.map((item) => item.key); setPermissions(event.target.checked ? [...new Set([...permissions, ...keys])] : permissions.filter((item) => !keys.includes(item))); }} />{group.title}</label></h3>{group.items.map((item) => <label key={item.key}><input type="checkbox" checked={permissions.includes(item.key)} onChange={() => toggle(item.key)} />{item.label}</label>)}</section>)}</article>
      <article className="panel scope-panel"><h2>数据范围</h2><div className="radio-list">{([['all-schools', '全部学校'], ['selected-schools', '指定学校'], ['self-created', '仅本人创建']] as const).map(([value, label]) => <label key={value}><input type="radio" name="scope" checked={dataScope === value} onChange={() => setDataScope(value)} />{label}</label>)}</div><div className="scope-summary"><h3>已授权范围</h3><p><Icon name="school" />启航实验学校</p><p><Icon name="users" />{dataScope === 'self-created' ? '本人创建的数据' : '全部班级'}</p></div><div className="change-summary"><Icon name="warning" /><div><strong>本次变更 <b>{changed}</b> 项</strong><span>{changed ? '请确认后保存发布' : '当前配置未修改'}</span></div></div>{error && <p className="form-error">{error}</p>}<div className="scope-actions"><Button variant="secondary" onClick={reset} disabled={changed === 0}>重置</Button><Button onClick={save} disabled={saving || changed === 0}>{saving ? '保存中…' : '保存并发布'}</Button></div></article>
    </section>
    {auditOpen && <Modal title="权限变更记录" onClose={() => setAuditOpen(false)}><div className="audit-list">{snapshot.audits.filter((item) => item.action.includes('权限')).length ? snapshot.audits.filter((item) => item.action.includes('权限')).map((item) => <article key={item.id}><strong>{item.action} · {item.target}</strong><span>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })} · 周老师</span></article>) : <p className="form-hint">暂无权限变更记录。</p>}</div><div className="form-actions"><Button onClick={() => setAuditOpen(false)}>关闭</Button></div></Modal>}
  </>;
}
