import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('review-query', ['listReviewTasks', 'getSubmissionForReview', 'previewBatchComment'] as const);
