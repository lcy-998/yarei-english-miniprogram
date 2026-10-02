import type { TrustedActorContext } from '../auth/trusted-actor';
import { validTaskItemWeights, isSupportedCompletionRule, supportsExerciseSnapshot,
  supportsRecordingPromptSnapshot } from '../task-core/task-core-service';
import type { FrozenTaskItem, TaskItemReference } from '../task-core/types';
import { vocabularyWordIds } from '../vocabulary-evidence/summary';
import { supportsReadingRangeSnapshot } from '../task-core/reading-range';
import type { TemplateTransaction, TemplateUnitOfWork } from './repository';
import { TemplateError, type TaskTemplate } from './types';

export interface TemplateClock { nowIso(): string }
export interface TemplateIds { next(prefix: string): string }
export interface TemplateInput { readonly templateId?: string; readonly title: string;
  readonly description: string; readonly itemRefs: readonly TaskItemReference[] }

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validOperation(operationId: string, expectedVersion: number): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(operationId)
    && Number.isSafeInteger(expectedVersion) && expectedVersion >= 0;
}

export class TaskTemplateService {
  public constructor(private readonly repository: TemplateUnitOfWork,
    private readonly clock: TemplateClock, private readonly ids: TemplateIds) {}

  public async list(actor: TrustedActorContext): Promise<readonly TaskTemplate[]> {
    this.teacherOnly(actor);
    return this.repository.transaction(async transaction => {
      const classes = await this.classes(transaction, actor);
      const visible: TaskTemplate[] = [];
      for (const item of await transaction.listTemplates(actor.organizationId)) {
        if (item.status !== 'active') continue;
        if (item.scope === 'personal' && item.ownerTeacherId === actor.actorUserId) visible.push(copy(item));
        if (item.scope === 'system' && await this.systemAuthorized(transaction, actor.organizationId,
          item.itemRefs, classes)) visible.push(copy(item));
      }
      return visible;
    });
  }

  public async get(actor: TrustedActorContext, templateId: string): Promise<TaskTemplate> {
    this.teacherOnly(actor);
    if (!templateId?.trim()) throw new TemplateError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      const classes = await this.classes(transaction, actor);
      const template = await this.visibleTemplate(transaction, actor, templateId);
      if (template.scope === 'system' && !await this.systemAuthorized(transaction,
        actor.organizationId, template.itemRefs, classes)) throw new TemplateError('NOT_FOUND');
      return copy(template);
    });
  }

  public async save(actor: TrustedActorContext, input: TemplateInput,
    expectedVersion: number, operationId: string): Promise<TaskTemplate> {
    this.teacherOnly(actor);
    if (!validOperation(operationId, expectedVersion) || !this.validInput(input)
      || Boolean(input.templateId) !== (expectedVersion > 0)) throw new TemplateError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: 'save', input, expectedVersion });
    return this.repository.transaction(async transaction => {
      const classes = await this.classes(transaction, actor);
      const prior = await this.receipt(transaction, actor, operationId, fingerprint);
      if (prior) return prior;
      const current = input.templateId ? await this.personalTemplate(transaction, actor, input.templateId) : null;
      if ((current?.version ?? 0) !== expectedVersion) throw new TemplateError('CONFLICT');
      const items = await this.freeze(transaction, actor.organizationId, input.itemRefs, classes);
      const now = this.clock.nowIso();
      const template: TaskTemplate = { id: current?.id ?? this.ids.next('task_template'),
        organizationId: actor.organizationId, ownerTeacherId: actor.actorUserId, scope: 'personal',
        title: input.title.trim(), description: input.description.trim(), itemRefs: copy(input.itemRefs),
        items, status: 'active', useCount: current?.useCount ?? 0, version: expectedVersion + 1,
        createdAt: current?.createdAt ?? now, updatedAt: now };
      await this.commit(transaction, actor, operationId, fingerprint, template, expectedVersion);
      return copy(template);
    });
  }

  public async rename(actor: TrustedActorContext, templateId: string, title: string,
    expectedVersion: number, operationId: string): Promise<TaskTemplate> {
    this.teacherOnly(actor);
    if (!validOperation(operationId, expectedVersion) || !templateId.trim()
      || !title.trim() || title.trim().length > 50) throw new TemplateError('VALIDATION_ERROR');
    return this.changePersonal(actor, templateId, expectedVersion, operationId,
      JSON.stringify({ action: 'rename', templateId, title: title.trim(), expectedVersion }),
      current => ({ ...current, title: title.trim() }));
  }

  public async remove(actor: TrustedActorContext, templateId: string,
    expectedVersion: number, operationId: string): Promise<TaskTemplate> {
    this.teacherOnly(actor);
    if (!validOperation(operationId, expectedVersion) || !templateId.trim()) throw new TemplateError('VALIDATION_ERROR');
    return this.changePersonal(actor, templateId, expectedVersion, operationId,
      JSON.stringify({ action: 'remove', templateId, expectedVersion }),
      current => ({ ...current, status: 'deleted' }));
  }

  public async copyPersonal(actor: TrustedActorContext, templateId: string, title: string,
    expectedSourceVersion: number, operationId: string): Promise<TaskTemplate> {
    this.teacherOnly(actor);
    if (!validOperation(operationId, expectedSourceVersion) || !templateId.trim()
      || !title.trim() || title.trim().length > 50) throw new TemplateError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: 'copy', templateId, title: title.trim(), expectedSourceVersion });
    return this.repository.transaction(async transaction => {
      const classes = await this.classes(transaction, actor);
      const prior = await this.receipt(transaction, actor, operationId, fingerprint);
      if (prior) return prior;
      const source = await this.visibleTemplate(transaction, actor, templateId);
      if (source.scope === 'system' && !await this.systemAuthorized(transaction,
        actor.organizationId, source.itemRefs, classes)) throw new TemplateError('NOT_FOUND');
      if (source.version !== expectedSourceVersion) throw new TemplateError('CONFLICT');
      const now = this.clock.nowIso();
      const copyTemplate: TaskTemplate = { ...copy(source), id: this.ids.next('task_template'),
        ownerTeacherId: actor.actorUserId, scope: 'personal', title: title.trim(), useCount: 0,
        version: 1, createdAt: now, updatedAt: now };
      await this.commit(transaction, actor, operationId, fingerprint, copyTemplate, 0);
      return copy(copyTemplate);
    });
  }

  /** Compatibility preview only. Actual use is counted with task-command.instantiateTemplate. */
  public async use(actor: TrustedActorContext, templateId: string, expectedVersion: number,
    operationId: string): Promise<TaskTemplate> {
    this.teacherOnly(actor);
    if (!validOperation(operationId, expectedVersion) || !templateId.trim()) throw new TemplateError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      const classes = await this.classes(transaction, actor);
      const template = await this.visibleTemplate(transaction, actor, templateId);
      if (template.version !== expectedVersion) throw new TemplateError('CONFLICT');
      let commonClassIds = [...classes];
      for (const item of template.itemRefs) {
        const resource = await transaction.findResource(actor.organizationId, item.resourceId);
        if (!resource || resource.status !== 'published') throw new TemplateError('RESOURCE_OFFLINE');
        if (resource.visibility === 'classes') commonClassIds = commonClassIds.filter(id => resource.allowedClassIds.includes(id));
      }
      if (!commonClassIds.length) throw new TemplateError('RESOURCE_OFFLINE');
      return copy(template);
    });
  }

  private validInput(input: TemplateInput): boolean {
    return typeof input.title === 'string' && !!input.title.trim() && input.title.trim().length <= 50
      && typeof input.description === 'string' && input.description.length <= 300
      && Array.isArray(input.itemRefs) && input.itemRefs.length > 0 && input.itemRefs.length <= 30
      && new Set(input.itemRefs.map(item => item.id)).size === input.itemRefs.length
      && new Set(input.itemRefs.map(item => item.order)).size === input.itemRefs.length
      && input.itemRefs.every(item => typeof item.id === 'string' && !!item.id.trim()
        && typeof item.resourceId === 'string' && !!item.resourceId.trim()
        && Number.isSafeInteger(item.order) && item.order > 0
        && (item.scoringRule?.kind === 'manual' || item.scoringRule?.kind === 'automatic')
        && Number.isSafeInteger(item.scoringRule.maxScore) && Number(item.scoringRule.maxScore) > 0)
      && validTaskItemWeights(input.itemRefs);
  }
  private async freeze(transaction: TemplateTransaction, organizationId: string,
    references: readonly TaskItemReference[], classIds: readonly string[]): Promise<readonly FrozenTaskItem[]> {
    const items: FrozenTaskItem[] = [];
    let commonClassIds = [...classIds];
    for (const reference of references) {
      const resource = await transaction.findResource(organizationId, reference.resourceId);
      if (!resource || resource.status !== 'published') throw new TemplateError('RESOURCE_OFFLINE');
      if (resource.visibility === 'classes') commonClassIds = commonClassIds.filter(id => resource.allowedClassIds.includes(id));
      const rule = reference.completionRule;
      if (!rule || !isSupportedCompletionRule(resource.type, rule)
        || !supportsExerciseSnapshot(resource, rule)
        || !supportsReadingRangeSnapshot(resource, rule)
        || !supportsRecordingPromptSnapshot(resource)
        || (resource.type === 'recording' && reference.scoringRule?.kind !== 'manual')) throw new TemplateError('VALIDATION_ERROR');
      const words = resource.type === 'vocabulary' ? vocabularyWordIds(resource.payload) : null;
      if (resource.type === 'vocabulary' && resource.payload.words !== undefined && words === null) {
        throw new TemplateError('VALIDATION_ERROR');
      }
      items.push({ id: reference.id, resourceId: resource.id,
        resourceVersion: resource.contentVersion, snapshotSchemaVersion: words === null ? 1 : 2,
        resourceSnapshot: { title: resource.title, type: resource.type, payload: copy(resource.payload) },
        completionRule: copy(rule), scoringRule: copy(reference.scoringRule ?? { kind: 'manual', maxScore: 100 }),
        order: reference.order });
    }
    if (!commonClassIds.length) throw new TemplateError('RESOURCE_OFFLINE');
    return items;
  }
  private async systemAuthorized(transaction: TemplateTransaction, organizationId: string,
    references: readonly TaskItemReference[], classIds: readonly string[]): Promise<boolean> {
    if (!references.length) return false;
    let commonClassIds = [...classIds];
    for (const reference of references) {
      const resource = await transaction.findResource(organizationId, reference.resourceId);
      if (!resource || resource.status !== 'published') return false;
      if (resource.visibility === 'classes') commonClassIds = commonClassIds.filter(id => resource.allowedClassIds.includes(id));
      if (!commonClassIds.length) return false;
    }
    return true;
  }
  private teacherOnly(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('task.publish')) throw new TemplateError('FORBIDDEN');
  }
  private async classes(transaction: TemplateTransaction, actor: TrustedActorContext): Promise<readonly string[]> {
    if (!actor.permissions.includes('content.read')) throw new TemplateError('FORBIDDEN');
    const publish = await transaction.listTeacherClassIds(actor.organizationId, actor.actorUserId, 'task.publish');
    const content = await transaction.listTeacherClassIds(actor.organizationId, actor.actorUserId, 'content.read');
    const classes = publish.filter(id => content.includes(id) && actor.scopeIds.includes(id));
    if (!classes.length) throw new TemplateError('FORBIDDEN');
    return classes;
  }
  private async personalTemplate(transaction: TemplateTransaction, actor: TrustedActorContext,
    templateId: string): Promise<TaskTemplate> {
    const template = await transaction.findTemplate(actor.organizationId, templateId);
    if (!template || template.status !== 'active' || template.scope !== 'personal'
      || template.ownerTeacherId !== actor.actorUserId) throw new TemplateError('NOT_FOUND');
    return template;
  }
  private async visibleTemplate(transaction: TemplateTransaction, actor: TrustedActorContext,
    templateId: string): Promise<TaskTemplate> {
    const template = await transaction.findTemplate(actor.organizationId, templateId);
    if (!template || template.status !== 'active' || (template.scope !== 'system'
      && template.ownerTeacherId !== actor.actorUserId)) throw new TemplateError('NOT_FOUND');
    return template;
  }
  private async receipt(transaction: TemplateTransaction, actor: TrustedActorContext,
    operationId: string, fingerprint: string): Promise<TaskTemplate | null> {
    const receipt = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw new TemplateError('CONFLICT');
    return copy(receipt.result);
  }
  private async commit(transaction: TemplateTransaction, actor: TrustedActorContext, operationId: string,
    fingerprint: string, template: TaskTemplate, expectedVersion: number): Promise<void> {
    if (!await transaction.saveTemplate(template, expectedVersion)) throw new TemplateError('CONFLICT');
    if (!await transaction.saveReceipt({ organizationId: actor.organizationId, teacherId: actor.actorUserId,
      operationId, fingerprint, result: template })) throw new TemplateError('CONFLICT');
  }
  private async changePersonal(actor: TrustedActorContext, templateId: string, expectedVersion: number,
    operationId: string, fingerprint: string, mutate: (current: TaskTemplate) => TaskTemplate): Promise<TaskTemplate> {
    return this.repository.transaction(async transaction => {
      await this.classes(transaction, actor);
      const prior = await this.receipt(transaction, actor, operationId, fingerprint);
      if (prior) return prior;
      const current = await this.personalTemplate(transaction, actor, templateId);
      if (current.version !== expectedVersion) throw new TemplateError('CONFLICT');
      const changed = { ...mutate(current), version: expectedVersion + 1,
        updatedAt: this.clock.nowIso() };
      await this.commit(transaction, actor, operationId, fingerprint, changed, expectedVersion);
      return copy(changed);
    });
  }
}
