import { TEXTBOOK_ADMIN_COMMAND_ACTIONS, validateTextbookAdminCommandRequest } from '../../src/contracts/textbook-admin-functions';
import type { TextbookAdminService } from '../../src/textbook/admin-service';
import type { TextbookCatalogDraft, TextbookCenterSettings } from '../../src/textbook/admin-types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createTeacherTextbookFailureMapper } from '../shared/teacher-textbook-failure';

export interface TextbookAdminCommandDependencies extends TrustedFunctionDependencies { readonly service: TextbookAdminService }
export function createTextbookAdminCommandFunction(dependencies: TextbookAdminCommandDependencies) {
  return createTrustedFunction('textbook-admin-command', TEXTBOOK_ADMIN_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createTeacherTextbookFailureMapper(dependencies.mapFailure) },
    validateTextbookAdminCommandRequest,
    async (input, actor): Promise<ServiceResult<TextbookCatalogDraft | TextbookCenterSettings>> => {
      const result = 'layout' in input
        ? await dependencies.service.saveSettings(actor, input.layout, input.expectedVersion, input.operationId,
          input.action === 'publishSettings')
        : input.action === 'saveCatalogDraft'
          ? await dependencies.service.saveCatalogDraft(actor, input.resourceId, input.classIds,
            input.expectedVersion, input.operationId)
          : await dependencies.service.changeCatalogStatus(actor, input.resourceId, input.expectedVersion,
            input.operationId, input.action === 'publishCatalog');
      return success(result, createMeta(dependencies.clock, dependencies.requestIds));
    });
}
