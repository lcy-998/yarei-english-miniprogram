import type { LearningResourceRecord } from '../task-core/types';
import type { TemplateTransaction, TemplateUnitOfWork } from './repository';
import type { TaskTemplate, TemplateReceipt } from './types';

export interface TemplateFixture {
  readonly grants?: readonly Readonly<{ organizationId: string; teacherId: string; classId: string;
    permissions: readonly string[]; status: 'active' | 'revoked' }>[];
  readonly resources?: readonly LearningResourceRecord[];
  readonly templates?: readonly TaskTemplate[];
  readonly receipts?: readonly TemplateReceipt[];
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class InMemoryTemplateRepository implements TemplateUnitOfWork, TemplateTransaction {
  private state: { grants: NonNullable<TemplateFixture['grants']>; resources: LearningResourceRecord[];
    templates: TaskTemplate[]; receipts: TemplateReceipt[] };
  private tail: Promise<void> = Promise.resolve();
  public constructor(fixture: TemplateFixture = {}) {
    this.state = copy({ grants: fixture.grants ?? [], resources: [...(fixture.resources ?? [])],
      templates: [...(fixture.templates ?? [])], receipts: [...(fixture.receipts ?? [])] });
  }
  public async transaction<T>(work: (transaction: TemplateTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = copy(this.state);
    try { return await work(this); }
    catch (error: unknown) { this.state = before; throw error; }
    finally { release(); }
  }
  public async listTeacherClassIds(organizationId: string, teacherId: string,
    permission: string): Promise<readonly string[]> {
    return copy(this.state.grants.filter(item => item.organizationId === organizationId
      && item.teacherId === teacherId && item.status === 'active' && item.permissions.includes(permission))
      .map(item => item.classId));
  }
  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null> {
    return copy(this.state.resources.find(item => item.organizationId === organizationId && item.id === resourceId) ?? null);
  }
  public async findTemplate(organizationId: string, templateId: string): Promise<TaskTemplate | null> {
    return copy(this.state.templates.find(item => item.organizationId === organizationId && item.id === templateId) ?? null);
  }
  public async listTemplates(organizationId: string): Promise<readonly TaskTemplate[]> {
    return copy(this.state.templates.filter(item => item.organizationId === organizationId));
  }
  public async saveTemplate(template: TaskTemplate, expectedVersion: number): Promise<boolean> {
    const index = this.state.templates.findIndex(item => item.organizationId === template.organizationId && item.id === template.id);
    if ((index < 0 && expectedVersion !== 0) || (index >= 0 && this.state.templates[index]?.version !== expectedVersion)) return false;
    if (index < 0) this.state.templates.push(copy(template)); else this.state.templates[index] = copy(template);
    return true;
  }
  public async findReceipt(organizationId: string, teacherId: string, operationId: string): Promise<TemplateReceipt | null> {
    return copy(this.state.receipts.find(item => item.organizationId === organizationId
      && item.teacherId === teacherId && item.operationId === operationId) ?? null);
  }
  public async saveReceipt(receipt: TemplateReceipt): Promise<boolean> {
    if (this.state.receipts.some(item => item.organizationId === receipt.organizationId
      && item.teacherId === receipt.teacherId && item.operationId === receipt.operationId)) return false;
    this.state.receipts.push(copy(receipt)); return true;
  }
  public snapshot() { return copy(this.state); }
}
