import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('task-query', ['getTeacherWorkbench', 'listTeacherTasks', 'getDraftOptions', 'previewTask', 'getCompletion'] as const);
