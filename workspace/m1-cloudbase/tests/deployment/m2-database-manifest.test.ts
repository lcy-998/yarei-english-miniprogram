import { describe, expect, it } from 'vitest';
import { M1_COLLECTION_NAMES } from '../../src/deployment/database-manifest';
import { M2_COLLECTION_NAMES, M2_DATABASE_MANIFEST, compareM2DatabaseManifest } from '../../src/deployment/m2-database-manifest';
import { ACTIVITY_COLLECTIONS } from '../../src/activity/document-repository';
import { NOTIFICATION_COLLECTIONS } from '../../src/notification/document-repository';
import { PHONICS_COLLECTIONS } from '../../src/phonics/document-repository';
import { STUDENT_WORK_COLLECTIONS } from '../../src/student-work/document-repository';
import { TASK_RECORDING_COLLECTIONS } from '../../src/task-recording/document-repository';
import { TEMPLATE_COLLECTIONS } from '../../src/task-template/document-repository';
import { TEXTBOOK_COLLECTIONS } from '../../src/textbook/document-repository';
import { TEXTBOOK_ADMIN_COLLECTIONS } from '../../src/textbook/admin-service';
import { VOCABULARY_EVIDENCE_COLLECTIONS } from '../../src/vocabulary-evidence/document-repository';

describe('M2 additive database manifest', () => {
  it('keeps new collections private and separate from the accepted M1 baseline', () => {
    expect(new Set(M2_COLLECTION_NAMES).size).toBe(M2_COLLECTION_NAMES.length);
    expect(M2_COLLECTION_NAMES.some(name => (M1_COLLECTION_NAMES as readonly string[]).includes(name))).toBe(false);
    expect(M2_DATABASE_MANIFEST.map(item => item.name)).toEqual([...M2_COLLECTION_NAMES]);
    expect(M2_DATABASE_MANIFEST.every(item => item.clientAccess === 'ADMINONLY')).toBe(true);
  });

  it('covers every exported M2 repository collection outside the M1 baseline', () => {
    const referenced = [ACTIVITY_COLLECTIONS, NOTIFICATION_COLLECTIONS, PHONICS_COLLECTIONS,
      STUDENT_WORK_COLLECTIONS, TASK_RECORDING_COLLECTIONS, TEMPLATE_COLLECTIONS,
      TEXTBOOK_COLLECTIONS, TEXTBOOK_ADMIN_COLLECTIONS, VOCABULARY_EVIDENCE_COLLECTIONS]
      .flatMap(group => Object.values(group));
    const additions = referenced.filter(name => !(M1_COLLECTION_NAMES as readonly string[]).includes(name));
    expect(additions.every(name => (M2_COLLECTION_NAMES as readonly string[]).includes(name))).toBe(true);
    expect(M2_COLLECTION_NAMES).toContain('question_admin_operations');
    expect(M2_COLLECTION_NAMES).toContain('admin_task_activity_operations');
    expect(M2_COLLECTION_NAMES).toContain('maintenance_scan_state');
    expect(M2_COLLECTION_NAMES).toContain('media_retention_jobs');
  });

  it('detects missing collections, exposed client access and missing required indexes', () => {
    const observed = M2_DATABASE_MANIFEST.map(item => ({ name: item.name, clientAccess: item.clientAccess as string,
      indexes: item.indexes.map(index => ({ name: index.name, fields: index.fields, unique: index.unique })) }));
    expect(compareM2DatabaseManifest(observed)).toEqual([]);
    const first = observed[0]!;
    expect(compareM2DatabaseManifest([{ ...first, clientAccess: 'READONLY', indexes: [] }, ...observed.slice(2)]))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'CLIENT_ACCESS_MISMATCH', collection: first.name }),
        expect.objectContaining({ code: 'INDEX_MISSING', collection: first.name }),
        expect.objectContaining({ code: 'COLLECTION_MISSING', collection: observed[1]!.name }),
      ]));
  });
});
