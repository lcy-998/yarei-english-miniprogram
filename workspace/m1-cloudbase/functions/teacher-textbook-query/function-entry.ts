import { TEACHER_TEXTBOOK_QUERY_ACTIONS, validateTeacherTextbookQueryRequest } from '../../src/contracts/teacher-textbook-functions';
import type { TeacherTextbookService } from '../../src/textbook/service';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createTeacherTextbookFailureMapper } from '../shared/teacher-textbook-failure';

export interface TeacherTextbookQueryDependencies extends TrustedFunctionDependencies { readonly service: TeacherTextbookService }
export function createTeacherTextbookQueryFunction(dependencies: TeacherTextbookQueryDependencies) {
  return createTrustedFunction('teacher-textbook-query', TEACHER_TEXTBOOK_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTeacherTextbookFailureMapper(dependencies.mapFailure) },
    validateTeacherTextbookQueryRequest,
    async (input, actor): Promise<ServiceResult<Awaited<ReturnType<TeacherTextbookService['listClasses']>>
      | Awaited<ReturnType<TeacherTextbookService['getCenterSettings']>>
      | Awaited<ReturnType<TeacherTextbookService['getClass']>>
      | Awaited<ReturnType<TeacherTextbookService['listTextbooks']>>
      | Awaited<ReturnType<TeacherTextbookService['getTextbook']>>>> => {
      if (input.action === 'getCenterSettings') return success(
        await dependencies.service.getCenterSettings(actor), createMeta(dependencies.clock, dependencies.requestIds));
      if (input.action === 'listClasses') return success(
        await dependencies.service.listClasses(actor), createMeta(dependencies.clock, dependencies.requestIds));
      if ('classId' in input) return success(
        await dependencies.service.getClass(actor, input.classId), createMeta(dependencies.clock, dependencies.requestIds));
      if ('filters' in input) return success(
        await dependencies.service.listTextbooks(actor, input.filters, input.page, input.targetClassId),
        createMeta(dependencies.clock, dependencies.requestIds));
      if ('textbookId' in input) return success(
        await dependencies.service.getTextbook(actor, input.textbookId, input.targetClassId),
        createMeta(dependencies.clock, dependencies.requestIds));
      throw new Error('Unexpected textbook query action.');
    });
}
