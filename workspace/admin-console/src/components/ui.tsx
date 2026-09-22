import type { ReactNode } from 'react';

export function Icon({ name }: { name: string }) {
  const glyphs: Record<string, string> = {
    dashboard: '⌂', organization: '▥', users: '♙', permission: '◇', book: '▤', exercise: '▧', tasks: '☑', media: '▷', refresh: '↻', alert: '!', school: '▦', search: '⌕', close: '×', audit: '◷', menu: '☰', add: '+', bell: '♟', chart: '▥', todo: '▣', arrow: '›', check: '✓', edit: '✎', link: '⌁', reset: '↺', disable: '⊘', user: '●', shield: '◆', classes: '♣', activity: '▣', success: '✓', warning: '!', error: '×', info: 'i',
  };
  return <span className="icon" aria-hidden="true">{glyphs[name] ?? '•'}</span>;
}

export function Button({ children, variant = 'primary', icon, onClick, disabled, type = 'button' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'text'; icon?: string; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} className={`button button--${variant}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} />}{children}</button>;
}

export function StatusTag({ status }: { status: 'active' | 'disabled' }) {
  return <span className={`status status--${status}`}>{status === 'active' ? '启用' : '停用'}</span>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal__header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      {children}
    </section>
  </div>;
}

export function ConfirmDialog({ title, description, confirmText = '确认', onConfirm, onCancel }: { title: string; description: string; confirmText?: string; onConfirm: () => void; onCancel: () => void }) {
  return <Modal title={title} onClose={onCancel}><div className="confirm"><div className="confirm__mark"><Icon name="warning" /></div><p>{description}</p><div className="form-actions"><Button variant="secondary" onClick={onCancel}>取消</Button><Button variant="danger" onClick={onConfirm}>{confirmText}</Button></div></div></Modal>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty"><span className="empty__icon">◇</span><strong>{title}</strong><span>{description}</span></div>;
}

export function LoadingState() {
  return <div className="loading" aria-label="正在加载"><span /><span /><span /></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="empty empty--error"><span className="empty__icon">!</span><strong>加载失败</strong><span>{message}</span><Button variant="secondary" onClick={onRetry}>重新加载</Button></div>;
}
