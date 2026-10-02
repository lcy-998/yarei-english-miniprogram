import type { TrustedActorContext } from '../auth/trusted-actor';
import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import { TextbookError } from './types';
import { TEXTBOOK_DASHBOARD_FIELDS, type AdminTextbookBook, type AdminTextbookOverview, type AdminTextbookPreview,
  type TextbookCatalogDraft, type TextbookCenterLayout, type TextbookCenterSettings } from './admin-types';

export const TEXTBOOK_ADMIN_COLLECTIONS = { classes: 'classes', resources: 'learning_resources',
  catalogDrafts: 'textbook_catalog_drafts', settings: 'textbook_center_settings',
  receipts: 'textbook_admin_operations', audits: 'operation_logs' } as const;
export interface TextbookAdminClock { nowIso(): string }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function visible(value: VersionedDocument | null, organizationId: string): value is VersionedDocument {
  return value !== null && value.organizationId === organizationId && value.deletedAt === null;
}
function id(value: string): boolean { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
function gradeValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}
function operationId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value); }
function settingsId(organizationId: string): string { return `textbook_center_${organizationId}`; }
function catalogDraftId(organizationId: string, resourceId: string): string {
  return `textbook_catalog_${hashHex(JSON.stringify([organizationId, resourceId]))}`;
}
function receiptId(organizationId: string, actorId: string, operation: string): string {
  return `textbook_admin_operation_${hashHex(JSON.stringify([organizationId, actorId, operation]))}`;
}
function rawCategory(resource: VersionedDocument): unknown {
  return resource.category ?? (record(resource.payload) ? resource.payload.category : undefined);
}
function rawField(resource: VersionedDocument, field: string): unknown {
  return resource[field] ?? (record(resource.payload) ? resource.payload[field] : undefined);
}
function projectLayout(value: unknown): TextbookCenterLayout | null {
  if (!record(value) || typeof value.classTextbooksEnabled !== 'boolean'
    || typeof value.synchronizedTextbooksEnabled !== 'boolean'
    || !Array.isArray(value.visibleClassIds) || !value.visibleClassIds.every(id)
    || !Array.isArray(value.dashboardFields)
    || !value.dashboardFields.every(field => typeof field === 'string'
      && TEXTBOOK_DASHBOARD_FIELDS.includes(field as typeof TEXTBOOK_DASHBOARD_FIELDS[number]))) return null;
  return { classTextbooksEnabled: value.classTextbooksEnabled,
    synchronizedTextbooksEnabled: value.synchronizedTextbooksEnabled,
    visibleClassIds: [...value.visibleClassIds], dashboardFields: [...value.dashboardFields] as TextbookCenterLayout['dashboardFields'] };
}
function projectSettings(document: VersionedDocument | null, organizationId: string): TextbookCenterSettings | null {
  if (!visible(document, organizationId)) return null;
  const draft = projectLayout(document.draft);
  const published = document.published === null ? null : projectLayout(document.published);
  if (!draft || (document.published !== null && !published)
    || (document.status !== 'draft' && document.status !== 'published')
    || typeof document.updatedAt !== 'string'
    || (document.publishedAt !== null && typeof document.publishedAt !== 'string')) throw new TextbookError('SERVICE_UNAVAILABLE');
  return { id: document._id, organizationId, draft, published, status: document.status,
    version: document.version, updatedAt: document.updatedAt,
    publishedAt: document.publishedAt };
}
function projectDraft(document: VersionedDocument | null, organizationId: string): TextbookCatalogDraft | null {
  if (!visible(document, organizationId)) return null;
  if (typeof document.resourceId !== 'string' || !Array.isArray(document.classIds)
    || !document.classIds.every(id) || !['draft', 'published', 'disabled'].includes(String(document.status))
    || typeof document.updatedAt !== 'string'
    || (document.publishedAt !== null && typeof document.publishedAt !== 'string')) throw new TextbookError('SERVICE_UNAVAILABLE');
  return { id: document._id, organizationId, resourceId: document.resourceId,
    classIds: [...document.classIds], status: document.status as TextbookCatalogDraft['status'],
    version: document.version, updatedAt: document.updatedAt, publishedAt: document.publishedAt };
}
function projectBook(resource: VersionedDocument, draft: TextbookCatalogDraft | null): AdminTextbookBook | null {
  if (resource.type !== 'reading' || rawCategory(resource) !== 'synchronized'
    || typeof resource.title !== 'string' || typeof rawField(resource, 'grade') !== 'string'
    || typeof rawField(resource, 'term') !== 'string' || typeof rawField(resource, 'textbook') !== 'string'
    || !['draft', 'published', 'offline'].includes(String(resource.status))) return null;
  const visibility = resource.visibility;
  const classIds = Array.isArray(resource.allowedClassIds) ? resource.allowedClassIds
    : record(visibility) && Array.isArray(visibility.classIds) ? visibility.classIds : [];
  const chapters = rawField(resource, 'textbookChapters') ?? rawField(resource, 'chapters');
  return { id: resource._id, title: resource.title, grade: String(rawField(resource, 'grade')),
    term: String(rawField(resource, 'term')), edition: String(rawField(resource, 'textbook')),
    contentVersion: String(resource.contentVersion ?? ''), chapterCount: Array.isArray(chapters) ? chapters.length : 0,
    status: resource.status as AdminTextbookBook['status'], visibleClassIds: classIds.filter(id) as string[],
    updatedAt: typeof resource.updatedAt === 'string' ? resource.updatedAt : null,
    version: resource.version, draft };
}
function hasPublishablePages(resource: VersionedDocument): boolean {
  const chapters = rawField(resource, 'chapters');
  return typeof resource.title === 'string' && !!resource.title.trim()
    && (typeof resource.contentVersion === 'string' || Number.isSafeInteger(resource.contentVersion))
    && (resource.copyrightStatus === 'demo' || resource.copyrightStatus === 'verified')
    && typeof rawField(resource, 'grade') === 'string'
    && typeof rawField(resource, 'term') === 'string'
    && typeof rawField(resource, 'textbook') === 'string'
    && typeof rawField(resource, 'difficulty') === 'string'
    && Array.isArray(chapters) && chapters.length > 0 && chapters.every(chapter =>
      record(chapter) && typeof chapter.id === 'string' && typeof chapter.title === 'string'
      && Number.isSafeInteger(chapter.order) && Array.isArray(chapter.pages) && chapter.pages.length > 0
      && chapter.pages.every(page => record(page) && typeof page.id === 'string'
        && Number.isSafeInteger(page.pageNumber) && Number.isSafeInteger(page.order)
        && typeof page.thumbnailAssetKey === 'string' && typeof page.imageAssetKey === 'string'
        && Number.isSafeInteger(page.width) && Number.isSafeInteger(page.height)
        && typeof page.assetVersion === 'string'));
}

export class TextbookAdminService {
  public constructor(private readonly database: DocumentDatabasePort, private readonly clock: TextbookAdminClock) {}
  public async overview(actor: TrustedActorContext): Promise<AdminTextbookOverview> {
    this.requireAdmin(actor);
    const [classes, resources, drafts, settingsDocument] = await Promise.all([
      this.database.find(TEXTBOOK_ADMIN_COLLECTIONS.classes, { organizationId: actor.organizationId, deletedAt: null }),
      this.database.find(TEXTBOOK_ADMIN_COLLECTIONS.resources, { organizationId: actor.organizationId, type: 'reading', deletedAt: null }),
      this.database.find(TEXTBOOK_ADMIN_COLLECTIONS.catalogDrafts, { organizationId: actor.organizationId, deletedAt: null }),
      this.database.get(TEXTBOOK_ADMIN_COLLECTIONS.settings, settingsId(actor.organizationId)),
    ]);
    if (classes.length > 1000 || resources.length > 10000 || drafts.length > 10000) throw new TextbookError('SERVICE_UNAVAILABLE');
    const classViews = classes.filter(item => typeof item.name === 'string' && gradeValue(item.grade) !== null
      && typeof item.term === 'string' && (item.status === 'active' || item.status === 'archived'))
      .map(item => ({ id: item._id, name: String(item.name), grade: gradeValue(item.grade)!, term: String(item.term),
        status: item.status as 'active' | 'archived' })).sort((a, b) => a.id.localeCompare(b.id));
    const draftsByResource = new Map(drafts.map(item => {
      const draft = projectDraft(item, actor.organizationId);
      return draft ? [draft.resourceId, draft] as const : ['', null] as const;
    }));
    const books = resources.map(resource => projectBook(resource,
      draftsByResource.get(resource._id) ?? null)).filter((book): book is AdminTextbookBook => book !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
    return { classes: classViews, books, settings: projectSettings(settingsDocument, actor.organizationId) };
  }
  public async preview(actor: TrustedActorContext, resourceId: string): Promise<AdminTextbookPreview> {
    this.requireAdmin(actor);
    const resource = await this.database.get(TEXTBOOK_ADMIN_COLLECTIONS.resources, resourceId);
    if (!visible(resource, actor.organizationId)) throw new TextbookError('NOT_FOUND');
    const draft = projectDraft(await this.database.get(TEXTBOOK_ADMIN_COLLECTIONS.catalogDrafts,
      catalogDraftId(actor.organizationId, resourceId)), actor.organizationId);
    const book = projectBook(resource, draft);
    if (!book) throw new TextbookError('NOT_FOUND');
    const raw = rawField(resource, 'textbookChapters') ?? rawField(resource, 'chapters');
    const chapters = Array.isArray(raw) ? raw.map(chapter => record(chapter) ? ({ id: String(chapter.id ?? ''),
      title: String(chapter.title ?? ''), lessons: Array.isArray(chapter.lessons)
        ? chapter.lessons.filter(record).map(lesson => ({ id: String(lesson.id ?? ''), title: String(lesson.title ?? '') })) : [] }) : null)
      .filter((chapter): chapter is NonNullable<typeof chapter> => chapter !== null) : [];
    return { ...book, chapters };
  }
  public async saveSettings(actor: TrustedActorContext, layout: TextbookCenterLayout,
    expectedVersion: number, operation: string, publish: boolean): Promise<TextbookCenterSettings> {
    this.requireAdmin(actor);
    this.requireWrite(expectedVersion, operation);
    if (!projectLayout(layout) || layout.visibleClassIds.length < 1
      || new Set(layout.visibleClassIds).size !== layout.visibleClassIds.length
      || layout.dashboardFields.length < 1
      || new Set(layout.dashboardFields).size !== layout.dashboardFields.length) throw new TextbookError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: publish ? 'publishSettings' : 'saveSettings', layout, expectedVersion });
    return this.database.runTransaction(async documents => {
      const prior = await this.receipt<TextbookCenterSettings>(documents, actor, operation, fingerprint);
      if (prior) return prior;
      await this.requireClasses(documents, actor.organizationId, layout.visibleClassIds);
      const old = projectSettings(await documents.get(TEXTBOOK_ADMIN_COLLECTIONS.settings,
        settingsId(actor.organizationId)), actor.organizationId);
      if ((old?.version ?? 0) !== expectedVersion) throw new TextbookError('CONFLICT');
      const now = this.clock.nowIso();
      const next: TextbookCenterSettings = { id: settingsId(actor.organizationId), organizationId: actor.organizationId,
        draft: copy(layout), published: publish ? copy(layout) : old?.published ?? null,
        status: publish ? 'published' : 'draft', version: expectedVersion + 1,
        updatedAt: now, publishedAt: publish ? now : old?.publishedAt ?? null };
      await this.persist(documents, TEXTBOOK_ADMIN_COLLECTIONS.settings, next.id, actor.organizationId,
        next.version, expectedVersion, next);
      await this.finish(documents, actor, operation, fingerprint, next, publish ? 'textbook.settings.published' : 'textbook.settings.saved', next.id);
      return copy(next);
    });
  }
  public async saveCatalogDraft(actor: TrustedActorContext, resourceId: string, classIds: readonly string[],
    expectedVersion: number, operation: string): Promise<TextbookCatalogDraft> {
    this.requireAdmin(actor); this.requireWrite(expectedVersion, operation);
    if (!id(resourceId) || !Array.isArray(classIds) || classIds.length < 1 || classIds.length > 500
      || classIds.some(value => !id(value)) || new Set(classIds).size !== classIds.length) throw new TextbookError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: 'saveCatalogDraft', resourceId, classIds, expectedVersion });
    return this.database.runTransaction(async documents => {
      const prior = await this.receipt<TextbookCatalogDraft>(documents, actor, operation, fingerprint);
      if (prior) return prior;
      await this.resource(documents, actor.organizationId, resourceId);
      await this.requireClasses(documents, actor.organizationId, classIds);
      const current = projectDraft(await documents.get(TEXTBOOK_ADMIN_COLLECTIONS.catalogDrafts,
        catalogDraftId(actor.organizationId, resourceId)), actor.organizationId);
      if ((current?.version ?? 0) !== expectedVersion) throw new TextbookError('CONFLICT');
      const next: TextbookCatalogDraft = { id: catalogDraftId(actor.organizationId, resourceId),
        organizationId: actor.organizationId, resourceId, classIds: [...classIds], status: 'draft',
        version: expectedVersion + 1, updatedAt: this.clock.nowIso(), publishedAt: current?.publishedAt ?? null };
      await this.persist(documents, TEXTBOOK_ADMIN_COLLECTIONS.catalogDrafts, next.id,
        actor.organizationId, next.version, expectedVersion, next);
      await this.finish(documents, actor, operation, fingerprint, next, 'textbook.catalog.saved', resourceId);
      return copy(next);
    });
  }
  public async changeCatalogStatus(actor: TrustedActorContext, resourceId: string,
    expectedVersion: number, operation: string, publish: boolean): Promise<TextbookCatalogDraft> {
    this.requireAdmin(actor); this.requireWrite(expectedVersion, operation);
    if (!id(resourceId)) throw new TextbookError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: publish ? 'publishCatalog' : 'disableCatalog', resourceId, expectedVersion });
    return this.database.runTransaction(async documents => {
      const prior = await this.receipt<TextbookCatalogDraft>(documents, actor, operation, fingerprint);
      if (prior) return prior;
      const resource = await this.resource(documents, actor.organizationId, resourceId);
      const current = projectDraft(await documents.get(TEXTBOOK_ADMIN_COLLECTIONS.catalogDrafts,
        catalogDraftId(actor.organizationId, resourceId)), actor.organizationId);
      if (!current || current.version !== expectedVersion) throw new TextbookError('CONFLICT');
      if (publish) {
        if (!current.classIds.length || !hasPublishablePages(resource)) throw new TextbookError('VALIDATION_ERROR');
        await this.requireClasses(documents, actor.organizationId, current.classIds, String(rawField(resource, 'grade')));
      }
      const now = this.clock.nowIso();
      const next: TextbookCatalogDraft = { ...current, status: publish ? 'published' : 'disabled',
        version: current.version + 1, updatedAt: now, publishedAt: publish ? now : current.publishedAt };
      const resourceNext: VersionedDocument = { ...resource, version: resource.version + 1,
        status: publish ? 'published' : 'offline',
        ...(publish ? { visibility: { type: 'classes', classIds: [...current.classIds] },
          allowedClassIds: [...current.classIds] } : {}), updatedAt: now };
      if (!await documents.replace(TEXTBOOK_ADMIN_COLLECTIONS.resources, resourceId, resource.version, resourceNext)) {
        throw new TextbookError('CONFLICT');
      }
      await this.persist(documents, TEXTBOOK_ADMIN_COLLECTIONS.catalogDrafts, next.id,
        actor.organizationId, next.version, current.version, next);
      await this.finish(documents, actor, operation, fingerprint, next,
        publish ? 'textbook.catalog.published' : 'textbook.catalog.disabled', resourceId);
      return copy(next);
    });
  }
  private requireAdmin(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'admin' || !actor.permissions.includes('organization.manage')
      || !actor.scopeIds.includes(actor.organizationId)) throw new TextbookError('FORBIDDEN');
  }
  private requireWrite(version: number, operation: string): void {
    if (!Number.isSafeInteger(version) || version < 0 || !operationId(operation)) throw new TextbookError('VALIDATION_ERROR');
  }
  private async resource(documents: DocumentDatabaseTransactionPort, organizationId: string,
    resourceId: string): Promise<VersionedDocument> {
    const resource = await documents.get(TEXTBOOK_ADMIN_COLLECTIONS.resources, resourceId);
    if (!visible(resource, organizationId) || !projectBook(resource, null)) throw new TextbookError('NOT_FOUND');
    return resource;
  }
  private async requireClasses(documents: DocumentDatabaseTransactionPort, organizationId: string,
    classIds: readonly string[], grade?: string): Promise<void> {
    for (const classId of classIds) {
      const target = await documents.get(TEXTBOOK_ADMIN_COLLECTIONS.classes, classId);
      if (!visible(target, organizationId) || target.status !== 'active'
        || (grade !== undefined && gradeValue(target.grade) !== grade)) throw new TextbookError('FORBIDDEN');
    }
  }
  private async persist(documents: DocumentDatabaseTransactionPort, collection: string,
    documentId: string, organizationId: string, version: number, expectedVersion: number,
    value: object): Promise<void> {
    const document: VersionedDocument = { _id: documentId, organizationId, schemaVersion: 1,
      deletedAt: null, version, ...copy(value) as Record<string, JsonValue> };
    const saved = expectedVersion === 0 ? await documents.create(collection, document)
      : await documents.replace(collection, documentId, expectedVersion, document);
    if (!saved) throw new TextbookError('CONFLICT');
  }
  private async receipt<T>(documents: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    operation: string, fingerprint: string): Promise<T | null> {
    const prior = await documents.get(TEXTBOOK_ADMIN_COLLECTIONS.receipts,
      receiptId(actor.organizationId, actor.actorUserId, operation));
    if (!visible(prior, actor.organizationId)) return null;
    if (prior.fingerprint !== fingerprint) throw new TextbookError('CONFLICT');
    return copy(prior.result) as T;
  }
  private async finish<T>(documents: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    operation: string, fingerprint: string, result: T, action: string, targetId: string): Promise<void> {
    const now = this.clock.nowIso();
    const receipt: VersionedDocument = { _id: receiptId(actor.organizationId, actor.actorUserId, operation),
      organizationId: actor.organizationId, schemaVersion: 1, deletedAt: null, version: 1,
      actorUserId: actor.actorUserId, operationId: operation, fingerprint,
      result: copy(result) as unknown as JsonValue };
    if (!await documents.create(TEXTBOOK_ADMIN_COLLECTIONS.receipts, receipt)) throw new TextbookError('CONFLICT');
    const audit: VersionedDocument = { _id: `audit_${hashHex(JSON.stringify([actor.organizationId, actor.actorUserId, operation]))}`,
      organizationId: actor.organizationId, schemaVersion: 1, deletedAt: null, version: 1,
      requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
      action, targetType: 'textbook', targetId, result: 'succeeded', errorCode: null,
      metadata: {}, occurredAt: now };
    if (!await documents.append(TEXTBOOK_ADMIN_COLLECTIONS.audits, audit)) throw new TextbookError('CONFLICT');
  }
}
