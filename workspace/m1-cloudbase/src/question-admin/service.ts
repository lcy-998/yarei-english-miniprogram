import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import { QuestionAdminError, type QuestionAdminDetail, type QuestionAdminFilters, type QuestionAdminPage,
  type QuestionAdminSummary, type QuestionBatchItem, type QuestionStatus, type QuestionVisibility } from './types';

const RESOURCES = 'learning_resources';
const CLASSES = 'classes';
const RECEIPTS = 'question_admin_operations';
const AUDITS = 'operation_logs';

function string(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isQuestion(document: VersionedDocument | null, organizationId: string): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null
    && document.type === 'exercise' && string(document.id) !== null && string(document.title) !== null
    && string(document.stem) !== null && string(document.grade) !== null
    && ['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(String(document.questionType))
    && ['draft', 'published', 'offline'].includes(String(document.status))
    && typeof document.visibility === 'object' && document.visibility !== null && !Array.isArray(document.visibility)
    && Number.isSafeInteger(document.version) && document.version >= 1;
}
function visibility(document: VersionedDocument): QuestionVisibility {
  const value = document.visibility as Record<string, unknown>;
  if (value.type === 'organization') return { type: 'organization' };
  if (value.type === 'classes' && Array.isArray(value.classIds)
    && value.classIds.length > 0 && value.classIds.every(id => typeof id === 'string' && id.trim())) {
    return { type: 'classes', classIds: [...value.classIds] as string[] };
  }
  throw new QuestionAdminError('SERVICE_UNAVAILABLE');
}
function summary(document: VersionedDocument): QuestionAdminSummary {
  const stem = String(document.stem);
  return { id: String(document.id), title: String(document.title), stemSummary: stem.slice(0, 100),
    grade: String(document.grade), unit: string(document.unit), difficulty: string(document.difficulty),
    knowledgePoint: string(document.knowledgePoint),
    questionType: document.questionType as QuestionAdminSummary['questionType'],
    status: document.status as QuestionStatus, visibility: visibility(document),
    updatedAt: string(document.updatedAt), version: document.version };
}
function detail(document: VersionedDocument): QuestionAdminDetail {
  if (!Array.isArray(document.options) || !document.options.every(option => typeof option === 'string')
    || document.correctAnswer === undefined || typeof document.explanation !== 'string') {
    throw new QuestionAdminError('SERVICE_UNAVAILABLE');
  }
  return { ...summary(document), stem: String(document.stem), options: [...document.options] as string[],
    correctAnswer: clone(document.correctAnswer), explanation: document.explanation };
}

export class QuestionAdminService {
  public constructor(private readonly database: DocumentDatabasePort, private readonly clock: { nowIso(): string }) {}

  public async list(actor: TrustedActorContext, filters: QuestionAdminFilters,
    page: Readonly<{ limit: number; offset: number }>): Promise<QuestionAdminPage> {
    this.authorize(actor);
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000) {
      throw new QuestionAdminError('VALIDATION_ERROR');
    }
    const docs = await this.database.find(RESOURCES, { organizationId: actor.organizationId,
      type: 'exercise', deletedAt: null });
    const keyword = filters.keyword?.trim().toLowerCase();
    const visible: QuestionAdminSummary[] = [];
    for (const document of docs) {
      if (!isQuestion(document, actor.organizationId)) throw new QuestionAdminError('SERVICE_UNAVAILABLE');
      const row = summary(document);
      if (!this.canAccess(actor, row.visibility)) continue;
      if (filters.status && row.status !== filters.status || filters.questionType && row.questionType !== filters.questionType
        || filters.classId && row.visibility.type === 'classes' && !row.visibility.classIds.includes(filters.classId)) continue;
      if (keyword && !`${row.title} ${row.stemSummary} ${row.knowledgePoint ?? ''}`.toLowerCase().includes(keyword)) continue;
      visible.push(row);
    }
    visible.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
    const items = visible.slice(page.offset, page.offset + page.limit);
    return { items, total: visible.length, nextOffset: page.offset + page.limit < visible.length ? page.offset + page.limit : null };
  }

  public async get(actor: TrustedActorContext, id: string): Promise<QuestionAdminDetail> {
    this.authorize(actor);
    const document = await this.database.get(RESOURCES, id);
    if (!isQuestion(document, actor.organizationId)) throw new QuestionAdminError('NOT_FOUND');
    const row = detail(document);
    if (!this.canAccess(actor, row.visibility)) throw new QuestionAdminError('NOT_FOUND');
    return row;
  }

  public async setVisibility(actor: TrustedActorContext, id: string, next: QuestionVisibility,
    expectedVersion: number, reason: string, operationId: string): Promise<QuestionAdminDetail> {
    const [result] = await this.batchSetVisibility(actor, [{ id, expectedVersion }], next, reason, operationId);
    if (!result) throw new QuestionAdminError('SERVICE_UNAVAILABLE');
    return result;
  }

  public async batchSetVisibility(actor: TrustedActorContext, items: readonly QuestionBatchItem[], next: QuestionVisibility,
    reason: string, operationId: string): Promise<readonly QuestionAdminDetail[]> {
    await this.validateWrite(actor, reason, operationId);
    this.validateItems(items);
    const fingerprint = JSON.stringify({ items, next, reason });
    return this.database.runTransaction(async tx => {
      const prior = await this.receipt(tx, actor, 'batchSetVisibility', operationId, fingerprint);
      if (prior) return prior as unknown as QuestionAdminDetail[];
      await this.validateVisibility(tx, actor, next);
      const changed: QuestionAdminDetail[] = [];
      for (const item of items) {
        const document = await this.requireQuestion(tx, actor, item.id, item.expectedVersion);
        const updated = { ...document, visibility: clone(next) as JsonValue, updatedAt: this.clock.nowIso(),
          version: document.version + 1 };
        if (!await tx.replace(RESOURCES, item.id, item.expectedVersion, updated)) throw new QuestionAdminError('CONFLICT');
        changed.push(detail(updated));
      }
      await this.finish(tx, actor, 'batchSetVisibility', operationId, fingerprint, reason,
        items.map(item => item.id), changed);
      return changed;
    });
  }

  public async setStatus(actor: TrustedActorContext, id: string, status: 'published' | 'offline',
    expectedVersion: number, reason: string, operationId: string): Promise<QuestionAdminDetail> {
    const [result] = await this.batchSetStatus(actor, [{ id, expectedVersion }], status, reason, operationId);
    if (!result) throw new QuestionAdminError('SERVICE_UNAVAILABLE');
    return result;
  }

  public async batchSetStatus(actor: TrustedActorContext, items: readonly QuestionBatchItem[],
    status: 'published' | 'offline', reason: string, operationId: string): Promise<readonly QuestionAdminDetail[]> {
    await this.validateWrite(actor, reason, operationId);
    if (!['published', 'offline'].includes(status)) {
      throw new QuestionAdminError('VALIDATION_ERROR');
    }
    this.validateItems(items);
    const fingerprint = JSON.stringify({ items, status, reason });
    return this.database.runTransaction(async tx => {
      const prior = await this.receipt(tx, actor, 'batchSetStatus', operationId, fingerprint);
      if (prior) return prior as unknown as QuestionAdminDetail[];
      const changed: QuestionAdminDetail[] = [];
      for (const item of items) {
        const document = await this.requireQuestion(tx, actor, item.id, item.expectedVersion);
        if (status === 'published' && (!string(document.stem) || document.correctAnswer === undefined
          || typeof document.explanation !== 'string')) throw new QuestionAdminError('VALIDATION_ERROR');
        const next = { ...document, status, updatedAt: this.clock.nowIso(), version: document.version + 1 };
        if (!await tx.replace(RESOURCES, item.id, item.expectedVersion, next)) throw new QuestionAdminError('CONFLICT');
        changed.push(detail(next));
      }
      await this.finish(tx, actor, 'batchSetStatus', operationId, fingerprint, reason, items.map(item => item.id), changed);
      return changed;
    });
  }

  private authorize(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'admin' || !actor.permissions.includes('organization.read')) throw new QuestionAdminError('FORBIDDEN');
  }
  private validateItems(items: readonly QuestionBatchItem[]): void {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20
      || new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => !string(item.id) || !Number.isSafeInteger(item.expectedVersion) || item.expectedVersion < 1)) {
      throw new QuestionAdminError('VALIDATION_ERROR');
    }
  }
  private async validateWrite(actor: TrustedActorContext, reason: string, operationId: string): Promise<void> {
    this.authorize(actor);
    if (!actor.permissions.includes('organization.manage')) throw new QuestionAdminError('FORBIDDEN');
    if (!string(reason) || reason.length > 300 || !string(operationId) || operationId.length < 8) {
      throw new QuestionAdminError('VALIDATION_ERROR');
    }
  }
  private canAccess(actor: TrustedActorContext, visibility: QuestionVisibility): boolean {
    return actor.scopeIds.includes(actor.organizationId) || visibility.type === 'classes'
      && visibility.classIds.some(id => actor.scopeIds.includes(id));
  }
  private async validateVisibility(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    next: QuestionVisibility): Promise<void> {
    if (next.type === 'organization') {
      if (!actor.scopeIds.includes(actor.organizationId)) throw new QuestionAdminError('FORBIDDEN');
      return;
    }
    if (next.type !== 'classes' || !Array.isArray(next.classIds) || next.classIds.length === 0
      || new Set(next.classIds).size !== next.classIds.length) throw new QuestionAdminError('VALIDATION_ERROR');
    for (const classId of next.classIds) {
      if (!actor.scopeIds.includes(actor.organizationId) && !actor.scopeIds.includes(classId)) throw new QuestionAdminError('FORBIDDEN');
      const classroom = await tx.get(CLASSES, classId);
      if (!classroom || classroom.organizationId !== actor.organizationId || classroom.deletedAt !== null
        || classroom.status !== 'active') throw new QuestionAdminError('VALIDATION_ERROR');
    }
  }
  private async requireQuestion(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    id: string, expectedVersion: number): Promise<VersionedDocument> {
    const document = await tx.get(RESOURCES, id);
    if (!isQuestion(document, actor.organizationId)) throw new QuestionAdminError('NOT_FOUND');
    if (!this.canAccess(actor, visibility(document))) throw new QuestionAdminError('FORBIDDEN');
    if (document.version !== expectedVersion) throw new QuestionAdminError('CONFLICT');
    return document;
  }
  private async receipt(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    action: string, operationId: string, fingerprint: string): Promise<JsonValue | null> {
    const id = this.receiptId(actor, action, operationId);
    const existing = await tx.get(RECEIPTS, id);
    if (!existing) return null;
    if (existing.organizationId !== actor.organizationId || existing.actorUserId !== actor.actorUserId
      || existing.fingerprint !== fingerprint || typeof existing.result !== 'object' || existing.result === null) {
      throw new QuestionAdminError('CONFLICT');
    }
    return clone(existing.result);
  }
  private async finish(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext, action: string,
    operationId: string, fingerprint: string, reason: string, targetIds: readonly string[],
    result: QuestionAdminDetail | readonly QuestionAdminDetail[]): Promise<void> {
    const receiptId = this.receiptId(actor, action, operationId);
    const receipt = await tx.create(RECEIPTS, { _id: receiptId, organizationId: actor.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, actorUserId: actor.actorUserId, action,
      operationId, fingerprint, result: result as unknown as JsonValue });
    const auditId = `audit:${actor.organizationId}:${hashHex(`${actor.requestId}:${operationId}:${action}`)}`;
    const audit = await tx.append(AUDITS, { _id: auditId, organizationId: actor.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, id: auditId, requestId: actor.requestId,
      actorUserId: actor.actorUserId, actorRole: actor.actorRole, action: `question.${action}`,
      targetType: 'learning_resource', targetId: targetIds.length === 1 ? targetIds[0]! : null,
      result: 'succeeded', errorCode: null, metadata: { affectedCount: targetIds.length, reasonProvided: Boolean(reason.trim()) },
      occurredAt: this.clock.nowIso() });
    if (!receipt || !audit) throw new QuestionAdminError('SERVICE_UNAVAILABLE');
  }
  private receiptId(actor: TrustedActorContext, action: string, operationId: string): string {
    return `question_admin_${hashHex(JSON.stringify([actor.organizationId, actor.actorUserId, action, operationId]))}`;
  }
}
