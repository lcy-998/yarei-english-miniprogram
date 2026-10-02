import { NOTIFICATION_QUERY_ACTIONS, validateNotificationQueryRequest } from '../../src/contracts/notification-functions';
import { DocumentNotificationRepository } from '../../src/notification/document-repository';
import { NotificationService } from '../../src/notification/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createNotificationQueryFunction } from './function-entry';

export { createNotificationQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('notification-query', NOTIFICATION_QUERY_ACTIONS, (_action, _payload, request) => {
  const validated = validateNotificationQueryRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseFunction('notification-query', unavailable,
  (_capabilities, infrastructure) => createNotificationQueryFunction({ ...infrastructure,
    service: new NotificationService(new DocumentNotificationRepository(infrastructure.documents), infrastructure.clock) }));
