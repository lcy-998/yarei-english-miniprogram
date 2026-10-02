import { describe, expect, it } from 'vitest';
import { ADMIN_SEED } from '../src/services/seed';
import { MemoryTextbookAdminClient } from '../src/services/memory-textbook-admin-client';

describe('M2 local textbook administrator preview', () => {
  it('shows only existing fictional classes and keeps draft separate from published layout', async () => {
    const client = new MemoryTextbookAdminClient(() => ADMIN_SEED);
    const overview = await client.getOverview();
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.data.books).toEqual([]);
    const activeClass = overview.data.classes.find(item => item.status === 'active')!;
    const layout = { classTextbooksEnabled: true, synchronizedTextbooksEnabled: false,
      visibleClassIds: [activeClass.id], dashboardFields: ['grade' as const] };
    const saved = await client.saveSettings(layout, 0, 'operation_textbook_memory_save', false);
    expect(saved).toMatchObject({ ok: true, data: { status: 'draft', published: null, version: 1 } });
    const published = await client.saveSettings(layout, 1, 'operation_textbook_memory_publish', true);
    expect(published).toMatchObject({ ok: true, data: { status: 'published',
      published: { synchronizedTextbooksEnabled: false }, version: 2 } });
    expect(await client.saveSettings(layout, 1, 'operation_textbook_memory_stale', true))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await client.previewTextbook('nonexistent')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
