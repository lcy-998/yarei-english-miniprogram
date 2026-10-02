import { useEffect, useRef, useState } from 'react';
import type { DeletedWorkDraftSummary } from '../cloud/admin-cloud-contract';
import type { OrganizationAdminClient } from '../cloud/organization-admin-client';
import type { UserAccount } from '../domain/models';
import { Button, EmptyState, ErrorState, LoadingState, Modal } from '../components/ui';
import './deleted-work-drafts-dialog.css';

type DraftClient = Pick<OrganizationAdminClient, 'listDeletedWorkDrafts' | 'restoreWorkDraft'>;
const PAGE_SIZE = 20;
const BLOCK_LABEL: Record<NonNullable<DeletedWorkDraftSummary['blockedReason']>, string> = {
  expired: '恢复期限已过', cleanup_locked: '暂存文件清理已锁定',
  staging_deleted: '暂存文件已清理', invalid_record: '草稿记录不符合恢复条件',
};
const CLEANUP_LABEL: Record<DeletedWorkDraftSummary['stagingCleanupStatus'], string> = {
  none: '未进入清理', deleting: '正在清理', deleted: '已清理', unknown: '清理状态待核对',
};
const RESTORE_FIELD_MESSAGES = new Set([
  '已提交作品不可按草稿恢复。', '草稿版本已变化，请刷新后重试。', '草稿已恢复。',
  '七天恢复期限已过。', '暂存文件清理已锁定。', '暂存文件已清理。',
  '草稿记录不符合恢复条件。',
]);

function dateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
function operationId(): string {
  return `work-restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
export function blockedLabel(item: DeletedWorkDraftSummary, now = Date.now()): string | null {
  if (item.blockedReason !== null) return BLOCK_LABEL[item.blockedReason];
  if (item.stagingCleanupStatus !== 'none') return CLEANUP_LABEL[item.stagingCleanupStatus];
  return Date.parse(item.recoverableUntil) <= now ? '恢复期限已过' : null;
}
function restoreError(error: { code: string; message: string; fieldErrors?: Readonly<Record<string, string>> }): string {
  if (error.code === 'FORBIDDEN') return '当前后台账号没有作品草稿恢复权限。';
  const detail = error.fieldErrors?.workId;
  return detail && RESTORE_FIELD_MESSAGES.has(detail) ? detail : error.message;
}

export function DeletedWorkDraftsDialog({ student, client, onClose, notify }: {
  student: UserAccount; client: DraftClient; onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}) {
  const [items, setItems] = useState<DeletedWorkDraftSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [failedOffset, setFailedOffset] = useState<number | null>(null);
  const [target, setTarget] = useState<DeletedWorkDraftSummary>();
  const [reason, setReason] = useState('');
  const [restoreOperationId, setRestoreOperationId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const requestEpoch = useRef(0);

  const load = async (offset: number) => {
    const request = ++requestEpoch.current;
    setLoading(true); setListError(''); setFailedOffset(null);
    const result = await client.listDeletedWorkDrafts({ studentId: student.id,
      page: { limit: PAGE_SIZE, offset } });
    if (request !== requestEpoch.current) return;
    setLoading(false);
    if (!result.ok) {
      setListError(result.error.code === 'FORBIDDEN' ? '当前后台账号没有作品草稿恢复权限。' : result.error.message);
      setFailedOffset(offset);
      return;
    }
    setItems(previous => offset === 0 ? [...result.data.items] : [...previous, ...result.data.items]);
    setNextOffset(result.data.nextOffset);
  };

  useEffect(() => {
    void load(0);
    return () => { requestEpoch.current += 1; };
  }, [client, student.id]);

  const choose = (item: DeletedWorkDraftSummary) => {
    if (blockedLabel(item) !== null) return;
    setTarget(item); setReason(''); setConfirming(false); setActionError('');
    setRestoreOperationId(operationId());
  };
  const confirm = () => {
    if (!target || blockedLabel(target) !== null) { setActionError('此草稿已不可恢复，请刷新记录。'); return; }
    if (!reason.trim() || reason.trim().length > 200) { setActionError('请填写 1—200 字的恢复原因。'); return; }
    setActionError(''); setConfirming(true);
  };
  const restore = async () => {
    if (!target || !confirming || busy) return;
    setBusy(true); setActionError('');
    const result = await client.restoreWorkDraft({ studentId: student.id, workId: target.id,
      expectedVersion: target.version, operationId: restoreOperationId, reason: reason.trim() });
    setBusy(false); setConfirming(false);
    if (!result.ok) { setActionError(restoreError(result.error)); return; }
    notify('已删作品草稿已恢复，学生可在“我的作品”查看。');
    setTarget(undefined); setReason(''); setRestoreOperationId('');
    await load(0);
  };

  return <Modal title={`已删作品草稿：${student.name}`} onClose={() => { if (!busy) onClose(); }}>
    <div className="deleted-work-drafts">
      <p className="form-hint">仅列出该学生的已删自主配音草稿。恢复须由当前组织的授权管理员执行并留审计记录。</p>
      {loading && items.length === 0 ? <LoadingState />
        : listError && items.length === 0 ? <ErrorState message={listError} onRetry={() => void load(failedOffset ?? 0)} />
          : items.length === 0 ? <EmptyState title="暂无已删草稿" description="当前学生没有可查看的已删作品草稿。" />
            : <ul className="deleted-work-drafts__list">{items.map(item => <li key={item.id}>
              <strong>{item.materialTitle?.trim() || '素材已不可用'}</strong>
              <small>作品 ID：{item.id}</small>
              <small>删除时间：{dateTime(item.deletedAt)}</small>
              <small>恢复截止：{dateTime(item.recoverableUntil)}</small>
              <small>清理状态：{CLEANUP_LABEL[item.stagingCleanupStatus]}</small>
              {blockedLabel(item) === null ? <Button variant="secondary" disabled={busy} onClick={() => choose(item)}>选择恢复</Button>
                : <span className="deleted-work-drafts__blocked">{blockedLabel(item)}</span>}
            </li>)}</ul>}
      {listError && items.length > 0 && <p className="form-error" role="alert">{listError} <button onClick={() => void load(failedOffset ?? 0)}>重试加载</button></p>}
      {nextOffset !== null && <Button variant="secondary" disabled={loading || busy} onClick={() => void load(nextOffset)}>{loading ? '加载中…' : '加载更多'}</Button>}
      {target && <div className="deleted-work-drafts__restore">
        <h3>恢复作品 {target.id}</h3>
        {confirming ? <>
          <p>请再次确认恢复“{target.materialTitle?.trim() || '素材已不可用'}”的作品草稿。此操作会记录管理员、原因和当前版本。</p>
          <p className="form-hint">恢复原因：{reason.trim()}</p>
          <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>返回修改</Button>
            <Button disabled={busy} onClick={() => void restore()}>{busy ? '恢复中…' : '确认恢复'}</Button></div>
        </> : <>
          <label>恢复原因<textarea maxLength={200} value={reason} onChange={event => {
            setReason(event.target.value); setRestoreOperationId(operationId()); setActionError('');
          }} placeholder="填写恢复原因（1—200 字）" /></label>
          {actionError && <p className="form-error" role="alert">{actionError}</p>}
          <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setTarget(undefined)}>取消</Button>
            <Button disabled={busy || !reason.trim()} onClick={confirm}>下一步确认</Button></div>
        </>}
      </div>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>关闭</Button></div>
    </div>
  </Modal>;
}
