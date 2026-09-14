import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('submission-command', ['saveDraft', 'submit'] as const);
