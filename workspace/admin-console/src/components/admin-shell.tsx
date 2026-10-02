import type { ReactNode } from 'react';
import { Icon } from './ui';

export type PageKey = 'dashboard' | 'organization' | 'users' | 'permission' | 'textbooks' | 'questions' | 'task-activities';

const menus: Array<{ key?: PageKey; label: string; icon: string }> = [
  { key: 'dashboard', label: '工作台', icon: 'dashboard' },
  { key: 'organization', label: '学校/班级管理', icon: 'organization' },
  { key: 'users', label: '用户管理', icon: 'users' },
  { key: 'permission', label: '权限管理', icon: 'permission' },
  { key: 'textbooks', label: '教材中心管理', icon: 'book' },
  { key: 'questions', label: '学校习题库管理', icon: 'exercise' },
  { key: 'task-activities', label: '任务与活动管理', icon: 'tasks' },
  { label: '音视频审核管理', icon: 'media' },
];

export function AdminShell({ active, title, onNavigate, onRefresh, children }: { active: PageKey; title: string; onNavigate: (page: PageKey) => void; onRefresh: () => void; children: ReactNode }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand__mark">YR</div><div><strong>雅睿英语</strong><span>管理后台</span></div></div>
      <nav aria-label="后台主导航">{menus.map((menu) => <button key={menu.label} aria-label={menu.label} className={menu.key === active ? 'active' : ''} disabled={!menu.key} onClick={() => menu.key && onNavigate(menu.key)}><Icon name={menu.icon} /><span>{menu.label}</span>{!menu.key && <small>M2+</small>}</button>)}</nav>
      <div className="sidebar__motto">用专业，让每个孩子<br />看见更大的世界 <i /></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="topbar__title"><span>›</span><h1>{title}</h1></div>
        <div className="topbar__actions">
          <button className="school-switch"><Icon name="school" />启航实验学校⌄</button>
          <button className="top-button" onClick={onRefresh}><Icon name="refresh" />刷新</button>
          <button className="notification" aria-label="通知"><Icon name="bell" /><b>3</b></button>
          <div className="account"><span className="avatar">周</span><strong>周老师</strong><span>⌄</span></div>
        </div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>;
}
