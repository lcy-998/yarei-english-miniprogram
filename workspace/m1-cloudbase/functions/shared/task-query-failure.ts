import type { ErrorCode } from '../../src/shared/protocol';
import { TaskCorePersistenceError } from '../../src/repositories/persistence-error';
import { TeacherCheckError } from '../../src/teacher-check/service';
import { ActivityError } from '../../src/activity/types';
import type { TrustedFunctionDependencies, TrustedFunctionFailurePhase } from './trusted-function';

export function createTaskQueryFailureMapper(custom: TrustedFunctionDependencies['mapFailure']) {
  return (phase: TrustedFunctionFailurePhase, error: unknown): ErrorCode => {
    if (phase === 'handler' && error instanceof TaskCorePersistenceError) return error.code;
    if (phase === 'handler' && error instanceof TeacherCheckError) return error.code;
    if (phase === 'handler' && error instanceof ActivityError) return error.code;
    const mapped = custom?.(phase, error);
    return mapped ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
  };
}
