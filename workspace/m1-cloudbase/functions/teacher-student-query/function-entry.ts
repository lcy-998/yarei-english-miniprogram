import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import {
  TEACHER_STUDENT_QUERY_ACTIONS,
  validateTeacherStudentQueryRequest,
} from '../../src/contracts/teacher-student-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { TeacherStudentQueryService } from '../../src/teacher-students/service';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface TeacherStudentQueryHandler extends Pick<TeacherStudentQueryService, 'listStudents' | 'getStudent'> {}

export interface TeacherStudentQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: TeacherStudentQueryHandler;
}

export function createTeacherStudentQueryFunction(dependencies: TeacherStudentQueryFunctionDependencies) {
  return createTrustedFunction(
    'teacher-student-query',
    TEACHER_STUDENT_QUERY_ACTIONS,
    dependencies,
    validateTeacherStudentQueryRequest,
    async (input, actor: TrustedActorContext): Promise<ServiceResult<unknown>> => {
      switch (input.action) {
        case 'listStudents': return dependencies.handler.listStudents(actor, input.filters, input.page);
        case 'getStudent': return dependencies.handler.getStudent(actor, input.studentId);
      }
    },
  );
}
