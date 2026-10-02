import { PHONICS_COMMAND_ACTIONS, validatePhonicsCommandRequest } from '../../src/contracts/phonics-functions';
import type { PhonicsService } from '../../src/phonics/service';
import type { PhonicsAnswerView } from '../../src/phonics/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createPhonicsFailureMapper } from '../shared/phonics-failure';

export interface PhonicsCommandDependencies extends TrustedFunctionDependencies { readonly service: PhonicsService }
export function createPhonicsCommandFunction(dependencies: PhonicsCommandDependencies) {
  return createTrustedFunction('phonics-command', PHONICS_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createPhonicsFailureMapper(dependencies.mapFailure) },
    validatePhonicsCommandRequest,
    async (input, actor): Promise<ServiceResult<PhonicsAnswerView>> => success(
      await dependencies.service.submitAnswer(actor, { courseId: input.courseId,
        questionId: input.questionId, selectedOptionId: input.selectedOptionId, round: input.round },
      input.expectedVersion, input.operationId), createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
