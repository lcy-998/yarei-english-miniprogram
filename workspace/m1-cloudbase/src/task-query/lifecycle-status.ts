import type { TaskRecord } from '../task-core/types';

/** Derive time-sensitive display state without mutating the published snapshot. */
export function taskLifecycleStatusAt(task: TaskRecord, nowIso: string): TaskRecord['status'] {
  if (task.status === 'draft' || task.status === 'withdrawn' || task.status === 'closed'
    || task.status === 'completed' || task.publishedAt === null) return task.status;
  const now = Date.parse(nowIso);
  const starts = Date.parse(task.startsAt);
  const due = Date.parse(task.dueAt);
  if (![now, starts, due].every(Number.isFinite)) return task.status;
  if (now < starts) return 'scheduled';
  if (now > due) return 'expired';
  return 'active';
}
