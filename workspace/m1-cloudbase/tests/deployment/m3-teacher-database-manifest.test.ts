import { describe, expect, it } from 'vitest';
import { M3_TEACHER_COLLECTION_NAMES,
  M3_TEACHER_DATABASE_MANIFEST } from '../../src/deployment/m3-teacher-database-manifest';
import { NATIVE_ADMIN_COLLECTIONS } from '../../src/native-admin/document-grant-repository';
import { TEACHER_STUDENT_IMPORT_COLLECTIONS } from '../../src/teacher-students/bulk-import-document-port';

describe('M3 teacher database review manifest', () => {
  it('lists additive protected collections required by grant, import, and media review ports', () => {
    const names = M3_TEACHER_DATABASE_MANIFEST.map(item => item.name);
    expect(names).toEqual([...M3_TEACHER_COLLECTION_NAMES]);
    expect(names).toContain(NATIVE_ADMIN_COLLECTIONS.grants);
    expect(names).toContain(NATIVE_ADMIN_COLLECTIONS.operations);
    expect(names).toContain(TEACHER_STUDENT_IMPORT_COLLECTIONS.studentNumbers);
    expect(names).toContain('teacher_media_records');
    expect(names).toContain('teacher_media_operations');
    expect(M3_TEACHER_DATABASE_MANIFEST.every(item => item.clientAccess === 'ADMINONLY'
      && item.indexes.some(index => index.unique))).toBe(true);
    expect(M3_TEACHER_DATABASE_MANIFEST.find(item => item.name === 'teacher_media_records')?.indexes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '_id_', unique: true }),
        expect.objectContaining({ name: 'idx_teacher_media_owner_status', unique: false }),
      ]));
    expect(M3_TEACHER_DATABASE_MANIFEST.find(item => item.name === 'teacher_media_operations')?.indexes)
      .toEqual([expect.objectContaining({ name: '_id_', unique: true })]);
  });
});
