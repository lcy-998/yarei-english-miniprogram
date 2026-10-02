import type { AdminSnapshot } from '../domain/models';
import type { PageKey } from '../components/admin-shell';
import { Icon } from '../components/ui';

export function DashboardPage({ snapshot, onNavigate }: { snapshot: AdminSnapshot; onNavigate: (page: PageKey) => void }) {
  const activeUsers = snapshot.users.filter((user) => user.status === 'active').length;
  const metrics = [
    { icon: 'school', label: '学校数量', value: snapshot.schools.length, tone: 'blue', page: 'organization' as PageKey },
    { icon: 'classes', label: '班级数量', value: snapshot.classes.filter((item) => item.status === 'active').length, tone: 'green', page: 'organization' as PageKey },
    { icon: 'user', label: '用户数量', value: activeUsers, tone: 'orange', page: 'users' as PageKey },
    { icon: 'activity', label: '任务与活动', value: '查看', tone: 'purple', page: 'task-activities' as PageKey },
  ];
  return <div className="dashboard">
    <section className="metric-grid">{metrics.map((metric) => <button key={metric.label} className="metric-card" onClick={() => metric.page && onNavigate(metric.page)} disabled={!metric.page}>
      <span className={`metric-card__icon tone-${metric.tone}`}><Icon name={metric.icon} /></span><span><b>{metric.label}</b><strong className={`text-${metric.tone}`}>{metric.value}</strong></span>
    </button>)}</section>
    <section className="dashboard-grid">
      <article className="panel completion-panel"><h2><Icon name="chart" />完成概览</h2><div className="chart-layout"><div className="completion-rate"><span>今日任务完成率</span><strong>75<em>%</em></strong></div><div className="chart" aria-label="近七天任务完成率折线图"><div className="chart__bars">{[25, 35, 42, 50, 60, 67, 75].map((value, index) => <div key={value}><i style={{ height: `${value}%` }} /><b style={{ bottom: `${value}%` }} /><span>9/{10 + index}</span></div>)}</div></div></div></article>
      <article className="panel todo-panel"><h2><Icon name="todo" />管理员待办</h2>{[
        ['media', '待审核媒体', '2', 'green'], ['alert', '异常任务', '1', 'yellow'], ['user', '待处理账号', '3', 'orange'],
      ].map(([icon, label, value, tone]) => <button key={label} className={`todo tone-soft-${tone}`}><span className={`todo__icon tone-${tone}`}><Icon name={icon} /></span><span><b>{label}</b><strong>{value}</strong></span><Icon name="arrow" /></button>)}</article>
      <article className="panel quick-panel"><h2><Icon name="dashboard" />快捷入口</h2><div>{([
        ['users', '新建班级', 'organization', 'blue'], ['user', '创建用户', 'users', 'green'], ['shield', '权限配置', 'permission', 'purple'], ['media', '媒体审核', undefined, 'orange'],
      ] as Array<[string, string, PageKey | undefined, string]>).map(([icon, label, page, tone]) => <button key={label} onClick={() => page && onNavigate(page)} disabled={!page}><span className={`tone-soft-${tone}`}><Icon name={icon} /></span>{label}</button>)}</div></article>
      <article className="panel audit-panel"><h2><Icon name="audit" />最近操作</h2><table><thead><tr><th>时间</th><th>操作人</th><th>操作内容</th><th>结果</th></tr></thead><tbody>{snapshot.audits.slice(0, 4).map((record) => <tr key={record.id}><td>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</td><td>周老师</td><td>{record.action} {record.target}</td><td><span className="status status--active">操作成功</span></td></tr>)}</tbody></table></article>
    </section>
  </div>;
}
