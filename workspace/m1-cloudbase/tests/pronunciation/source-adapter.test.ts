import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { DocumentPronunciationSource } from '../../src/pronunciation/source-adapter';
import type { LearningProgressRepository } from '../../src/learning-progress/repository';
import type { IdentityRepository } from '../../src/runtime/ports';
import type { TaskQueryRepository } from '../../src/task-query/repository';
import type { DocumentDatabasePort, VersionedDocument } from '../../src/repositories/document-database-port';
import type { PronunciationRecording } from '../../src/pronunciation/types';

const student: TrustedActorContext = {
  requestId: 'request_student_virtual_01',
  sessionId: 'session_student_virtual_01',
  actorUserId: 'student_virtual_01',
  actorRole: 'student',
  organizationId: 'org_virtual_01',
  platformSubjectDigest: 'a'.repeat(64),
  permissions: ['learning.read'],
  scopeIds: ['class_virtual_01'],
  authzVersion: 1,
};

function createSource(resource: VersionedDocument): DocumentPronunciationSource {
  const learning = {
    async findResource() {
      return { id: 'resource_virtual_01', organizationId: student.organizationId,
        type: 'reading' as const, status: 'published' as const, contentVersion: '1',
        allowedStudentIds: [student.actorUserId], pages: [], wordIds: [] };
    },
  } as unknown as LearningProgressRepository;
  const documents = { async get(_collection: string, id: string) {
    return id === resource._id ? resource : null;
  } } as unknown as DocumentDatabasePort;
  return new DocumentPronunciationSource({} as TaskQueryRepository, learning, documents,
    {} as IdentityRepository, { nowIso: () => '2026-10-08T12:00:00.000Z' });
}

describe('DocumentPronunciationSource', () => {
  it('resolves an approved reading segment stored in the resource payload', async () => {
    const resource: VersionedDocument = {
      _id: 'resource_virtual_01', organizationId: student.organizationId,
      schemaVersion: 1, version: 7, deletedAt: null, status: 'published',
      copyrightStatus: 'verified', contentVersion: 1, title: 'Virtual reading sample',
      payload: { pronunciation: { reviewStatus: 'approved', sourceVersion: '1',
        approvedAt: '2026-10-01T12:00:00.000Z', approvedBy: 'reviewer_virtual_01',
        segments: [{ id: 'segment_virtual_01', text: 'A short sample sentence.',
          demonstrationAudioAssetKey: 'cloud://environment/reading/sample.mp3' }] } },
    };
    const resolved = await createSource(resource).resolve(student,
      { kind: 'reading', resourceId: 'resource_virtual_01', segmentId: 'segment_virtual_01' }, true);

    expect(resolved).toMatchObject({ kind: 'reading', resourceId: resource._id,
      segmentId: 'segment_virtual_01', sourceVersion: '1', referenceText: 'A short sample sentence.' });

    const recording = { id: 'recording_virtual_01', organizationId: student.organizationId,
      studentId: student.actorUserId, source: resolved, mediaDeletedAt: null };
    await expect(createSource(resource).currentForScoring(student,
      recording as unknown as PronunciationRecording)).resolves.toBe(true);
  });

  it('rejects a payload whose approved source version does not match the published resource', async () => {
    const resource: VersionedDocument = {
      _id: 'resource_virtual_01', organizationId: student.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, status: 'published',
      copyrightStatus: 'verified', contentVersion: 2, title: 'Virtual reading sample',
      payload: { pronunciation: { reviewStatus: 'approved', sourceVersion: '1',
        approvedAt: '2026-10-01T12:00:00.000Z', approvedBy: 'reviewer_virtual_01',
        segments: [{ id: 'segment_virtual_01', text: 'A short sample sentence.',
          demonstrationAudioAssetKey: 'cloud://environment/reading/sample.mp3' }] } },
    };

    await expect(createSource(resource).resolve(student,
      { kind: 'reading', resourceId: 'resource_virtual_01', segmentId: 'segment_virtual_01' }, true))
      .rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
  });
});
