import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { TextbookTransaction, TextbookUnitOfWork } from './repository';
import { TextbookError, type ClassTextbookConfig, type TeacherTextbookClass, type TextbookChapter, type TextbookRecord } from './types';
import type { TextbookCenterLayout } from './admin-types';

export const TEXTBOOK_COLLECTIONS = { classes: 'classes', grants: 'teacher_class_grants',
  memberships: 'class_memberships', resources: 'learning_resources',
  configs: 'class_textbook_configs', receipts: 'class_textbook_operations', settings: 'textbook_center_settings' } as const;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function gradeValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function scoped(value: VersionedDocument | null, organizationId: string): value is VersionedDocument {
  return value !== null && value.organizationId === organizationId && value.deletedAt === null;
}
function receiptId(organizationId: string, teacherId: string, operationId: string): string {
  return `class_textbook_operation_${hashHex(JSON.stringify([organizationId, teacherId, operationId]))}`;
}
function projectConfig(value: unknown, organizationId: string): ClassTextbookConfig | null {
  if (!record(value) || value.organizationId !== organizationId || typeof value.id !== 'string'
    || typeof value.classId !== 'string' || (value.status !== 'draft' && value.status !== 'published')
    || !Array.isArray(value.textbooks) || typeof value.note !== 'string'
    || !Array.isArray(value.publishedTextbooks) || typeof value.publishedNote !== 'string'
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || (value.publishedAt !== null && typeof value.publishedAt !== 'string')) return null;
  if ([...value.textbooks, ...value.publishedTextbooks].some(item => !record(item) || typeof item.textbookId !== 'string'
    || !Array.isArray(item.chapterIds) || !item.chapterIds.every(id => typeof id === 'string')
    || !Array.isArray(item.lessonIds) || !item.lessonIds.every(id => typeof id === 'string')
    || typeof item.contentVersion !== 'string')) return null;
  return { id: value.id, organizationId, classId: value.classId, status: value.status,
    textbooks: copy(value.textbooks) as ClassTextbookConfig['textbooks'], note: value.note,
    publishedTextbooks: copy(value.publishedTextbooks) as ClassTextbookConfig['publishedTextbooks'],
    publishedNote: value.publishedNote,
    version: Number(value.version), createdAt: value.createdAt, updatedAt: value.updatedAt,
    publishedAt: value.publishedAt };
}
function projectBook(document: VersionedDocument, organizationId: string): TextbookRecord | null {
  if (!scoped(document, organizationId) || document.type !== 'reading' || document.status !== 'published') return null;
  const payload = record(document.payload) ? document.payload : document;
  const category = document.category ?? payload.category;
  const grade = gradeValue(document.grade ?? payload.grade);
  const term = document.term ?? payload.term;
  const edition = document.textbook ?? payload.textbook;
  const rawChapters = payload.textbookChapters ?? payload.chapters;
  if (category !== 'synchronized' || typeof document.title !== 'string' || grade === null
    || typeof term !== 'string' || typeof edition !== 'string'
    || (typeof document.contentVersion !== 'string' && typeof document.contentVersion !== 'number')
    || !Array.isArray(rawChapters) || rawChapters.length === 0) return null;
  const chapters: TextbookChapter[] = [];
  for (const raw of rawChapters) {
    if (!record(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
    const rawLessons = Array.isArray(raw.lessons) ? raw.lessons : [];
    if (rawLessons.some(item => !record(item) || typeof item.id !== 'string' || typeof item.title !== 'string')) return null;
    chapters.push({ id: raw.id, title: raw.title,
      lessons: rawLessons.map(item => ({ id: String((item as Record<string, unknown>).id),
        title: String((item as Record<string, unknown>).title) })) });
  }
  const rawVisibility = document.visibility;
  const visibility = rawVisibility === 'organization' || (record(rawVisibility) && rawVisibility.type === 'organization')
    ? 'organization' : rawVisibility === 'classes' || (record(rawVisibility) && rawVisibility.type === 'classes')
      ? 'classes' : null;
  const rawClassIds = document.allowedClassIds ?? (record(rawVisibility) ? rawVisibility.classIds : undefined);
  if (visibility === null || (visibility === 'classes' && (!Array.isArray(rawClassIds)
    || !rawClassIds.every(id => typeof id === 'string')))) return null;
  return { id: document._id, title: document.title, grade, term, edition,
    contentVersion: String(document.contentVersion), chapters, visibility,
    allowedClassIds: visibility === 'classes' ? [...rawClassIds as string[]] : [] };
}

class DocumentTextbookTransaction implements TextbookTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort,
    private readonly database: DocumentDatabasePort) {}
  public async listTeacherClassIds(organizationId: string, teacherId: string): Promise<readonly string[]> {
    const grants = await this.documents.find(TEXTBOOK_COLLECTIONS.grants, { organizationId, teacherId,
      status: 'active', deletedAt: null });
    const ids: string[] = [];
    for (const grant of grants) {
      if (typeof grant.classId !== 'string' || !Array.isArray(grant.permissions)) throw new TextbookError('SERVICE_UNAVAILABLE');
      if (!grant.permissions.includes('content.read')) continue;
      const classEntity = await this.documents.get(TEXTBOOK_COLLECTIONS.classes, grant.classId);
      if (scoped(classEntity, organizationId) && classEntity.status === 'active') ids.push(grant.classId);
    }
    return [...new Set(ids)].sort();
  }
  public async findPublishedCenterLayout(organizationId: string): Promise<TextbookCenterLayout | null> {
    const document = await this.documents.get(TEXTBOOK_COLLECTIONS.settings, `textbook_center_${organizationId}`);
    if (!scoped(document, organizationId) || document.published === null) return null;
    const value = document.published;
    if (!record(value) || typeof value.classTextbooksEnabled !== 'boolean'
      || typeof value.synchronizedTextbooksEnabled !== 'boolean'
      || !Array.isArray(value.visibleClassIds) || !value.visibleClassIds.every(id => typeof id === 'string')
      || !Array.isArray(value.dashboardFields)) throw new TextbookError('SERVICE_UNAVAILABLE');
    return { classTextbooksEnabled: value.classTextbooksEnabled,
      synchronizedTextbooksEnabled: value.synchronizedTextbooksEnabled,
      visibleClassIds: [...value.visibleClassIds],
      dashboardFields: [...value.dashboardFields] as TextbookCenterLayout['dashboardFields'] };
  }
  public async listTeacherClasses(organizationId: string, teacherId: string): Promise<readonly TeacherTextbookClass[]> {
    const classIds = await this.listTeacherClassIds(organizationId, teacherId);
    const items: TeacherTextbookClass[] = [];
    for (const classId of classIds) {
      const classEntity = await this.documents.get(TEXTBOOK_COLLECTIONS.classes, classId);
      if (!scoped(classEntity, organizationId) || classEntity.status !== 'active') continue;
      const grade = gradeValue(classEntity.grade);
      if (typeof classEntity.name !== 'string' || grade === null
        || typeof classEntity.term !== 'string') throw new TextbookError('SERVICE_UNAVAILABLE');
      const memberships = await this.documents.find(TEXTBOOK_COLLECTIONS.memberships, {
        organizationId, classId, status: 'active', deletedAt: null });
      const config = await this.findConfig(organizationId, classId);
      items.push({ id: classId, name: classEntity.name, grade,
        term: classEntity.term, studentCount: memberships.length, config });
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }
  public async findTeacherClass(organizationId: string, teacherId: string,
    classId: string): Promise<TeacherTextbookClass | null> {
    const ids = await this.listTeacherClassIds(organizationId, teacherId);
    if (!ids.includes(classId)) return null;
    const classEntity = await this.documents.get(TEXTBOOK_COLLECTIONS.classes, classId);
    const grade = gradeValue(classEntity?.grade);
    if (!scoped(classEntity, organizationId) || classEntity.status !== 'active'
      || typeof classEntity.name !== 'string' || grade === null
      || typeof classEntity.term !== 'string') throw new TextbookError('SERVICE_UNAVAILABLE');
    const memberships = await this.documents.find(TEXTBOOK_COLLECTIONS.memberships,
      { organizationId, classId, status: 'active', deletedAt: null });
    return { id: classId, name: classEntity.name, grade,
      term: classEntity.term, studentCount: memberships.length,
      config: await this.findConfig(organizationId, classId) };
  }
  public async hasClassPermission(organizationId: string, teacherId: string,
    classId: string, permission: string): Promise<boolean> {
    const grants = await this.documents.find(TEXTBOOK_COLLECTIONS.grants,
      { organizationId, teacherId, classId, status: 'active', deletedAt: null });
    return grants.some(grant => Array.isArray(grant.permissions) && grant.permissions.includes(permission));
  }
  public async listTextbookPage(organizationId: string,
    page: Readonly<{ limit: number; offset: number }>):
    Promise<Readonly<{ items: readonly (TextbookRecord | null)[]; nextOffset: number | null }>> {
    const result = await this.database.findPage(TEXTBOOK_COLLECTIONS.resources,
      { organizationId, type: 'reading', status: 'published', deletedAt: null }, page);
    return { items: result.items.map(document => projectBook(document, organizationId)),
      nextOffset: result.hasMore ? page.offset + result.items.length : null };
  }
  public async findTextbook(organizationId: string, textbookId: string): Promise<TextbookRecord | null> {
    const document = await this.documents.get(TEXTBOOK_COLLECTIONS.resources, textbookId);
    return document ? projectBook(document, organizationId) : null;
  }
  public async findConfig(organizationId: string, classId: string): Promise<ClassTextbookConfig | null> {
    const document = await this.documents.get(TEXTBOOK_COLLECTIONS.configs,
      `class_textbook_${organizationId}_${classId}`);
    if (!scoped(document, organizationId)) return null;
    const result = projectConfig(document, organizationId);
    if (!result || result.classId !== classId) throw new TextbookError('SERVICE_UNAVAILABLE');
    return result;
  }
  public async saveConfig(config: ClassTextbookConfig, expectedVersion: number): Promise<boolean> {
    const document: VersionedDocument = { _id: config.id, organizationId: config.organizationId,
      schemaVersion: 1, deletedAt: null, version: config.version,
      ...copy(config) as unknown as Record<string, JsonValue> };
    return expectedVersion === 0 ? this.documents.create(TEXTBOOK_COLLECTIONS.configs, document)
      : this.documents.replace(TEXTBOOK_COLLECTIONS.configs, config.id, expectedVersion, document);
  }
  public async findReceipt(organizationId: string, teacherId: string, operationId: string):
    Promise<{ readonly fingerprint: string; readonly result: ClassTextbookConfig } | null> {
    const document = await this.documents.get(TEXTBOOK_COLLECTIONS.receipts,
      receiptId(organizationId, teacherId, operationId));
    if (!scoped(document, organizationId) || document.teacherId !== teacherId
      || document.operationId !== operationId || typeof document.fingerprint !== 'string') return null;
    const result = projectConfig(document.result, organizationId);
    if (!result) throw new TextbookError('SERVICE_UNAVAILABLE');
    return { fingerprint: document.fingerprint, result };
  }
  public async saveReceipt(organizationId: string, teacherId: string, operationId: string,
    fingerprint: string, result: ClassTextbookConfig): Promise<boolean> {
    return this.documents.create(TEXTBOOK_COLLECTIONS.receipts, { _id: receiptId(organizationId, teacherId, operationId),
      organizationId, schemaVersion: 1, deletedAt: null, version: 1, teacherId,
      operationId, fingerprint, result: copy(result) as unknown as JsonValue });
  }
}

export class DocumentTextbookRepository implements TextbookUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}
  public async transaction<T>(work: (transaction: TextbookTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(async documents => work(new DocumentTextbookTransaction(documents, this.database)));
  }
}
