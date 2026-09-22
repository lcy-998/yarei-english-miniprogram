import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { REVIEW_QUERY_ACTIONS, validateReviewQueryRequest } from '../../src/contracts/task-query-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createReviewQueryFunction } from './function-entry';

export { createReviewQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'review-query',
  REVIEW_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateReviewQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseTaskQueryFunction(
  'review-query',
  unavailable,
  (_capabilities, infrastructure) => createReviewQueryFunction({
    ...infrastructure,
    handler: infrastructure.reviewHandler,
  }),
);
