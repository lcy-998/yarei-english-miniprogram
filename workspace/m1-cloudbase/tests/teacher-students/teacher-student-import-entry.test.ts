import { describe, expect, it } from 'vitest';
import { main } from '../../functions/teacher-student-import-command';
import { validateTeacherStudentImportRequest } from '../../functions/teacher-student-import-command/function-entry';

const csv = 'student_number,display_name,mobile,class_id\r\nDEMO001,虚构学员,13900000001,class_demo\r\n';

function request(csvBase64: string, operationId = 'import_demo') {
  return { apiVersion: 'm1.v1' as const, action: 'importTeacherStudents' as const,
    payload: { csvBase64 }, operationId };
}

describe('teacher student import protected entry', () => {
  it('accepts only a canonical, bounded CSV encoding and operation key', () => {
    const valid = validateTeacherStudentImportRequest(request(Buffer.from(csv).toString('base64')));
    expect(valid).toMatchObject({ ok: true, value: { operationId: 'import_demo' } });
    if (valid.ok) expect(Buffer.from(valid.value.bytes).toString()).toBe(csv);
    expect(validateTeacherStudentImportRequest(request('AA=A')).ok).toBe(false);
    expect(validateTeacherStudentImportRequest(request(Buffer.from(csv).toString('base64'), 'bad key')).ok).toBe(false);
    expect(validateTeacherStudentImportRequest({ ...request(Buffer.from(csv).toString('base64')),
      expectedVersion: 1 }).ok).toBe(false);
  });

  it('fails closed while trusted Manager Auth provisioning is unavailable', async () => {
    const result = await main(request(Buffer.from(csv).toString('base64')));
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
