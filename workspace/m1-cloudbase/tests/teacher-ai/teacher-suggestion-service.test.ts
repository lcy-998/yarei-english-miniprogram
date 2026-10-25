import { describe, expect, it } from 'vitest';
import { TeacherSuggestionService } from '../../src/teacher-ai/service';
import { automaticSuggestionOperationId } from '../../src/teacher-ai/automatic-job';
import { safeTeacherSuggestionText } from '../../src/teacher-ai/safety';
import type { TeacherSuggestionRecord, TeacherSuggestionStore } from '../../src/teacher-ai/types';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { ReviewQueryService } from '../../src/task-query/service';
import type { TaskQueryRepository } from '../../src/task-query/repository';
import type { ReviewSubmissionView } from '../../src/task-query/types';

const actor: TrustedActorContext = {
  requestId: 'req_demo', sessionId: 'ses_demo', actorUserId: 'teacher_demo', actorRole: 'teacher',
  organizationId: 'org_demo', platformSubjectDigest: 'digest_demo', permissions: ['submission.review'],
  scopeIds: ['class_demo'], authzVersion: 1,
};

type HistoryRow = Readonly<{ score: number; classId?: string; submittedAt: string;
  decision?: 'approved' | 'returned' }>;

function fixture(onGenerate?: () => void, generatedText?: string,
  correctness: boolean | null = false, historyRows: readonly HistoryRow[] = [],
  withCorrectWord = false) {
  let authorized = true;
  let latestSubmissionId = 'sub_demo';
  let assignmentVersion = 3;
  let inferenceCalls = 0;
  let suggestionSequence = 0;
  let lastFacts: readonly { id: string; text: string }[] = [];
  const rows = new Map<string, TeacherSuggestionRecord>();
  const rowsById = new Map<string, TeacherSuggestionRecord>();
  const generationCounts = new Map<string, number>();
  const audit: string[] = [];
  const evidence = {
    taskId: 'task_demo', assignmentId: 'assignment_demo', assignmentVersion: 3,
    studentId: 'student_demo', classId: 'class_demo', submittedAt: '2026-10-02T07:00:00+08:00',
    submissionId: 'sub_demo', submissionVersion: 2, taskItems: [
      { id: 'item_demo', title: '测试学生姓名不能进入模型', type: 'exercise', order: 1 },
    ], answers: [{ itemId: 'item_demo' }], exerciseEvidence: [
      { itemId: 'item_demo', questionId: 'question_demo', questionType: 'single_choice',
        stem: 'Which animal has a long neck?', options: ['giraffe', 'cat'],
        studentResponse: 'cat', correctAnswer: 'giraffe', explanation: '',
        isCorrect: correctness, recorded: true },
    ], vocabularyEvidence: withCorrectWord ? [{ itemId: 'word_demo', wordId: 'word_giraffe',
      targetWord: 'giraffe', attempts: [{ studentInput: 'giraffe', isCorrect: true,
        firstAttempt: true, attemptNumber: 1, attemptedAt: '2026-10-02T06:00:00+08:00' }], firstCorrect: true }] : [], isLate: false,
    scoringItems: [{ itemId: 'item_demo', teacherScoreRequired: correctness === null }],
  } as unknown as ReviewSubmissionView;
  const query = {
    async getSubmissionForReview() {
      return authorized ? { ok: true, data: evidence } : { ok: false, error: { code: 'FORBIDDEN' } };
    },
  } as unknown as ReviewQueryService;
  const repository = {
    async findAssignmentById() { return { latestSubmissionId, version: assignmentVersion }; },
    async findTask() { return { creatorTeacherId: actor.actorUserId }; },
    async listStudentAssignments() { return historyRows.map((row, index) => ({
      id: `assignment_prior_${index}`, organizationId: 'org_demo',
      taskId: `task_prior_${index}`, studentId: 'student_demo',
      classId: row.classId ?? 'class_demo', status: 'completed',
      latestSubmissionId: `submission_prior_${index}`, submittedAt: row.submittedAt,
    })); },
    async findFeedback(_organizationId: string, submissionId: string) {
      const index = Number(submissionId.match(/_(\d+)$/u)?.[1] ?? -1);
      const row = historyRows[index];
      return row ? { assignmentId: `assignment_prior_${index}`, taskId: `task_prior_${index}`,
        submissionId, decision: row.decision ?? 'approved', score: row.score,
        publishedAt: row.submittedAt } : null;
    },
  } as unknown as TaskQueryRepository;
  const store: TeacherSuggestionStore = {
    async find(_organizationId, teacherId, operationId) { return rows.get(`${teacherId}:${operationId}`) ?? null; },
    async reserve(record) {
      const key = `${record.teacherId}:${record.operationId}`;
      const existing = rows.get(key);
      if (existing) return { kind: 'existing', record: existing };
      const counterKey = `${record.organizationId}:${record.teacherId}:${record.submissionId}:${record.submissionVersion}`;
      const next = (generationCounts.get(counterKey) ?? 0) + 1;
      if (next > 4) return { kind: 'limit' };
      generationCounts.set(counterKey, next);
      const reserved = { ...record, generationNumber: next, version: 1 };
      rows.set(key, reserved);
      rowsById.set(record.id, reserved);
      return { kind: 'reserved', record: reserved };
    },
    async complete(recordId, expectedVersion, text, citedFactIds, completedAt) {
      const existing = rowsById.get(recordId);
      if (!existing || existing.status !== 'processing' || existing.version !== expectedVersion) return null;
      const completed = { ...existing, status: 'trial' as const, text, citedFactIds: [...citedFactIds],
        failureReason: null, version: existing.version + 1, createdAt: completedAt };
      rows.set(`${existing.teacherId}:${existing.operationId}`, completed);
      rowsById.set(recordId, completed);
      return completed;
    },
    async fail(recordId, expectedVersion, reason) {
      const existing = rowsById.get(recordId);
      if (!existing || existing.status !== 'processing' || existing.version !== expectedVersion) return false;
      const failed = { ...existing, status: 'failed' as const, failureReason: reason,
        version: existing.version + 1 };
      rows.set(`${existing.teacherId}:${existing.operationId}`, failed);
      rowsById.set(recordId, failed);
      return true;
    },
    async findById(_organizationId, _teacherId, suggestionId) {
      return rowsById.get(suggestionId) ?? null;
    },
    async appendAudit(entry) { audit.push(`${entry.outcome}:${entry.reason}`); },
  };
  const generated = '你这次把长颈鹿选成了“cat”，我们再一起记住“giraffe”是长颈鹿吧。下次看到“long neck”时，先想想哪种动物有长脖子，再对照单词作答。愿意尝试就是很好的开始，我们把这类动物词再练一练，你会越来越熟悉。';
  const inference = {
    async generate(input: { operationId: string; facts: readonly { id: string; text: string }[] }) {
      inferenceCalls += 1;
      lastFacts = input.facts;
      expect(JSON.stringify(input)).not.toContain('测试学生姓名');
      onGenerate?.();
      return { text: generatedText ?? generated, citedFactIds: ['question_1'] };
    },
  };
  const service = new TeacherSuggestionService(query, repository, inference, store,
    { nowIso: () => '2026-10-02T08:00:00+08:00' },
    { next: prefix => `${prefix}_${++suggestionSequence}` }, 'qwen3-0.6b-q4_0', 'teacher-v1');
  return { service, audit, evidence, get inferenceCalls() { return inferenceCalls; },
    get lastFacts() { return lastFacts; },
    revoke: () => { authorized = false; },
    advance: () => { latestSubmissionId = 'sub_new'; assignmentVersion += 1; } };
}

describe('teacher suggestion trial boundary', () => {
  it('accepts student-facing, concrete action wording without weakening other safety gates', () => {
    expect(safeTeacherSuggestionText(
      '你把这个单词写得很清楚。再圈出容易漏掉的字母，对照示范拼写逐字写一遍，再读出这个词，帮助记住它的拼法。'))
      .toBe(true);
  });

  it('uses authorized current evidence, omits names and only returns a teacher-confirmed trial suggestion', async () => {
    const state = fixture();
    const first = await state.service.generate(actor, 'sub_demo', 'op_demo');
    expect(first).toMatchObject({ ok: true, value: { status: 'trial', requiresTeacherConfirmation: true,
      submissionVersion: 2, generationNumber: 1, remainingRegenerations: 3 } });
    const replay = await state.service.generate(actor, 'sub_demo', 'op_demo');
    expect(replay).toEqual(first);
    expect(state.inferenceCalls).toBe(1);
    expect(state.lastFacts).toContainEqual({ id: 'question_1',
      text: '判定错误的单选题；题干“Which animal has a long neck?”；学生作答“cat”；参考答案“giraffe”。' });
    expect(state.lastFacts).toHaveLength(1);
    expect(first.ok && first.value.status === 'trial' ? first.value.text : '').toContain('cat');
    expect(first.ok && first.value.status === 'trial' ? first.value.text : '').not.toMatch(/教师可|正式提交|分数/u);
    expect(state.audit).toContain('replayed:same_version');
    expect(await state.service.get(actor, 'sub_demo', 'op_demo')).toEqual(first);
  });

  it('does not ask the model to invent feedback when only pending manual evidence exists', async () => {
    const state = fixture(undefined, undefined, null);
    expect(await state.service.generate(actor, 'sub_demo', 'op_pending_quality'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.inferenceCalls).toBe(0);
    expect(await state.service.get(actor, 'sub_demo', 'op_pending_quality'))
      .toEqual({ ok: true, value: { status: 'insufficient_evidence' } });
  });

  it('does not include historical scores or unrelated facts in model input', async () => {
    const history: HistoryRow[] = [
      { score: 73, submittedAt: '2026-09-27T07:00:00+08:00' },
      { score: 81, submittedAt: '2026-09-28T07:00:00+08:00' },
      { score: 86, submittedAt: '2026-09-29T07:00:00+08:00' },
      { score: 99, classId: 'class_other', submittedAt: '2026-09-30T07:00:00+08:00' },
      { score: 95, decision: 'returned', submittedAt: '2026-10-01T07:00:00+08:00' },
    ];
    const state = fixture(undefined, undefined, false, history);
    expect((await state.service.generate(actor, 'sub_demo', 'op_history_safe')).ok).toBe(true);
    expect(JSON.stringify(state.lastFacts)).not.toMatch(/此前|分数|class_other|\b73\b|\b81\b|\b86\b/u);
  });

  it('rejects invented history and unsupported improvement claims', async () => {
    const invented = fixture(undefined,
      '本次作业比上次进步明显，已能熟练完成所有题目。教师可参考此前几次成绩继续安排同类练习，并给予更多积极鼓励。');
    expect(await invented.service.generate(actor, 'sub_demo', 'op_invented_history'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  it('does not use historical scores to fill gaps in current-task evidence', async () => {
    const state = fixture(undefined,
      '本次作业已提交，一道习题还需教师核对后才能判断质量。教师可参考此前的正式评分，请学生说明作答理由并安排练习。',
      null, [{ score: 82, submittedAt: '2026-09-30T07:00:00+08:00' }]);
    expect(await state.service.generate(actor, 'sub_demo', 'op_history_band_missing'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.inferenceCalls).toBe(0);
    expect(state.lastFacts).toEqual([]);
  });

  it('keeps historical scores out of a current-task suggestion', async () => {
    const history: HistoryRow[] = [
      { score: 97, submittedAt: '2026-09-27T07:00:00+08:00' },
      { score: 93, submittedAt: '2026-09-28T07:00:00+08:00' },
      { score: 42, submittedAt: '2026-09-29T07:00:00+08:00' },
    ];
    const state = fixture(undefined, undefined, false, history);
    const result = await state.service.generate(actor, 'sub_demo', 'op_structured_pending');
    expect(result).toMatchObject({ ok: true, value: { status: 'trial',
      requiresTeacherConfirmation: true } });
    if (!result.ok) throw new Error('suggestion expected');
    expect(result.value.text).not.toMatch(/六十分以下|九十分以上|此前|分数/u);
    expect(state.lastFacts.every(fact => !/此前|分数/u.test(fact.text))).toBe(true);
    expect(state.inferenceCalls).toBe(1);
  });

  it('describes a mixed objective result and avoids invented subjective grading', async () => {
    const history: HistoryRow[] = [
      { score: 76, submittedAt: '2026-09-29T07:00:00+08:00' },
      { score: 84, submittedAt: '2026-09-30T07:00:00+08:00' },
    ];
    const state = fixture(undefined, undefined, false, history, true);
    const result = await state.service.generate(actor, 'sub_demo', 'op_structured_mixed');
    if (!result.ok) throw new Error(JSON.stringify({ result, audit: state.audit }));
    expect(result.value.text).toContain('cat');
    expect(result.value.text).not.toContain('分数');
    expect(result.value.text).not.toContain('主观题');
  });

  it('does not mention historical scores when no eligible formal score exists', async () => {
    const state = fixture(undefined, undefined, false, []);
    const result = await state.service.generate(actor, 'sub_demo', 'op_structured_no_history');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('suggestion expected');
    expect(result.value.text).not.toMatch(/此前|分数|七十|八十|九十/u);
  });

  it('withholds an awkward claim that there are no correct or incorrect answers', async () => {
    const state = fixture(undefined,
      '本次习题已记录作答，服务端判定无错误与正确，需教师核对。教师可核对相关题目以确认准确性，协助完成评分任务。', null);
    expect(await state.service.generate(actor, 'sub_demo', 'op_awkward_pending'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  it('returns only safe status for an ineligible or failed polling request', async () => {
    const state = fixture(() => { throw new Error('model failed'); });
    expect(await state.service.get(actor, 'sub_demo', 'unknown_operation'))
      .toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await state.service.generate(actor, 'sub_demo', 'op_failed'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(await state.service.get(actor, 'sub_demo', 'op_failed'))
      .toEqual({ ok: true, value: { status: 'failed' } });
    state.revoke();
    expect(await state.service.get(actor, 'sub_demo', 'op_failed'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('finds a submission-triggered suggestion by its stable operation after the teacher opens review', async () => {
    const state = fixture();
    expect(await state.service.getAutomatic(actor, 'sub_demo'))
      .toEqual({ ok: true, value: { status: 'not_started' } });
    const operationId = automaticSuggestionOperationId({ organizationId: 'org_demo', submissionId: 'sub_demo' });
    expect((await state.service.generate(actor, 'sub_demo', operationId)).ok).toBe(true);
    expect(await state.service.getAutomatic(actor, 'sub_demo'))
      .toMatchObject({ ok: true, value: { status: 'trial', generationNumber: 1 } });
    state.revoke();
    expect(await state.service.getAutomatic(actor, 'sub_demo')).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('gives another currently authorized reviewing teacher an idempotent copy for formal publishing', async () => {
    const state = fixture();
    const operationId = automaticSuggestionOperationId({ organizationId: 'org_demo', submissionId: 'sub_demo' });
    const original = await state.service.generate(actor, 'sub_demo', operationId);
    const colleague = { ...actor, actorUserId: 'teacher_colleague' };
    const first = await state.service.getAutomatic(colleague, 'sub_demo');
    const replay = await state.service.getAutomatic(colleague, 'sub_demo');
    expect(first).toMatchObject({ ok: true, value: { status: 'trial', generationNumber: 1 } });
    expect(replay).toEqual(first);
    if (!original.ok || !first.ok || first.value.status !== 'trial') throw new Error('suggestions expected');
    expect(first.value.id).not.toBe(original.value.id);
    expect(first.value.text).toBe(original.value.text);
    expect(state.inferenceCalls).toBe(1);
  });

  it('withholds suggestions that expose internal fact identifiers', async () => {
    const state = fixture(undefined,
      '请检查本次习题记录并针对错题安排复习。事实 ID：task_items；建议教师结合学生实际作答再调整语气和练习内容。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_internal_fact'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('withholds suggestions that cite a task item absent from the submission', async () => {
    const state = fixture(undefined,
      '第2项任务已经完成得很好，请继续保持。教师可以围绕本次习题的实际错题提问，让学生解释思路，再安排一次针对性的练习。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_missing_item'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('withholds Chinese numbered item claims, which are unnecessary in a teacher suggestion', async () => {
    const state = fixture(undefined,
      '第二项习题已经完成，建议教师结合本次作答核对细节，并请学生解释解题思路后再做一次有针对性的练习。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_chinese_item'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('withholds unnatural spacing between Chinese characters', async () => {
    const state = fixture(undefined,
      '本 次 习 题 已 记 录 作 答，教师可 引导学生核对这道题的思路，并安排同类练习观察后续表现。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_spaced_text'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('withholds ungrounded claims that all work passed or performance was good', async () => {
    const state = fixture(undefined,
      '本次提交均通过考核完成，表现良好。教师可继续安排同类练习，并核对后续作答内容是否准确无误。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_ungrounded_praise'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('withholds generic text appended to a short model response', async () => {
    const state = fixture(undefined,
      '请检查习题。教师可结合本次作答再核对细节，选择适合的练习方式；发布前请按学生实际表现调整措辞，确保建议符合本次作答。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_generic_padding'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('withholds a fact recital that gives the teacher no next step', async () => {
    const state = fixture(undefined,
      '本次提交共有一项习题，服务端记录了学生的答案，其中一题判定错误。提交记录已经保存，教师可以在页面查看这些作答数据。');
    expect(await state.service.generate(actor, 'sub_demo', 'op_fact_recital'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(state.audit).toContain('rejected:unsafe_output');
  });

  it('rejects revoked teachers even when an operation was previously saved', async () => {
    const state = fixture();
    await state.service.generate(actor, 'sub_demo', 'op_demo');
    state.revoke();
    expect(await state.service.generate(actor, 'sub_demo', 'op_demo')).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('rejects a newer submission after inference, without persisting the stale result', async () => {
    const state = fixture();
    state.advance();
    expect(await state.service.generate(actor, 'sub_demo', 'op_demo')).toEqual({ ok: false, code: 'CONFLICT' });
    expect(state.inferenceCalls).toBe(0);
  });

  it('rechecks authorization after slow inference before saving any suggestion', async () => {
    let revoke = () => {};
    const state = fixture(() => revoke());
    revoke = state.revoke;
    expect(await state.service.generate(actor, 'sub_demo', 'op_slow'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(state.audit).toContain('rejected:authorization_or_version_changed');
  });

  it('rejects client roles without review permission before reading evidence', async () => {
    const state = fixture();
    expect(await state.service.generate({ ...actor, actorRole: 'student' }, 'sub_demo', 'op_demo'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(state.inferenceCalls).toBe(0);
  });

  it('reserves generation attempts before inference and caps one submission at an initial plus three regenerations', async () => {
    const state = fixture();
    for (let generation = 0; generation < 4; generation += 1) {
      const result = await state.service.generate(actor, 'sub_demo', `op_demo_${generation}`);
      expect(result).toMatchObject({ ok: true, value: { generationNumber: generation + 1,
        remainingRegenerations: 3 - generation } });
    }
    const limited = await state.service.generate(actor, 'sub_demo', 'op_demo_limited');
    expect(limited).toEqual({ ok: false, code: 'CONFLICT' });
    expect(state.inferenceCalls).toBe(4);
  });
});
