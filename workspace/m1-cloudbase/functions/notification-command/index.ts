import { NOTIFICATION_COMMAND_ACTIONS, validateNotificationCommandRequest } from '../../src/contracts/notification-functions';
import { DocumentNotificationRepository } from '../../src/notification/document-repository';
import { NotificationService } from '../../src/notification/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createNotificationCommandFunction } from './function-entry';

export { createNotificationCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('notification-command', NOTIFICATION_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateNotificationCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseFunction('notification-command', unavailable,
  (_capabilities, infrastructure) => createNotificationCommandFunction({ ...infrastructure,
    service: new NotificationService(new DocumentNotificationRepository(infrastructure.documents), infrastructure.clock) }));
