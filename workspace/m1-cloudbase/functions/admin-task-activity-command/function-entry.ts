import { ADMIN_TASK_ACTIVITY_COMMAND_ACTIONS, validateAdminTaskActivityCommandRequest } from '../../src/contracts/admin-task-activity-functions';
import type { AdminTaskActivityService } from '../../src/admin-task-activity/service';
import { ManagedError, type StopManagedResult } from '../../src/admin-task-activity/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export function createAdminTaskActivityCommandFunction(dependencies: TrustedFunctionDependencies & { readonly service: AdminTaskActivityService }) {
  return createTrustedFunction('admin-task-activity-command', ADMIN_TASK_ACTIVITY_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => {
      if (phase === 'handler' && error instanceof ManagedError) return error.code;
      if (phase === 'handler' && error instanceof DocumentDatabasePlatformError) {
        return error.kind === 'conflict' ? 'CONFLICT' : error.kind === 'unavailable' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
      }
      return dependencies.mapFailure?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
    } },
    validateAdminTaskActivityCommandRequest,
    async (input, actor): Promise<ServiceResult<StopManagedResult>> => dependencies.service.stop(actor, input));
}
