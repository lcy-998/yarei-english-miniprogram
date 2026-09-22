import { LearningProgressError } from '../../src/learning-progress/types';
import type { ErrorCode } from '../../src/shared/protocol';
import type { TrustedFunctionDependencies, TrustedFunctionFailurePhase } from './trusted-function';

export function createLearningProgressFailureMapper(custom: TrustedFunctionDependencies['mapFailure']) {
  return (phase: TrustedFunctionFailurePhase, error: unknown): ErrorCode => {
    if (phase === 'handler' && error instanceof LearningProgressError) return error.code;
    const mapped = custom?.(phase, error);
    return mapped ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
  };
}

