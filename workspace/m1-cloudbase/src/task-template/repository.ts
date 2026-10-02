import type { LearningResourceRecord } from '../task-core/types';
import type { TaskTemplate, TemplateReceipt } from './types';

export interface TemplateTransaction {
  listTeacherClassIds(organizationId: string, teacherId: string, permission: string): Promise<readonly string[]>;
  findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null>;
  findTemplate(organizationId: string, templateId: string): Promise<TaskTemplate | null>;
  listTemplates(organizationId: string): Promise<readonly TaskTemplate[]>;
  saveTemplate(template: TaskTemplate, expectedVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, teacherId: string, operationId: string): Promise<TemplateReceipt | null>;
  saveReceipt(receipt: TemplateReceipt): Promise<boolean>;
}
export interface TemplateUnitOfWork { transaction<T>(work: (transaction: TemplateTransaction) => Promise<T>): Promise<T> }
