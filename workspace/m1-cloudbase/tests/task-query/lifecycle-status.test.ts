import { describe, expect, it } from 'vitest';
import { taskLifecycleStatusAt } from '../../src/task-query/lifecycle-status';
import type { TaskRecord } from '../../src/task-core/types';

const published = {
  status: 'scheduled', publishedAt: '2026-10-01T08:00:00+08:00',
  startsAt: '2026-10-02T08:00:00+08:00', dueAt: '2026-10-02T18:00:00+08:00',
} as TaskRecord;

describe('teacher task lifecycle display state', () => {
  it('moves from scheduled through active to expired by instant, without a write', () => {
    expect(taskLifecycleStatusAt(published, '2026-10-01T23:59:59Z')).toBe('scheduled');
    expect(taskLifecycleStatusAt(published, '2026-10-02T00:00:00Z')).toBe('active');
    expect(taskLifecycleStatusAt(published, '2026-10-02T10:00:01Z')).toBe('expired');
    expect(published.status).toBe('scheduled');
  });

  it('preserves explicit terminal states and unpublished drafts', () => {
    for (const status of ['draft', 'withdrawn', 'closed', 'completed'] as const) {
      expect(taskLifecycleStatusAt({ ...published, status }, '2026-10-03T00:00:00Z')).toBe(status);
    }
    expect(taskLifecycleStatusAt({ ...published, publishedAt: null }, '2026-10-03T00:00:00Z')).toBe('scheduled');
  });
});
