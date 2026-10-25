import { TeacherStudentAccountProvisioningAdapter } from '../../src/teacher-students/account-provisioning-adapter';
import { DocumentTeacherStudentBulkImportPort } from '../../src/teacher-students/bulk-import-document-port';
import { TeacherStudentBulkImportService } from '../../src/teacher-students/bulk-import-command';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { TEACHER_STUDENT_IMPORT_ACTIONS, validateTeacherStudentImportRequest } from './function-entry';
import { createTeacherStudentImportFunction } from './function-entry';

export { createTeacherStudentImportFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('teacher-student-import-command',
  TEACHER_STUDENT_IMPORT_ACTIONS, (_action, _payload, request) => {
    const validated = validateTeacherStudentImportRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });

/** The account-provider capability is injected only by the protected deployment bundle. */
export const main = createDefaultCloudBaseFunction('teacher-student-import-command', unavailable,
  (capabilities, infrastructure) => {
    if (capabilities.nativeAccountProvider === undefined) return unavailable;
    const service = new TeacherStudentBulkImportService(new DocumentTeacherStudentBulkImportPort(
      infrastructure.documents,
      new TeacherStudentAccountProvisioningAdapter(capabilities.nativeAccountProvider),
      infrastructure.clock,
    ));
    return createTeacherStudentImportFunction({ ...infrastructure, service });
  });
