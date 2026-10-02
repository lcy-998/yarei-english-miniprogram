import { TEXTBOOK_ADMIN_QUERY_ACTIONS, validateTextbookAdminQueryRequest } from '../../src/contracts/textbook-admin-functions';
import type { TextbookAdminService } from '../../src/textbook/admin-service';
import type { AdminTextbookPreview, AdminTextbookOverview } from '../../src/textbook/admin-types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createTeacherTextbookFailureMapper } from '../shared/teacher-textbook-failure';

export interface TextbookAdminQueryDependencies extends TrustedFunctionDependencies { readonly service: TextbookAdminService }
export function createTextbookAdminQueryFunction(dependencies: TextbookAdminQueryDependencies) {
  return createTrustedFunction('textbook-admin-query', TEXTBOOK_ADMIN_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTeacherTextbookFailureMapper(dependencies.mapFailure) },
    validateTextbookAdminQueryRequest,
    async (input, actor): Promise<ServiceResult<AdminTextbookOverview | AdminTextbookPreview>> => success(
      input.action === 'getOverview' ? await dependencies.service.overview(actor)
        : await dependencies.service.preview(actor, input.resourceId),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
