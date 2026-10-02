import type { AdminCloudResult } from '../cloud/admin-cloud-contract';
import type { AdminTextbookBook, AdminTextbookClient, AdminTextbookOverview, AdminTextbookPreview,
  TextbookCatalogDraft, TextbookLayout, TextbookSettings } from '../cloud/admin-textbook-client';
import type { AdminSnapshot } from '../domain/models';

const ok = <T>(data: T): AdminCloudResult<T> => ({ ok: true, data });
const fail = <T>(code: 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND', message: string): AdminCloudResult<T> => ({
  ok: false, error: { code, message, retryable: false },
});
export class MemoryTextbookAdminClient implements AdminTextbookClient {
  private settings: TextbookSettings | null = null;
  private receipts = new Map<string, { fingerprint: string; result: TextbookSettings }>();
  public constructor(private readonly snapshot: () => AdminSnapshot) {}
  public async getOverview(): Promise<AdminCloudResult<AdminTextbookOverview>> {
    return ok({ classes: this.snapshot().classes.map(item => ({ id: item.id, name: item.name,
      grade: item.grade, term: item.term, status: item.status === 'active' ? 'active' : 'archived' })),
    books: [] as AdminTextbookBook[], settings: this.settings === null ? null : structuredClone(this.settings) });
  }
  public async previewTextbook(_resourceId: string): Promise<AdminCloudResult<AdminTextbookPreview>> {
    return fail('NOT_FOUND', '当前本地演示没有已授权同步课本。');
  }
  public async saveSettings(layout: TextbookLayout, expectedVersion: number, operationId: string,
    publish: boolean): Promise<AdminCloudResult<TextbookSettings>> {
    if (!layout.visibleClassIds.length || !layout.dashboardFields.length
      || layout.visibleClassIds.some(id => !this.snapshot().classes.some(item => item.id === id && item.status === 'active'))) {
      return fail('VALIDATION_ERROR', '请选择至少一个当前可用班级和一个大盘字段。');
    }
    const fingerprint = JSON.stringify({ layout, expectedVersion, publish });
    const receipt = this.receipts.get(operationId);
    if (receipt) return receipt.fingerprint === fingerprint ? ok(structuredClone(receipt.result)) : fail('CONFLICT', '操作标识已经用于不同配置。');
    if ((this.settings?.version ?? 0) !== expectedVersion) return fail('CONFLICT', '配置已变化，请刷新后重试。');
    const now = new Date().toISOString();
    const result: TextbookSettings = { id: 'textbook_center_demo', organizationId: 'school-demo-001',
      draft: structuredClone(layout), published: publish ? structuredClone(layout) : this.settings?.published ?? null,
      status: publish ? 'published' : 'draft', version: expectedVersion + 1, updatedAt: now,
      publishedAt: publish ? now : this.settings?.publishedAt ?? null };
    this.settings = structuredClone(result);
    this.receipts.set(operationId, { fingerprint, result: structuredClone(result) });
    return ok(result);
  }
  public async saveCatalogDraft(): Promise<AdminCloudResult<TextbookCatalogDraft>> {
    return fail('NOT_FOUND', '当前本地演示没有可配置的同步课本。');
  }
  public async changeCatalogStatus(): Promise<AdminCloudResult<TextbookCatalogDraft>> {
    return fail('NOT_FOUND', '当前本地演示没有可发布的同步课本。');
  }
}
