import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('task-command', ['saveDraft', 'publishTask', 'updatePublishedTask', 'withdrawTask', 'recycleTask'] as const);
