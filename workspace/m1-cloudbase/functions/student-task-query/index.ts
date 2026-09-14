import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('student-task-query', ['getHome', 'listMyTasks', 'getMyTask'] as const);
