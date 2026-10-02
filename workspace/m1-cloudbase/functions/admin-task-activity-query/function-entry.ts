import { ADMIN_TASK_ACTIVITY_QUERY_ACTIONS, validateAdminTaskActivityQueryRequest } from '../../src/contracts/admin-task-activity-functions';
import type { AdminTaskActivityService } from '../../src/admin-task-activity/service';
import type { ManagedDetail, ManagedExport, ManagedList } from '../../src/admin-task-activity/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export function createAdminTaskActivityQueryFunction(dependencies: TrustedFunctionDependencies & { readonly service: AdminTaskActivityService }) {
  return createTrustedFunction('admin-task-activity-query', ADMIN_TASK_ACTIVITY_QUERY_ACTIONS, dependencies,
    validateAdminTaskActivityQueryRequest,
    async (input, actor): Promise<ServiceResult<ManagedList | ManagedDetail | ManagedExport>> => {
      if (input.action === 'list') return dependencies.service.list(actor, input.filters, input.page);
      if (input.action === 'detail') return dependencies.service.detail(actor, input.kind, input.id);
      return dependencies.service.exportCsv(actor, input.filters);
    });
}
