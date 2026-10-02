import { NOTIFICATION_COMMAND_ACTIONS, validateNotificationCommandRequest } from '../../src/contracts/notification-functions';
import type { NotificationService } from '../../src/notification/service';
import { createMeta, success } from '../../src/shared/result';
import { createNotificationFailureMapper } from '../shared/notification-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface NotificationCommandDependencies extends TrustedFunctionDependencies { readonly service: NotificationService }

export function createNotificationCommandFunction(dependencies: NotificationCommandDependencies) {
  return createTrustedFunction('notification-command', NOTIFICATION_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createNotificationFailureMapper(dependencies.mapFailure) },
    validateNotificationCommandRequest,
    async (input, actor) => success(input.action === 'markRead'
      ? await dependencies.service.markRead(actor, input.noticeId)
      : await dependencies.service.markAllRead(actor), createMeta(dependencies.clock, dependencies.requestIds)));
}
