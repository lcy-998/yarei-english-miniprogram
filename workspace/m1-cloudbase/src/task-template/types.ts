import type { FrozenTaskItem, TaskItemReference } from '../task-core/types';

export interface TaskTemplate {
  readonly id: string;
  readonly organizationId: string;
  readonly ownerTeacherId: string | null;
  readonly scope: 'system' | 'personal';
  readonly title: string;
  readonly description: string;
  readonly itemRefs: readonly TaskItemReference[];
  readonly items: readonly FrozenTaskItem[];
  readonly status: 'active' | 'deleted';
  readonly useCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TemplateReceipt {
  readonly organizationId: string;
  readonly teacherId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: TaskTemplate;
}

export type TemplateErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RESOURCE_OFFLINE' | 'SERVICE_UNAVAILABLE';
export class TemplateError extends Error {
  public constructor(public readonly code: TemplateErrorCode) { super(code); this.name = 'TemplateError'; }
}
