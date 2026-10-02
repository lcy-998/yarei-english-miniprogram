import type { ErrorCode } from '../../src/shared/protocol';
import { NotificationError } from '../../src/notification/types';
import type { TrustedFunctionFailurePhase } from './trusted-function';

export function createNotificationFailureMapper(fallback?: (phase: TrustedFunctionFailurePhase, error: unknown) => ErrorCode) {
  return (phase: TrustedFunctionFailurePhase, error: unknown): ErrorCode => {
    if (phase === 'handler' && error instanceof NotificationError) return error.code;
    return fallback?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
  };
}
