import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('review-command', ['publishReview', 'publishBatchComment'] as const);
