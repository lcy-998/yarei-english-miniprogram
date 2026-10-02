import { NOTIFICATION_QUERY_ACTIONS, validateNotificationQueryRequest } from '../../src/contracts/notification-functions';
import type { NotificationService } from '../../src/notification/service';
import { createMeta, success } from '../../src/shared/result';
import { createNotificationFailureMapper } from '../shared/notification-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface NotificationQueryDependencies extends TrustedFunctionDependencies { readonly service: NotificationService }

export function createNotificationQueryFunction(dependencies: NotificationQueryDependencies) {
  return createTrustedFunction('notification-query', NOTIFICATION_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createNotificationFailureMapper(dependencies.mapFailure) },
    validateNotificationQueryRequest,
    async (input, actor) => success(await dependencies.service.list(actor, input.filter, input.offset, input.limit, input.days),
      createMeta(dependencies.clock, dependencies.requestIds)));
}
