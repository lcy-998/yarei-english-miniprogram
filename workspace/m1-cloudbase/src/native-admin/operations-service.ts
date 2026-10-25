import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import { authorizeNativeAdmin, type NativeAdminGrantReader,
  type NativeAdminPermission } from './authorization';
import { nativeAdminGrantId } from './document-grant-repository';
import { hasActivePublicQuestionSource } from '../question-admin/public-question-source';

export interface NativeTextbookConfigView { resourceId: string; classIds: string[];
  status: 'draft' | 'published' | 'disabled'; version: number }
export interface SetTextbookConfigStatusInput { resourceId: string;
  status: 'published' | 'disabled'; reason: string }
export interface NativeQuestionStatusView { questionId: string;
  status: 'published' | 'offline'; version: number }
export interface SetNativeQuestionBatchStatusInput { status: 'published' | 'offline';
  questions: readonly Readonly<{ questionId: string; expectedVersion: number }>[]; reason: string }
export interface NativeQuestionBatchStatusView { status: 'published' | 'offline';
  changedCount: number; items: readonly Readonly<{ questionId: string; version: number }>[] }
export interface SetNativeQuestionVisibilityInput { questionId: string;
  organizationWide: boolean; classIds: readonly string[]; reason: string }
export interface NativeQuestionVisibilityView { questionId: string;
  organizationWide: boolean; classIds: string[]; version: number }
export interface NativeManagedStopView { kind: 'classroom' | 'activity'; id: string;
  status: string; version: number }
export class NativeAdminOperationsError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
    | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') { super(code); }
}

export class NativeAdminOperationsService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly grants: NativeAdminGrantReader,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async saveTextbookConfig(actor: TrustedActorContext, input: Readonly<{
    resourceId: string; classIds: readonly string[]; reason: string }>,
    expectedVersion: number, operationId: string): Promise<NativeTextbookConfigView> {
    commandCheck(expectedVersion, operationId, input.reason, true);
    idCheck(input.resourceId);
    if (!Array.isArray(input.classIds) || input.classIds.length < 1 || input.classIds.length > 500
      || new Set(input.classIds).size !== input.classIds.length
      || input.classIds.some(id => !validId(id))) throw new NativeAdminOperationsError('VALIDATION_ERROR');
    const scope = await this.authorize(actor, 'textbook.manage');
    requireClasses(scope, input.classIds);
    return this.database.runTransaction(async tx => {
      const liveScope = await this.liveGuard(tx, actor, 'textbook.manage');
      requireClasses(liveScope, input.classIds);
      const fingerprint = hash(['saveTextbookConfig', input, expectedVersion]);
      const prior = await this.receipt<NativeTextbookConfigView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const resource = await tx.get('learning_resources', input.resourceId);
      if (!visible(resource, actor.organizationId) || resource.type !== 'reading'
        || resource.category !== 'synchronized') throw new NativeAdminOperationsError('NOT_FOUND');
      for (const classId of input.classIds) {
        const classroom = await tx.get('classes', classId);
        if (!visible(classroom, actor.organizationId) || classroom.status !== 'active') {
          throw new NativeAdminOperationsError('VALIDATION_ERROR');
        }
      }
      const draftId = `textbook_catalog_${hash([actor.organizationId, input.resourceId])}`;
      const current = await tx.get('textbook_catalog_drafts', draftId);
      if ((current?.version ?? 0) !== expectedVersion) throw new NativeAdminOperationsError('CONFLICT');
      const now = this.clock.nowIso();
      const next: VersionedDocument = { ...(current ?? { _id: draftId,
        organizationId: actor.organizationId, schemaVersion: 1, deletedAt: null }),
      version: expectedVersion + 1, resourceId: input.resourceId,
      classIds: [...input.classIds], status: 'draft', updatedAt: now,
      publishedAt: current?.publishedAt ?? null };
      const saved = current ? await tx.replace('textbook_catalog_drafts', draftId,
        expectedVersion, next) : await tx.create('textbook_catalog_drafts', next);
      if (!saved) throw new NativeAdminOperationsError('CONFLICT');
      const result: NativeTextbookConfigView = { resourceId: input.resourceId,
        classIds: [...input.classIds], status: 'draft', version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, input.reason,
        'native_admin.textbook.config_saved', 'textbook', input.resourceId, result);
      return result;
    });
  }

  public async setQuestionStatus(actor: TrustedActorContext, input: Readonly<{
    questionId: string; status: 'published' | 'offline'; reason: string }>,
    expectedVersion: number, operationId: string): Promise<NativeQuestionStatusView> {
    commandCheck(expectedVersion, operationId, input.reason);
    idCheck(input.questionId);
    if (input.status !== 'published' && input.status !== 'offline') {
      throw new NativeAdminOperationsError('VALIDATION_ERROR');
    }
    await this.authorize(actor, 'question.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'question.manage');
      const fingerprint = hash(['setQuestionStatus', input, expectedVersion]);
      const prior = await this.receipt<NativeQuestionStatusView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const question = await tx.get('learning_resources', input.questionId);
      if (!visible(question, actor.organizationId) || question.type !== 'exercise') {
        throw new NativeAdminOperationsError('NOT_FOUND');
      }
      const visibility = object(question.visibility);
      const classIds = Array.isArray(visibility?.classIds) ? visibility.classIds : [];
      if (!visibility || (visibility.type !== 'organization' && visibility.type !== 'classes')
        || visibility.type === 'organization' && !scope.organizationWide
        || visibility.type === 'classes' && (!classIds.length
          || classIds.some(id => typeof id !== 'string'
            || !scope.organizationWide && !scope.classIds.includes(id)))) {
        throw new NativeAdminOperationsError('FORBIDDEN');
      }
      if (question.version !== expectedVersion) throw new NativeAdminOperationsError('CONFLICT');
      if (input.status === 'published'
        && !await hasActivePublicQuestionSource(tx, { ...question, status: 'published' })) {
        throw new NativeAdminOperationsError('VALIDATION_ERROR');
      }
      if (input.status === 'published' && (!nonempty(question.stem)
        || !['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(String(question.questionType))
        || question.correctAnswer === undefined || typeof question.explanation !== 'string')) {
        throw new NativeAdminOperationsError('VALIDATION_ERROR');
      }
      const next: VersionedDocument = { ...question, version: question.version + 1,
        status: input.status, updatedAt: this.clock.nowIso() };
      if (!await tx.replace('learning_resources', question._id, question.version, next)) {
        throw new NativeAdminOperationsError('CONFLICT');
      }
      const result: NativeQuestionStatusView = { questionId: question._id,
        status: input.status, version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, input.reason,
        'native_admin.question.status_changed', 'learning_resource', question._id, result);
      return result;
    });
  }

  public async setQuestionVisibility(actor: TrustedActorContext,
    input: SetNativeQuestionVisibilityInput, expectedVersion: number,
    operationId: string): Promise<NativeQuestionVisibilityView> {
    commandCheck(expectedVersion, operationId, input.reason);
    idCheck(input.questionId);
    if (typeof input.organizationWide !== 'boolean' || !Array.isArray(input.classIds)
      || input.classIds.length > 500 || input.classIds.some(id => !validId(id))
      || new Set(input.classIds).size !== input.classIds.length
      || input.organizationWide && input.classIds.length !== 0
      || !input.organizationWide && input.classIds.length === 0) {
      throw new NativeAdminOperationsError('VALIDATION_ERROR');
    }
    const scope = await this.authorize(actor, 'question.manage');
    if (input.organizationWide) {
      if (!scope.organizationWide) throw new NativeAdminOperationsError('FORBIDDEN');
    } else requireClasses(scope, input.classIds);
    return this.database.runTransaction(async tx => {
      const liveScope = await this.liveGuard(tx, actor, 'question.manage');
      if (input.organizationWide) {
        if (!liveScope.organizationWide) throw new NativeAdminOperationsError('FORBIDDEN');
      } else requireClasses(liveScope, input.classIds);
      const fingerprint = hash(['setQuestionVisibility', input, expectedVersion]);
      const prior = await this.receipt<NativeQuestionVisibilityView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const question = await tx.get('learning_resources', input.questionId);
      if (!visible(question, actor.organizationId) || question.type !== 'exercise') {
        throw new NativeAdminOperationsError('NOT_FOUND');
      }
      if (question.version !== expectedVersion) throw new NativeAdminOperationsError('CONFLICT');
      for (const classId of input.classIds) {
        const classroom = await tx.get('classes', classId);
        if (!visible(classroom, actor.organizationId) || classroom.status !== 'active') {
          throw new NativeAdminOperationsError('VALIDATION_ERROR');
        }
      }
      const next: VersionedDocument = { ...question, version: question.version + 1,
        visibility: input.organizationWide ? { type: 'organization', classIds: [] }
          : { type: 'classes', classIds: [...input.classIds] }, updatedAt: this.clock.nowIso() };
      if (!await tx.replace('learning_resources', question._id, question.version, next)) {
        throw new NativeAdminOperationsError('CONFLICT');
      }
      const result: NativeQuestionVisibilityView = { questionId: question._id,
        organizationWide: input.organizationWide, classIds: [...input.classIds], version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, input.reason,
        'native_admin.question.visibility_changed', 'learning_resource', question._id, result);
      return result;
    });
  }

  public async setQuestionBatchStatus(actor: TrustedActorContext,
    input: SetNativeQuestionBatchStatusInput, operationId: string): Promise<NativeQuestionBatchStatusView> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(operationId) || !input.reason.trim()
      || input.reason.length > 200 || !['published', 'offline'].includes(input.status)
      || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 50
      || input.questions.some(item => !validId(item.questionId) || !Number.isSafeInteger(item.expectedVersion)
        || item.expectedVersion < 1)
      || new Set(input.questions.map(item => item.questionId)).size !== input.questions.length) {
      throw new NativeAdminOperationsError('VALIDATION_ERROR');
    }
    await this.authorize(actor, 'question.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'question.manage');
      const fingerprint = hash(['setQuestionBatchStatus', input]);
      const prior = await this.receipt<NativeQuestionBatchStatusView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const questions: VersionedDocument[] = [];
      for (const item of input.questions) {
        const question = await tx.get('learning_resources', item.questionId);
        if (!visible(question, actor.organizationId) || question.type !== 'exercise') {
          throw new NativeAdminOperationsError('NOT_FOUND');
        }
        const visibility = object(question.visibility);
        const classIds = Array.isArray(visibility?.classIds) ? visibility.classIds : [];
        if (!visibility || (visibility.type !== 'organization' && visibility.type !== 'classes')
          || visibility.type === 'organization' && !scope.organizationWide
          || visibility.type === 'classes' && (!classIds.length
            || classIds.some(id => typeof id !== 'string'
              || !scope.organizationWide && !scope.classIds.includes(id)))) {
          throw new NativeAdminOperationsError('FORBIDDEN');
        }
        if (question.version !== item.expectedVersion) throw new NativeAdminOperationsError('CONFLICT');
        if (input.status === 'published'
          && !await hasActivePublicQuestionSource(tx, { ...question, status: 'published' })) {
          throw new NativeAdminOperationsError('VALIDATION_ERROR');
        }
        if (input.status === 'published' && (!nonempty(question.stem)
          || !['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(String(question.questionType))
          || question.correctAnswer === undefined || typeof question.explanation !== 'string')) {
          throw new NativeAdminOperationsError('VALIDATION_ERROR');
        }
        questions.push(question);
      }
      const items: Array<{ questionId: string; version: number }> = [];
      for (const question of questions) {
        const next: VersionedDocument = { ...question, version: question.version + 1,
          status: input.status, updatedAt: this.clock.nowIso() };
        if (!await tx.replace('learning_resources', question._id, question.version, next)) {
          throw new NativeAdminOperationsError('CONFLICT');
        }
        items.push({ questionId: question._id, version: next.version });
      }
      const result: NativeQuestionBatchStatusView = { status: input.status,
        changedCount: items.length, items };
      await this.finish(tx, actor, operationId, fingerprint, input.reason,
        'native_admin.question.batch_status_changed', 'learning_resource_batch',
        hash(items.map(item => item.questionId)), result);
      return result;
    });
  }

  public async setTextbookConfigStatus(actor: TrustedActorContext,
    input: SetTextbookConfigStatusInput, expectedVersion: number,
    operationId: string): Promise<NativeTextbookConfigView> {
    commandCheck(expectedVersion, operationId, input.reason);
    idCheck(input.resourceId);
    if (input.status !== 'published' && input.status !== 'disabled') {
      throw new NativeAdminOperationsError('VALIDATION_ERROR');
    }
    await this.authorize(actor, 'textbook.manage');
    return this.database.runTransaction(async tx => {
      const liveScope = await this.liveGuard(tx, actor, 'textbook.manage');
      const fingerprint = hash(['setTextbookConfigStatus', input, expectedVersion]);
      const prior = await this.receipt<NativeTextbookConfigView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const resource = await tx.get('learning_resources', input.resourceId);
      if (!visible(resource, actor.organizationId) || resource.type !== 'reading'
        || resource.category !== 'synchronized') throw new NativeAdminOperationsError('NOT_FOUND');
      const draftId = `textbook_catalog_${hash([actor.organizationId, input.resourceId])}`;
      const current = await tx.get('textbook_catalog_drafts', draftId);
      if (!visible(current, actor.organizationId) || current.version !== expectedVersion
        || current.status !== 'draft' && current.status !== 'published' && current.status !== 'disabled'
        || input.status === 'disabled' && current.status !== 'published') {
        throw new NativeAdminOperationsError('CONFLICT');
      }
      const classIds = Array.isArray(current.classIds)
        ? current.classIds.filter((id): id is string => typeof id === 'string') : [];
      if (!classIds.length || new Set(classIds).size !== classIds.length) {
        throw new NativeAdminOperationsError('VALIDATION_ERROR');
      }
      requireClasses(liveScope, classIds);
      for (const classId of classIds) {
        const classroom = await tx.get('classes', classId);
        if (!visible(classroom, actor.organizationId) || classroom.status !== 'active') {
          throw new NativeAdminOperationsError('VALIDATION_ERROR');
        }
      }
      const next: VersionedDocument = { ...current, version: current.version + 1,
        status: input.status, updatedAt: this.clock.nowIso(),
        publishedAt: input.status === 'published' ? this.clock.nowIso() : current.publishedAt ?? null,
        disabledAt: input.status === 'disabled' ? this.clock.nowIso() : null };
      if (!await tx.replace('textbook_catalog_drafts', current._id, current.version, next)) {
        throw new NativeAdminOperationsError('CONFLICT');
      }
      const result: NativeTextbookConfigView = { resourceId: input.resourceId,
        classIds, status: input.status, version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, input.reason,
        'native_admin.textbook.config_status_changed', 'textbook', input.resourceId, result);
      return result;
    });
  }

  public async stopManaged(actor: TrustedActorContext, input: Readonly<{
    kind: 'classroom' | 'activity'; id: string; reason: string }>,
    expectedVersion: number, operationId: string): Promise<NativeManagedStopView> {
    commandCheck(expectedVersion, operationId, input.reason);
    idCheck(input.id);
    if (input.kind !== 'classroom' && input.kind !== 'activity') {
      throw new NativeAdminOperationsError('VALIDATION_ERROR');
    }
    await this.authorize(actor, 'task.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'task.manage');
      const fingerprint = hash(['stopManaged', input, expectedVersion]);
      const prior = await this.receipt<NativeManagedStopView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const collection = input.kind === 'classroom' ? 'tasks' : 'checkin_activities';
      const current = await tx.get(collection, input.id);
      if (!visible(current, actor.organizationId)) throw new NativeAdminOperationsError('NOT_FOUND');
      const classIds = managedClassIds(current, input.kind);
      requireClasses(scope, classIds);
      if (current.version !== expectedVersion) throw new NativeAdminOperationsError('CONFLICT');
      const status = nextManagedStatus(input.kind, current.status);
      const now = this.clock.nowIso();
      const payload = input.kind === 'activity' ? object(current.payload) : null;
      if (input.kind === 'activity' && (!payload || payload.id !== current._id
        || payload.organizationId !== actor.organizationId || payload.status !== current.status
        || payload.version !== current.version)) throw new NativeAdminOperationsError('SERVICE_UNAVAILABLE');
      const next: VersionedDocument = { ...current, version: current.version + 1, status,
        ...(input.kind === 'classroom' && status === 'withdrawn'
          ? { withdrawnAt: now, withdrawnBy: actor.actorUserId, withdrawReason: input.reason.trim() } : {}),
        ...(input.kind === 'activity' ? { closedAt: now, updatedAt: now,
          payload: { ...payload, status, version: current.version + 1,
            closedAt: now, updatedAt: now } } : {}) };
      if (!await tx.replace(collection, current._id, current.version, next)) {
        throw new NativeAdminOperationsError('CONFLICT');
      }
      const result: NativeManagedStopView = { kind: input.kind, id: current._id,
        status, version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, input.reason,
        'native_admin.task.stopped', input.kind, current._id, result);
      return result;
    });
  }

  private async authorize(actor: TrustedActorContext, permission: NativeAdminPermission) {
    const decision = await authorizeNativeAdmin(this.grants, actor, permission);
    if (!decision.allowed) throw new NativeAdminOperationsError('FORBIDDEN');
    return decision.scope;
  }

  private async liveGuard(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    permission: NativeAdminPermission) {
    const user = await tx.get('users', actor.actorUserId);
    const grant = await tx.get('native_admin_grants', nativeAdminGrantId(actor.organizationId, actor.actorUserId));
    const scope = object(grant?.scope);
    const classIds = Array.isArray(scope?.classIds) ? scope.classIds : [];
    if (actor.actorRole !== 'teacher' || !visible(user, actor.organizationId)
      || user.status !== 'active' || user.authorizationVersion !== actor.authzVersion
      || !visible(grant, actor.organizationId) || grant.status !== 'active'
      || !Array.isArray(grant.permissions) || !grant.permissions.includes(permission)
      || !scope || typeof scope.organizationWide !== 'boolean'
      || classIds.some(id => typeof id !== 'string')) throw new NativeAdminOperationsError('FORBIDDEN');
    return { organizationWide: scope.organizationWide,
      classIds: classIds as string[] };
  }

  private async receipt<T>(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    operationId: string, fingerprint: string): Promise<T | null> {
    const row = await tx.get('native_admin_content_operations', receiptId(actor, operationId));
    if (!row) return null;
    if (!visible(row, actor.organizationId) || row.actorUserId !== actor.actorUserId
      || row.fingerprint !== fingerprint || typeof row.result !== 'object' || row.result === null) {
      throw new NativeAdminOperationsError('CONFLICT');
    }
    return row.result as T;
  }

  private async finish<T>(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    operationId: string, fingerprint: string, reason: string,
    action: string, targetType: string, targetId: string, result: T): Promise<void> {
    const now = this.clock.nowIso();
    if (!await tx.create('native_admin_content_operations', { _id: receiptId(actor, operationId),
      organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      actorUserId: actor.actorUserId, operationId, fingerprint,
      result: JSON.parse(JSON.stringify(result)), occurredAt: now })) {
      throw new NativeAdminOperationsError('CONFLICT');
    }
    if (!await tx.append('operation_logs', { _id: `native_admin_op_audit_${hash([
      actor.organizationId, actor.actorUserId, operationId])}`,
      organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: 'teacher',
      action, targetType, targetId, result: 'succeeded', errorCode: null, occurredAt: now,
      metadata: { reasonProvided: Boolean(reason.trim()), operationId } })) {
      throw new NativeAdminOperationsError('CONFLICT');
    }
  }
}

function visible(row: VersionedDocument | null, organizationId: string): row is VersionedDocument {
  return row !== null && row.organizationId === organizationId && row.deletedAt === null;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function receiptId(actor: TrustedActorContext, operationId: string): string {
  return `native_admin_op_${hash([actor.organizationId, actor.actorUserId, operationId])}`;
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function idCheck(value: string): void {
  if (!validId(value)) throw new NativeAdminOperationsError('VALIDATION_ERROR');
}
function commandCheck(version: number, operationId: string, reason: string, zeroAllowed = false): void {
  if (!Number.isSafeInteger(version) || version < (zeroAllowed ? 0 : 1)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)
    || !nonempty(reason) || reason.length > 200) throw new NativeAdminOperationsError('VALIDATION_ERROR');
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}
function requireClasses(scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>,
  classIds: readonly string[]): void {
  if (!classIds.length || classIds.some(id => !validId(id)
    || !scope.organizationWide && !scope.classIds.includes(id))) {
    throw new NativeAdminOperationsError('FORBIDDEN');
  }
}
function managedClassIds(row: VersionedDocument, kind: 'classroom' | 'activity'): string[] {
  if (kind === 'activity') {
    const schedule = object(row.schedule);
    return typeof schedule?.classId === 'string' ? [schedule.classId] : [];
  }
  const ids = Array.isArray(row.targetClassIds) ? row.targetClassIds
    : Array.isArray(row.classIds) ? row.classIds : typeof row.classId === 'string' ? [row.classId] : [];
  if (ids.some(id => !validId(id))) throw new NativeAdminOperationsError('SERVICE_UNAVAILABLE');
  return ids as string[];
}
function nextManagedStatus(kind: 'classroom' | 'activity', raw: unknown): string {
  if (kind === 'classroom') {
    if (raw === 'scheduled') return 'withdrawn';
    if (raw === 'draft' || raw === 'active' || raw === 'expired') return 'closed';
  } else if (raw === 'draft' || raw === 'published') return 'closed';
  throw new NativeAdminOperationsError('CONFLICT');
}
