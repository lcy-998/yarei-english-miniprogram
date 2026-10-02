import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ActivityService } from '../../src/activity/activity-service';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import { NotificationService } from '../../src/notification/service';
import { DocumentNotificationRepository } from '../../src/notification/document-repository';
import { ContentQueryService } from '../../src/org-content/content-service';
import { DocumentPhonicsRepository } from '../../src/phonics/document-repository';
import { PhonicsService } from '../../src/phonics/service';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import { M2_FIXTURE_IDS, createM2DevelopmentFixture, validateM2DevelopmentFixture,
  type M2DevelopmentFixture } from '../../src/seed/m2-development-fixture';
import { createPrimaryCloudIntegrationSeedPackage } from '../../src/seed/primary-cloud-integration-fixture';
import { DocumentTemplateRepository } from '../../src/task-template/document-repository';
import { TaskTemplateService } from '../../src/task-template/service';
import { TextbookAdminService } from '../../src/textbook/admin-service';

const teacher: TrustedActorContext = { requestId: 'request_m2_seed_teacher', sessionId: 'session_m2_seed_teacher',
  actorUserId: M2_FIXTURE_IDS.teacher, actorRole: 'teacher', organizationId: M2_FIXTURE_IDS.organization,
  platformSubjectDigest: 'digest_m2_seed_teacher', permissions: ['task.publish', 'task.read', 'content.read'],
  scopeIds: [M2_FIXTURE_IDS.class], authzVersion: 1 };
const student: TrustedActorContext = { ...teacher, requestId: 'request_m2_seed_student',
  sessionId: 'session_m2_seed_student', actorUserId: M2_FIXTURE_IDS.student, actorRole: 'student',
  permissions: ['content.read'], scopeIds: [M2_FIXTURE_IDS.student] };
const admin: TrustedActorContext = { ...teacher, requestId: 'request_m2_seed_admin',
  sessionId: 'session_m2_seed_admin', actorUserId: 'usr_admin_demo_01', actorRole: 'admin',
  permissions: ['organization.manage'], scopeIds: [M2_FIXTURE_IDS.organization] };

function database(fixture = createM2DevelopmentFixture()): FakeDocumentDatabase {
  const base = createPrimaryCloudIntegrationSeedPackage();
  const entries = [...Object.entries(base.collections), ...Object.entries(fixture.collections)];
  const grouped: Record<string, VersionedDocument[]> = {};
  for (const [name, rows] of entries) {
    grouped[name] = [...(grouped[name] ?? []), ...rows.map(row => row as unknown as VersionedDocument)];
  }
  return new FakeDocumentDatabase(grouped);
}
function changed(fixture: M2DevelopmentFixture, collection: keyof M2DevelopmentFixture['collections'],
  row: Record<string, unknown>): M2DevelopmentFixture {
  return { ...fixture, collections: { ...fixture.collections, [collection]: [row] } } as M2DevelopmentFixture;
}

describe('M2 local additive development fixture', () => {
  it('binds to the accepted fictional M1 roster and rejects hash, identity and media tampering', () => {
    const fixture = createM2DevelopmentFixture();
    expect(validateM2DevelopmentFixture(fixture)).toEqual({ ok: true, issues: [] });
    expect(fixture.manifest.expectedCounts).toEqual({ learning_resources: 2, phonics_courses: 1,
      task_templates: 1, checkin_activities: 1, notification_events: 0, notification_read_states: 0 });
    expect(validateM2DevelopmentFixture({ ...fixture,
      manifest: { ...fixture.manifest, contentHash: 'sha256:tampered' } }).issues.map(item => item.code))
      .toContain('CONTENT_HASH');
    expect(validateM2DevelopmentFixture({ ...fixture,
      manifest: { ...fixture.manifest, requiredBaseSeedRunId: 'another_run' } }).issues.map(item => item.code))
      .toContain('BASE_MISMATCH');
    const phonics = fixture.collections.phonics_courses[0]!;
    const withFakeMedia = changed(fixture, 'phonics_courses', { ...phonics,
      phonemes: [{ id: 'p', label: '/a/', examples: ['cat'], audioFileId: 'cloud://unapproved' }] });
    expect(validateM2DevelopmentFixture(withFakeMedia).issues.map(item => item.code))
      .toContain('PHONICS');
    expect(validateM2DevelopmentFixture(withFakeMedia).issues.map(item => item.code))
      .toContain('UNAUTHORIZED_VALUE');
  });

  it('opens phonics text practice but reports audio unavailable and keeps the other class out', async () => {
    const documents = database();
    const service = new PhonicsService(new DocumentPhonicsRepository(documents),
      { nowIso: () => '2026-09-27T12:30:00+08:00' }, { next: prefix => `${prefix}_m2_seed` });
    expect(await service.listCourses(student)).toMatchObject([{ id: M2_FIXTURE_IDS.phonics, questionCount: 1 }]);
    expect(await service.getCourse(student, M2_FIXTURE_IDS.phonics))
      .toMatchObject({ phonemes: [{ audioAvailable: false }] });
    expect(await service.submitAnswer(student, { courseId: M2_FIXTURE_IDS.phonics,
      questionId: 'question_m2_short_a_demo', selectedOptionId: 'option_m2_cat_demo', round: 1 },
    0, 'operation_m2_fixture_phonics_01')).toMatchObject({ isCorrect: true, firstAttempt: true });
    expect(await service.getState(student, M2_FIXTURE_IDS.phonics)).toMatchObject({ score: 100, completedCount: 1 });
    await expect(service.getCourse({ ...student, actorUserId: 'usr_student_g4_01' }, M2_FIXTURE_IDS.phonics))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('shows the fictional question and system template, while the textbook remains admin-only draft metadata', async () => {
    const documents = database();
    const content = new ContentQueryService(createOrgContentDocumentRepository(documents));
    const questions = await content.listSchoolQuestions(teacher, { grade: '三年级' }, { limit: 10, offset: 0 });
    expect(questions.items).toMatchObject([{ id: M2_FIXTURE_IDS.exercise }]);
    expect(JSON.stringify(questions)).not.toContain('correctAnswer');
    expect(await content.getSchoolQuestion(teacher, M2_FIXTURE_IDS.exercise))
      .toMatchObject({ correctAnswer: 'cat' });
    const templates = new TaskTemplateService(new DocumentTemplateRepository(documents),
      { nowIso: () => '2026-09-27T12:30:00+08:00' }, { next: prefix => `${prefix}_m2_seed` });
    expect(await templates.list(teacher)).toMatchObject([{ id: M2_FIXTURE_IDS.template, scope: 'system' }]);
    const books = await new TextbookAdminService(documents, { nowIso: () => '2026-09-27T12:30:00+08:00' })
      .overview(admin);
    expect(books.books).toMatchObject([{ id: M2_FIXTURE_IDS.textbook, status: 'draft', chapterCount: 1 }]);
    const studentCatalog = await content.listStudentCatalog(student, { type: 'reading' }, { limit: 50, offset: 0 });
    expect(studentCatalog.items.some(item => item.id === M2_FIXTURE_IDS.textbook)).toBe(false);
  });

  it('loads an activity draft and derives task notices from the legacy M1 seed without forging scheduled events', async () => {
    const documents = database();
    const activities = new ActivityService(new DocumentActivityRepository(documents),
      { nowIso: () => '2026-09-27T12:30:00+08:00' }, { next: prefix => `${prefix}_m2_seed` });
    expect(await activities.listForTeacher(teacher)).toMatchObject([{ id: M2_FIXTURE_IDS.activity,
      status: 'draft', schedule: { classId: M2_FIXTURE_IDS.class, conditions: [{ kind: 'exercise' }] } }]);
    const published = await activities.publish(teacher, M2_FIXTURE_IDS.activity, 1, 'operation_m2_fixture_publish_01');
    expect(published).toMatchObject({ status: 'published', version: 2,
      conditionSnapshots: [{ kind: 'exercise', resourceId: M2_FIXTURE_IDS.exercise,
        questionIds: [M2_FIXTURE_IDS.exercise] }] });
    expect(published.participants).toHaveLength(36);
    expect(published.dailyInstances).toHaveLength(6);
    const inbox = new NotificationService(new DocumentNotificationRepository(documents),
      { nowIso: () => '2026-09-27T12:30:00+08:00' });
    const page = await inbox.list(student, 'task', 0, 20);
    expect(page.items.some(item => item.kind === 'task_published' && item.target.id === M2_FIXTURE_IDS.baseTask))
      .toBe(true);
    expect(documents.snapshot().notification_events ?? []).toHaveLength(0);
    expect(documents.snapshot().notification_read_states ?? []).toHaveLength(0);
  });
});
