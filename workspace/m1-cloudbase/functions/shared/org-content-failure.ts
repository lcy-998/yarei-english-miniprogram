import type { ErrorCode } from '../../src/shared/protocol';
import { OrgContentError } from '../../src/org-content/types';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import type { TrustedFunctionDependencies, TrustedFunctionFailurePhase } from './trusted-function';

export function createOrgContentFailureMapper(
  custom: TrustedFunctionDependencies['mapFailure'],
): (phase: TrustedFunctionFailurePhase, error: unknown) => ErrorCode {
  return (phase, error) => {
    if (phase === 'handler' && error instanceof OrgContentError) return error.code;
    if (phase === 'handler' && error instanceof DocumentDatabasePlatformError) {
      if (error.kind === 'unavailable') return 'SERVICE_UNAVAILABLE';
      if (error.kind === 'conflict') return 'CONFLICT';
      return 'INTERNAL_ERROR';
    }
    const mapped = custom?.(phase, error);
    if (mapped !== undefined) return mapped;
    return phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
  };
}
