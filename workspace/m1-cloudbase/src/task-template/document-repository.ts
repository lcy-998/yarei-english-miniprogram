import type { JsonObject, JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { LearningResourceRecord } from '../task-core/types';
import type { TemplateTransaction, TemplateUnitOfWork } from './repository';
import { TemplateError, type TaskTemplate, type TemplateReceipt } from './types';

export const TEMPLATE_COLLECTIONS = { classes: 'classes', grants: 'teacher_class_grants',
  resources: 'learning_resources', templates: 'task_templates', receipts: 'task_template_operations' } as const;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function visible(document: VersionedDocument | null, organizationId: string): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function receiptId(organizationId: string, teacherId: string, operationId: string): string {
  return `task_template_operation_${hashHex(JSON.stringify([organizationId, teacherId, operationId]))}`;
}
function projectResource(document: VersionedDocument, organizationId: string): LearningResourceRecord | null {
  if (!visible(document, organizationId) || typeof document.id !== 'string'
    || (document.type !== 'reading' && document.type !== 'vocabulary' && document.type !== 'exercise' && document.type !== 'recording')
    || typeof document.title !== 'string' || !Number.isSafeInteger(document.contentVersion)
    || (document.status !== 'draft' && document.status !== 'published' && document.status !== 'offline')
    || !isRecord(document.payload)) return null;
  const rawVisibility = document.visibility;
  const visibility = rawVisibility === 'organization' || (isRecord(rawVisibility) && rawVisibility.type === 'organization')
    ? 'organization' as const : rawVisibility === 'classes' || (isRecord(rawVisibility) && rawVisibility.type === 'classes')
      ? 'classes' as const : null;
  if (!visibility) return null;
  const rawIds = Array.isArray(document.allowedClassIds) ? document.allowedClassIds
    : isRecord(rawVisibility) ? rawVisibility.classIds : undefined;
  const classIds = visibility === 'organization' ? [] : Array.isArray(rawIds)
    && rawIds.every(item => typeof item === 'string') ? rawIds as string[] : null;
  return classIds ? { id: document.id, organizationId, type: document.type,
    title: document.title, contentVersion: Number(document.contentVersion), status: document.status,
    visibility, allowedClassIds: [...classIds], payload: clone(document.payload) as JsonObject } : null;
}
export function projectTemplate(value: unknown): TaskTemplate | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.organizationId !== 'string'
    || (value.ownerTeacherId !== null && typeof value.ownerTeacherId !== 'string')
    || (value.scope !== 'system' && value.scope !== 'personal')
    || typeof value.title !== 'string' || typeof value.description !== 'string'
    || !Array.isArray(value.itemRefs) || !Array.isArray(value.items)
    || (value.status !== 'active' && value.status !== 'deleted')
    || !Number.isSafeInteger(value.useCount) || Number(value.useCount) < 0
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  if (value.itemRefs.some(item => !isRecord(item) || typeof item.id !== 'string'
    || typeof item.resourceId !== 'string' || !Number.isSafeInteger(item.order))
    || value.items.some(item => !isRecord(item) || typeof item.id !== 'string'
      || typeof item.resourceId !== 'string' || !isRecord(item.resourceSnapshot)
      || !isRecord(item.completionRule) || !isRecord(item.scoringRule))) return null;
  return { id: value.id, organizationId: value.organizationId,
    ownerTeacherId: value.ownerTeacherId, scope: value.scope,
    title: value.title, description: value.description,
    itemRefs: clone(value.itemRefs) as TaskTemplate['itemRefs'],
    items: clone(value.items) as TaskTemplate['items'], status: value.status,
    useCount: Number(value.useCount), version: Number(value.version),
    createdAt: value.createdAt, updatedAt: value.updatedAt };
}

class DocumentTemplateTransaction implements TemplateTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort) {}
  public async listTeacherClassIds(organizationId: string, teacherId: string,
    permission: string): Promise<readonly string[]> {
    const grants = await this.documents.find(TEMPLATE_COLLECTIONS.grants, { organizationId, teacherId,
      status: 'active', deletedAt: null });
    const ids: string[] = [];
    for (const grant of grants) {
      if (typeof grant.classId !== 'string' || !Array.isArray(grant.permissions)) {
        throw new TemplateError('SERVICE_UNAVAILABLE');
      }
      if (!grant.permissions.includes(permission)) continue;
      const classRecord = await this.documents.get(TEMPLATE_COLLECTIONS.classes, grant.classId);
      if (visible(classRecord, organizationId) && classRecord.status === 'active') ids.push(grant.classId);
    }
    return [...new Set(ids)];
  }
  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null> {
    const document = await this.documents.get(TEMPLATE_COLLECTIONS.resources, resourceId);
    if (!visible(document, organizationId)) return null;
    const resource = projectResource(document, organizationId);
    if (!resource || resource.id !== resourceId) throw new TemplateError('SERVICE_UNAVAILABLE');
    return resource;
  }
  public async findTemplate(organizationId: string, templateId: string): Promise<TaskTemplate | null> {
    const document = await this.documents.get(TEMPLATE_COLLECTIONS.templates, templateId);
    if (!visible(document, organizationId)) return null;
    const template = projectTemplate({ ...document, version: document.version });
    if (!template || template.id !== templateId) throw new TemplateError('SERVICE_UNAVAILABLE');
    return template;
  }
  public async listTemplates(organizationId: string): Promise<readonly TaskTemplate[]> {
    const documents = await this.documents.find(TEMPLATE_COLLECTIONS.templates, { organizationId, deletedAt: null });
    return documents.map(document => {
      const template = projectTemplate({ ...document, version: document.version });
      if (!template || template.organizationId !== organizationId) throw new TemplateError('SERVICE_UNAVAILABLE');
      return template;
    });
  }
  public async saveTemplate(template: TaskTemplate, expectedVersion: number): Promise<boolean> {
    const document: VersionedDocument = { _id: template.id, organizationId: template.organizationId,
      schemaVersion: 1, version: template.version, deletedAt: null,
      ...clone(template) as unknown as Record<string, JsonValue> };
    return expectedVersion === 0
      ? this.documents.create(TEMPLATE_COLLECTIONS.templates, document)
      : this.documents.replace(TEMPLATE_COLLECTIONS.templates, template.id, expectedVersion, document);
  }
  public async findReceipt(organizationId: string, teacherId: string,
    operationId: string): Promise<TemplateReceipt | null> {
    const document = await this.documents.get(TEMPLATE_COLLECTIONS.receipts,
      receiptId(organizationId, teacherId, operationId));
    if (!visible(document, organizationId) || document.teacherId !== teacherId
      || document.operationId !== operationId || typeof document.fingerprint !== 'string') return null;
    const result = projectTemplate(document.result);
    if (!result || result.organizationId !== organizationId) throw new TemplateError('SERVICE_UNAVAILABLE');
    return { organizationId, teacherId, operationId, fingerprint: document.fingerprint, result };
  }
  public async saveReceipt(receipt: TemplateReceipt): Promise<boolean> {
    return this.documents.create(TEMPLATE_COLLECTIONS.receipts, { _id: receiptId(receipt.organizationId,
      receipt.teacherId, receipt.operationId), organizationId: receipt.organizationId,
    schemaVersion: 1, version: 1, deletedAt: null, teacherId: receipt.teacherId,
    operationId: receipt.operationId, fingerprint: receipt.fingerprint,
    result: clone(receipt.result) as unknown as JsonValue });
  }
}

export class DocumentTemplateRepository implements TemplateUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}
  public async transaction<T>(work: (transaction: TemplateTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(async documents => work(new DocumentTemplateTransaction(documents)));
  }
}
