import type { ReactNode } from 'react';

export type SemanticTone = 'neutral' | 'primary' | 'success' | 'warning' | 'urgent' | 'danger' | 'ai';

export function SemanticStatus({ tone = 'neutral', children }: { tone?: SemanticTone; children: ReactNode }) {
  return <span className={`semantic-status semantic-status--${tone}`} role="status">{children}</span>;
}

export function FilterToolbar({ children, resultCount, actions }: { children: ReactNode; resultCount?: number; actions?: ReactNode }) {
  return <div className="filter-toolbar" role="search">
    <div className="filter-toolbar__fields">{children}</div>
    {typeof resultCount === 'number' && <span className="filter-toolbar__count">共 {resultCount} 条</span>}
    {actions && <div className="filter-toolbar__actions">{actions}</div>}
  </div>;
}

export function ProgressBar({ value, label, tone = 'primary' }: { value: number; label: string; tone?: SemanticTone }) {
  const normalized = Math.max(0, Math.min(100, value));
  return <div className="visual-progress" aria-label={`${label} ${normalized}%`}>
    <div className="visual-progress__meta"><span>{label}</span><strong>{normalized}%</strong></div>
    <div className="visual-progress__track"><span className={`visual-progress__fill visual-progress__fill--${tone}`} style={{ width: `${normalized}%` }} /></div>
  </div>;
}

export function SideDrawer({ title, description, children, footer, onClose }: { title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="side-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="side-drawer__header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="side-drawer__body">{children}</div>
      {footer && <footer className="side-drawer__footer">{footer}</footer>}
    </aside>
  </div>;
}

export function ReviewCheckList({ items }: { items: Array<{ id: string; label: string; detail?: string; tone: SemanticTone }> }) {
  return <div className="review-check-list">
    {items.map((item) => <div className="review-check" key={item.id}><SemanticStatus tone={item.tone}>{item.label}</SemanticStatus>{item.detail && <span>{item.detail}</span>}</div>)}
  </div>;
}
