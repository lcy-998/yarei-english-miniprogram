import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('parent-query', ['getHome', 'listChildTasks', 'getChildTask', 'getFeedback'] as const);
