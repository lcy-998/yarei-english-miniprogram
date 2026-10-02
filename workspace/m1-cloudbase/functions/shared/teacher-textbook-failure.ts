import { TextbookError } from '../../src/textbook/types';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import type { ErrorCode } from '../../src/shared/protocol';
import type { TrustedFunctionDependencies, TrustedFunctionFailurePhase } from './trusted-function';

export function createTeacherTextbookFailureMapper(custom: TrustedFunctionDependencies['mapFailure']):
  (phase: TrustedFunctionFailurePhase, error: unknown) => ErrorCode {
  return (phase, error) => {
    if (phase === 'handler' && error instanceof TextbookError) return error.code;
    if (phase === 'handler' && error instanceof DocumentDatabasePlatformError) {
      if (error.kind === 'conflict') return 'CONFLICT';
      if (error.kind === 'unavailable') return 'SERVICE_UNAVAILABLE';
      return 'INTERNAL_ERROR';
    }
    return custom?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
  };
}
