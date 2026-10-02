import type { JsonObject, JsonValue } from '../shared/protocol';
import { projectActivity } from '../activity/document-repository';
import { projectTemplate } from '../task-template/document-repository';
import { isSupportedCompletionRule, supportsExerciseSnapshot } from '../task-core/task-core-service';
import { computeJsonContentHash } from './canonical-json';
import { createPrimaryCloudIntegrationSeedPackage } from './primary-cloud-integration-fixture';
import type { SeedPackage } from './model';

/** A local-only, additive fixture. It has no CloudBase apply or rollback entry point. */
export const M2_FIXTURE_COLLECTIONS = [
  'learning_resources', 'phonics_courses', 'task_templates', 'checkin_activities',
  'notification_events', 'notification_read_states',
] as const;
export type M2FixtureCollection = (typeof M2_FIXTURE_COLLECTIONS)[number];

export const M2_FIXTURE_IDS = {
  organization: 'org_qihang_demo',
  class: 'cls_grade3_2',
  teacher: 'usr_teacher_demo_01',
  student: 'usr_student_g3_01',
  baseTask: 'tsk_animals_classroom_demo',
  exercise: 'res_m2_exercise_animals_choice_demo',
  textbook: 'res_m2_sync_book_outline_demo',
  phonics: 'phonics_m2_short_a_demo',
  template: 'template_m2_animals_choice_demo',
  activity: 'activity_m2_animals_choice_demo',
} as const;

const SEED_RUN_ID = 'seed_m2_local_addon_v1';
const GENERATED_AT = '2026-09-27T12:00:00+08:00';
const COLLECTIONS = M2_FIXTURE_COLLECTIONS;

export interface M2DevelopmentFixture {
  readonly manifest: Readonly<{
    seedVersion: 'm2-local-addon-v1';
    schemaVersion: 1;
    source: 'synthetic-m2-addon';
    seedRunId: string;
    requiredBaseSeedRunId: string;
    generatedAt: string;
    contentHash: string;
    expectedCounts: Readonly<Record<M2FixtureCollection, number>>;
  }>;
  readonly collections: Readonly<Record<M2FixtureCollection, readonly JsonObject[]>>;
}

function document(id: string, fields: JsonObject): JsonObject {
  return {
    _id: id, organizationId: M2_FIXTURE_IDS.organization, schemaVersion: 1, version: 1,
    deletedAt: null, seedRunId: SEED_RUN_ID, seedVersion: 'm2-local-addon-v1',
    createdAt: GENERATED_AT, updatedAt: GENERATED_AT, ...fields,
  };
}

export function createM2DevelopmentFixture(): M2DevelopmentFixture {
  const exercisePayload: JsonObject = {
    grade: '三年级', textbook: '演示教材目录', unit: '虚构单元 1',
    knowledgePoint: '动物词汇', difficulty: '基础', questionType: 'single_choice',
    questionIds: [M2_FIXTURE_IDS.exercise], stem: '虚构练习：哪一个英文单词表示猫？',
    options: ['cat', 'sun', 'red'], correctAnswer: 'cat',
    explanation: 'cat 是猫的英文单词。',
  };
  const exercise = document(M2_FIXTURE_IDS.exercise, {
    id: M2_FIXTURE_IDS.exercise, type: 'exercise', title: '虚构动物词汇单选题',
    contentVersion: 1, status: 'published', copyrightStatus: 'demo',
    visibility: { type: 'classes', classIds: [M2_FIXTURE_IDS.class] },
    allowedClassIds: [M2_FIXTURE_IDS.class],
    grade: exercisePayload.grade, textbook: exercisePayload.textbook, unit: exercisePayload.unit,
    knowledgePoint: exercisePayload.knowledgePoint, difficulty: exercisePayload.difficulty,
    questionType: exercisePayload.questionType, stem: exercisePayload.stem,
    options: exercisePayload.options, correctAnswer: exercisePayload.correctAnswer,
    explanation: exercisePayload.explanation, payload: exercisePayload,
  });
  const textbook = document(M2_FIXTURE_IDS.textbook, {
    id: M2_FIXTURE_IDS.textbook, type: 'reading', title: '虚构同步教材目录（仅后台摘要）',
    contentVersion: 1, status: 'draft', copyrightStatus: 'demo',
    visibility: { type: 'classes', classIds: [M2_FIXTURE_IDS.class] },
    allowedClassIds: [M2_FIXTURE_IDS.class],
    payload: {
      category: 'synchronized', grade: '三年级', term: '2026 秋季演示',
      textbook: '演示版本', difficulty: '基础',
      textbookChapters: [{ id: 'chapter_m2_outline_demo', title: '虚构单元目录',
        lessons: [{ id: 'lesson_m2_outline_demo', title: '虚构课次目录' }] }],
      chapters: [],
    },
  });
  const itemRef = {
    id: 'item_m2_animals_choice_demo', resourceId: M2_FIXTURE_IDS.exercise, order: 1,
    completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
    scoringRule: { kind: 'automatic', maxScore: 100 },
  };
  const item = {
    id: itemRef.id, resourceId: M2_FIXTURE_IDS.exercise, resourceVersion: 1,
    snapshotSchemaVersion: 1, resourceSnapshot: {
      title: '虚构动物词汇单选题', type: 'exercise', payload: exercisePayload,
    }, completionRule: itemRef.completionRule, scoringRule: itemRef.scoringRule, order: 1,
  };
  const activity = {
    id: M2_FIXTURE_IDS.activity, organizationId: M2_FIXTURE_IDS.organization,
    creatorTeacherId: M2_FIXTURE_IDS.teacher, title: '虚构动物词汇打卡草稿',
    description: '教师需在联调时检查日期、对象及条件后发布。',
    schedule: { classId: M2_FIXTURE_IDS.class, startsOn: '2026-10-01', endsOn: '2026-10-07',
      restDates: ['2026-10-04'], schoolTimeZone: 'Asia/Shanghai',
      conditions: [{ kind: 'exercise', resourceId: M2_FIXTURE_IDS.exercise, minimumScore: 60 }] },
    status: 'draft', participants: [], conditionSnapshots: [], dailyInstances: [], restDayChanges: [],
    version: 1, createdAt: GENERATED_AT, updatedAt: GENERATED_AT,
    publishedAt: null, closedAt: null,
  };
  const collections: M2DevelopmentFixture['collections'] = {
    learning_resources: [exercise, textbook],
    phonics_courses: [document(M2_FIXTURE_IDS.phonics, {
      id: M2_FIXTURE_IDS.phonics, title: '虚构短元音 a 练习', grade: '三年级', unit: '演示单元 1',
      contentVersion: 'demo-v1', status: 'published',
      visibility: { type: 'classes', classIds: [M2_FIXTURE_IDS.class] },
      phonemes: [{ id: 'phoneme_m2_short_a_demo', label: '/æ/', examples: ['cat', 'hat'], audioFileId: null }],
      questions: [{ id: 'question_m2_short_a_demo', stem: '哪个单词包含短元音 a？',
        options: [{ id: 'option_m2_cat_demo', text: 'cat' }, { id: 'option_m2_sun_demo', text: 'sun' }],
        correctOptionId: 'option_m2_cat_demo', explanation: 'cat 包含短元音 a。' }],
    })],
    task_templates: [document(M2_FIXTURE_IDS.template, {
      id: M2_FIXTURE_IDS.template, ownerTeacherId: null, scope: 'system',
      title: '虚构动物词汇练习模板', description: '仅引用一题虚构客观题。',
      itemRefs: [itemRef], items: [item], status: 'active', useCount: 0,
    })],
    checkin_activities: [document(M2_FIXTURE_IDS.activity, {
      classId: M2_FIXTURE_IDS.class, creatorTeacherId: M2_FIXTURE_IDS.teacher,
      status: 'draft', endsOn: activity.schedule.endsOn, payload: activity,
    })],
    // Published task notices are derived from the M1 base task. Scheduled notices
    // must only be produced by the trusted maintenance timer during the real flow.
    notification_events: [],
    notification_read_states: [],
  };
  const expectedCounts = Object.fromEntries(COLLECTIONS.map(name => [name, collections[name].length])) as
    Record<M2FixtureCollection, number>;
  const manifest = {
    seedVersion: 'm2-local-addon-v1' as const, schemaVersion: 1 as const,
    source: 'synthetic-m2-addon' as const, seedRunId: SEED_RUN_ID,
    requiredBaseSeedRunId: 'seed_m1_cloud_integration_v4', generatedAt: GENERATED_AT,
    contentHash: '', expectedCounts,
  };
  const contentHash = computeJsonContentHash({ manifest: omitContentHash(manifest), collections } as JsonValue);
  return { manifest: { ...manifest, contentHash }, collections };
}

export interface M2FixtureIssue { readonly code: string; readonly path: string; readonly message: string }
export interface M2FixtureValidation { readonly ok: boolean; readonly issues: readonly M2FixtureIssue[] }

/** Validates the additive package against a local copy of the accepted M1 fixture. */
export function validateM2DevelopmentFixture(
  fixture: M2DevelopmentFixture,
  base: SeedPackage = createPrimaryCloudIntegrationSeedPackage(),
): M2FixtureValidation {
  const issues: M2FixtureIssue[] = [];
  const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  const baseIds = new Set(Object.values(base.collections).flat().map(row => row._id));
  const allIds = new Set<string>();
  if (fixture.manifest.requiredBaseSeedRunId !== base.manifest.seedRunId) {
    add('BASE_MISMATCH', 'manifest.requiredBaseSeedRunId', '必须明确绑定既有 M1 主组织种子。');
  }
  const baseOrganization = base.collections.organizations.find(row => row._id === M2_FIXTURE_IDS.organization);
  const baseClass = base.collections.classes.find(row => row._id === M2_FIXTURE_IDS.class);
  const baseTeacher = base.collections.users.find(row => row._id === M2_FIXTURE_IDS.teacher);
  const baseStudent = base.collections.users.find(row => row._id === M2_FIXTURE_IDS.student);
  const baseTask = base.collections.tasks.find(row => row._id === M2_FIXTURE_IDS.baseTask);
  const baseMembership = base.collections.class_memberships.find(row => row.studentId === M2_FIXTURE_IDS.student
    && row.classId === M2_FIXTURE_IDS.class && row.status === 'active');
  const baseGrant = base.collections.teacher_class_grants.find(row => row.teacherId === M2_FIXTURE_IDS.teacher
    && row.classId === M2_FIXTURE_IDS.class && row.status === 'active'
    && Array.isArray(row.permissions) && row.permissions.includes('content.read'));
  const teacherRole = base.collections.role_assignments.find(row => row.userId === M2_FIXTURE_IDS.teacher
    && row.role === 'teacher' && row.status === 'active');
  if (!baseOrganization || baseOrganization.status !== 'active'
    || !baseClass || baseClass.status !== 'active' || baseClass.organizationId !== M2_FIXTURE_IDS.organization
    || !baseTeacher || baseTeacher.status !== 'active' || !teacherRole || !baseGrant
    || !baseStudent || baseStudent.status !== 'active' || !baseMembership
    || !baseTask || baseTask.status !== 'active') {
    add('BASE_REFERENCE', 'base.collections', '缺少已确认的虚构组织、班级、角色或通知来源任务。');
  }
  for (const name of COLLECTIONS) {
    const rows = fixture.collections[name];
    if (!Array.isArray(rows) || fixture.manifest.expectedCounts[name] !== rows.length) {
      add('COUNT_MISMATCH', `collections.${name}`, '集合数量与清单不一致。');
      continue;
    }
    rows.forEach((row, index) => {
      const path = `collections.${name}[${index}]`;
      const id = row._id;
      if (typeof id !== 'string' || !id.startsWith('res_m2_') && !id.startsWith('phonics_m2_')
        && !id.startsWith('template_m2_') && !id.startsWith('activity_m2_')) {
        add('DOCUMENT_ID', `${path}._id`, 'M2 文档须使用独立的虚构 ID。');
      } else if (allIds.has(id) || baseIds.has(id)) add('ID_COLLISION', `${path}._id`, '文档 ID 与本包或 M1 基线冲突。');
      else allIds.add(id);
      if (row.organizationId !== M2_FIXTURE_IDS.organization || row.seedRunId !== fixture.manifest.seedRunId
        || row.deletedAt !== null || row.schemaVersion !== 1 || row.version !== 1) {
        add('DOCUMENT_SCOPE', path, '组织、归属、版本或软删除字段不符合增量种子。');
      }
      if (typeof row.createdAt !== 'string' || !isOffsetIso(row.createdAt)
        || typeof row.updatedAt !== 'string' || !isOffsetIso(row.updatedAt)) {
        add('DOCUMENT_TIME', path, '创建和更新时间必须带明确时区。');
      }
      scanForbidden(row, path, add);
    });
  }
  const exercise = fixture.collections.learning_resources.find(row => row._id === M2_FIXTURE_IDS.exercise);
  const textbook = fixture.collections.learning_resources.find(row => row._id === M2_FIXTURE_IDS.textbook);
  if (!exercise || exercise.type !== 'exercise' || exercise.status !== 'published'
    || !isRecord(exercise.payload) || !Array.isArray(exercise.payload.questionIds)
    || exercise.payload.questionIds.length !== 1 || exercise.payload.questionIds[0] !== exercise._id
    || exercise.payload.correctAnswer === undefined || !classVisible(exercise)
    || !Array.isArray(exercise.allowedClassIds) || !exercise.allowedClassIds.includes(M2_FIXTURE_IDS.class)
    || exercise.grade !== exercise.payload.grade || exercise.questionType !== exercise.payload.questionType
    || exercise.stem !== exercise.payload.stem || exercise.explanation !== exercise.payload.explanation
    || JSON.stringify(exercise.options) !== JSON.stringify(exercise.payload.options)
    || JSON.stringify(exercise.correctAnswer) !== JSON.stringify(exercise.payload.correctAnswer)) {
    add('EXERCISE', 'collections.learning_resources', '虚构习题必须可由本班引用并有完整单题快照。');
  }
  if (!textbook || textbook.type !== 'reading' || textbook.status !== 'draft'
    || !isRecord(textbook.payload) || textbook.payload.category !== 'synchronized'
    || !Array.isArray(textbook.payload.chapters) || textbook.payload.chapters.length !== 0) {
    add('TEXTBOOK_BOUNDARY', 'collections.learning_resources', '无授权页图的教材只能保留草稿目录摘要。');
  }
  const phonics = fixture.collections.phonics_courses[0];
  if (!phonics || phonics.status !== 'published' || !classVisible(phonics)
    || !Array.isArray(phonics.phonemes) || !phonics.phonemes.length
    || phonics.phonemes.some(item => !isRecord(item) || item.audioFileId !== null)
    || !Array.isArray(phonics.questions) || !phonics.questions.length
    || phonics.questions.some(question => !isRecord(question) || !Array.isArray(question.options)
      || !question.options.some(option => isRecord(option) && option.id === question.correctOptionId))) {
    add('PHONICS', 'collections.phonics_courses', '拼读目录须有虚构题且音频保持未接入。');
  }
  const template = fixture.collections.task_templates[0];
  const projectedTemplate = projectTemplate(template);
  if (!template || !exercise || !projectedTemplate || template.scope !== 'system' || template.ownerTeacherId !== null
    || !Array.isArray(template.itemRefs) || template.itemRefs.length !== 1
    || !isRecord(template.itemRefs[0]) || template.itemRefs[0].resourceId !== M2_FIXTURE_IDS.exercise
    || !Array.isArray(template.items) || template.items.length !== 1
    || !isRecord(template.items[0]) || template.items[0].resourceId !== M2_FIXTURE_IDS.exercise
    || !isRecord(template.items[0].resourceSnapshot)
    || JSON.stringify(template.items[0].resourceSnapshot.payload) !== JSON.stringify(exercise?.payload)
    || !isRecord(template.itemRefs[0].completionRule)
    || !isSupportedCompletionRule('exercise', template.itemRefs[0].completionRule as JsonObject)
    || !supportsExerciseSnapshot({ id: M2_FIXTURE_IDS.exercise, type: 'exercise',
      payload: exercise?.payload as JsonObject }, template.itemRefs[0].completionRule as JsonObject)) {
    add('TEMPLATE_REFERENCE', 'collections.task_templates', '系统模板须仅冻结本包中已上架的虚构习题。');
  }
  const activity = fixture.collections.checkin_activities[0];
  const payload = activity?.payload;
  if (!activity || activity.status !== 'draft' || activity.classId !== M2_FIXTURE_IDS.class
    || !projectActivity(payload) || !isRecord(payload) || payload.status !== 'draft' || !isRecord(payload.schedule)
    || payload.schedule.classId !== M2_FIXTURE_IDS.class
    || !Array.isArray(payload.schedule.conditions) || payload.schedule.conditions.length !== 1
    || !isRecord(payload.schedule.conditions[0])
    || payload.schedule.conditions[0].resourceId !== M2_FIXTURE_IDS.exercise
    || !Array.isArray(payload.participants) || payload.participants.length !== 0) {
    add('ACTIVITY_DRAFT', 'collections.checkin_activities', '活动应是待教师确认后发布的单班虚构草稿。');
  }
  if (fixture.collections.notification_events.length || fixture.collections.notification_read_states.length) {
    add('NOTIFICATION_BOUNDARY', 'collections.notification_events', '通知与已读状态必须由实际业务事件生成。');
  }
  const contentHash = computeJsonContentHash({ manifest: omitContentHash(fixture.manifest),
    collections: fixture.collections } as JsonValue);
  if (contentHash !== fixture.manifest.contentHash) {
    add('CONTENT_HASH', 'manifest.contentHash', '规范化内容摘要不匹配。');
  }
  return { ok: issues.length === 0, issues };
}

function omitContentHash(manifest: M2DevelopmentFixture['manifest']): JsonObject {
  const { contentHash: _ignored, ...other } = manifest;
  return other as unknown as JsonObject;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function classVisible(row: JsonObject): boolean {
  return isRecord(row.visibility) && row.visibility.type === 'classes'
    && Array.isArray(row.visibility.classIds) && row.visibility.classIds.includes(M2_FIXTURE_IDS.class);
}
function isOffsetIso(value: string): boolean {
  return /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function scanForbidden(value: unknown, path: string,
  add: (code: string, path: string, message: string) => void): void {
  if (typeof value === 'string') {
    if (/(?:cloud:\/\/|https?:\/\/|\b1[3-9]\d{9}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(value)) {
      add('UNAUTHORIZED_VALUE', path, '种子不得包含媒体地址、外部链接或疑似真实联系方式。');
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => scanForbidden(item, `${path}[${index}]`, add)); return; }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:password|secret|token|appsecret|mobile|email|openid|assetkey)/i.test(key)
      || /^(?:phone|phoneNumber|uid|fileId)$/i.test(key)
      && key !== 'audioFileId') add('SENSITIVE_FIELD', `${path}.${key}`, '种子包含禁止字段。');
    scanForbidden(child, `${path}.${key}`, add);
  }
}
