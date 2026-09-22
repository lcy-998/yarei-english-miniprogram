import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import {
  RELATIONSHIP_COMMAND_ACTIONS,
  validateRelationshipCommandRequest,
} from '../../src/contracts/org-content-functions';
import type { BindingCodeIssueView, ParentStudentLinkView } from '../../src/org-content/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createOrgContentFailureMapper } from '../shared/org-content-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type RelationshipCommandOutput = BindingCodeIssueView | ParentStudentLinkView | null;

export interface RelationshipCommandHandler {
  issueBindingCode(actor: TrustedActorContext, studentId: string, operationId: string): Promise<BindingCodeIssueView>;
  bindChild(actor: TrustedActorContext, studentNumber: string, code: string, operationId: string): Promise<ParentStudentLinkView>;
  unbindChild(actor: TrustedActorContext, childId: string, expectedVersion: number, reason: string, operationId: string): Promise<void>;
}

export interface RelationshipCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: RelationshipCommandHandler;
}

export function createRelationshipCommandFunction(dependencies: RelationshipCommandFunctionDependencies) {
  return createTrustedFunction(
    'relationship-command',
    RELATIONSHIP_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createOrgContentFailureMapper(dependencies.mapFailure) },
    validateRelationshipCommandRequest,
    async (input, actor): Promise<ServiceResult<RelationshipCommandOutput>> => {
      if (input.action === 'issueBindingCode') {
        const result = await dependencies.handler.issueBindingCode(actor, input.studentId, input.operationId);
        return success(result, createMeta(dependencies.clock, dependencies.requestIds));
      }
      if (input.action === 'bindChild') {
        const result = await dependencies.handler.bindChild(actor, input.studentNumber, input.code, input.operationId);
        return success(result, createMeta(dependencies.clock, dependencies.requestIds));
      }
      await dependencies.handler.unbindChild(
        actor,
        input.childId,
        input.expectedVersion,
        input.reason,
        input.operationId,
      );
      return success(null, createMeta(dependencies.clock, dependencies.requestIds));
    },
  );
}
