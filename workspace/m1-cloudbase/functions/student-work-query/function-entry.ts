import { STUDENT_WORK_QUERY_ACTIONS, validateStudentWorkQueryRequest } from '../../src/contracts/student-work-functions';
import type { StudentWorkService } from '../../src/student-work/service';
import type { StudentWork, WorkMaterialFacet, WorkMaterialPage, WorkMaterialView } from '../../src/student-work/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createStudentWorkFailureMapper } from '../shared/student-work-failure';

export interface StudentWorkQueryDependencies extends TrustedFunctionDependencies {
  readonly service: StudentWorkService;
}
export function createStudentWorkQueryFunction(dependencies: StudentWorkQueryDependencies) {
  return createTrustedFunction('student-work-query', STUDENT_WORK_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createStudentWorkFailureMapper(dependencies.mapFailure) },
    validateStudentWorkQueryRequest,
    async (input, actor): Promise<ServiceResult<readonly WorkMaterialView[] | readonly WorkMaterialFacet[] | WorkMaterialPage | WorkMaterialView | readonly StudentWork[] | Readonly<{
      workId?: string; materialId?: string; temporaryUrl: string; expiresAt: string }>>> => success(
      input.action === 'listMaterials'
        ? await dependencies.service.listMaterials(actor)
        : input.action === 'searchMaterials'
          ? await dependencies.service.searchMaterials(actor, input.keyword, input.offset, input.limit,
            { grade: input.grade, textbook: input.textbook, unit: input.unit })
        : input.action === 'listMaterialFacets'
          ? await dependencies.service.listMaterialFacets(actor)
        : input.action === 'getMaterial'
          ? await dependencies.service.getMaterial(actor, input.materialId)
        : input.action === 'getPlayback'
          ? await dependencies.service.getPlayback(actor, input.workId)
          : input.action === 'getMaterialPlayback'
            ? await dependencies.service.getMaterialPlayback(actor, input.materialId)
          : await dependencies.service.listMine(actor),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
