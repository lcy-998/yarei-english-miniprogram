import { PHONICS_QUERY_ACTIONS, validatePhonicsQueryRequest } from '../../src/contracts/phonics-functions';
import type { PhonicsService } from '../../src/phonics/service';
import type { PhonicsCourseListItem, PhonicsCourseState, PhonicsCourseView } from '../../src/phonics/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createPhonicsFailureMapper } from '../shared/phonics-failure';

export interface PhonicsQueryDependencies extends TrustedFunctionDependencies { readonly service: PhonicsService }
export function createPhonicsQueryFunction(dependencies: PhonicsQueryDependencies) {
  return createTrustedFunction('phonics-query', PHONICS_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createPhonicsFailureMapper(dependencies.mapFailure) },
    validatePhonicsQueryRequest,
    async (input, actor): Promise<ServiceResult<readonly PhonicsCourseListItem[] | PhonicsCourseView
      | PhonicsCourseState | Readonly<{ courseId: string; phonemeId: string; temporaryUrl: string; expiresAt: string }>>> => success(
      input.action === 'listCourses' ? await dependencies.service.listCourses(actor)
        : input.action === 'getCourse' ? await dependencies.service.getCourse(actor, input.courseId)
          : input.action === 'getState' ? await dependencies.service.getState(actor, input.courseId)
            : await dependencies.service.getAudio(actor, input.courseId, input.phonemeId),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
