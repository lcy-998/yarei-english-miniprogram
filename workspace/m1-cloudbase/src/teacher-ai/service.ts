import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { TaskQueryRepository } from '../task-query/repository';
import type { ReviewQueryService } from '../task-query/service';
import type { ReviewSubmissionView } from '../task-query/types';
import type {
  TeacherSuggestionFact, TeacherSuggestionInferencePort, TeacherSuggestionRecord,
  TeacherSuggestionStore, TeacherSuggestionView,
} from './types';
import { safeTeacherSuggestionText } from './safety';
import { automaticSuggestionOperationId } from './automatic-job';

export type TeacherSuggestionResult =
  | Readonly<{ ok: true; value: TeacherSuggestionView }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE' }>;
export type TeacherSuggestionPollResult =
  | Readonly<{ ok: true; value: TeacherSuggestionView | Readonly<{ status: 'processing' | 'failed' | 'insufficient_evidence' | 'not_started' }> }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE' }>;

export interface TeacherSuggestionClock { nowIso(): string }
export interface TeacherSuggestionIds { next(prefix: string): string }

/** Suggestion text stays a trial until an authorized teacher publishes feedback. */
export class TeacherSuggestionService {
  public constructor(
    private readonly reviewQuery: ReviewQueryService,
    private readonly taskRepository: TaskQueryRepository,
    private readonly inference: TeacherSuggestionInferencePort,
    private readonly store: TeacherSuggestionStore,
    private readonly clock: TeacherSuggestionClock,
    private readonly ids: TeacherSuggestionIds,
    private readonly modelVersion: string,
    private readonly promptVersion: string,
  ) {}

  public async generate(
    actor: TrustedActorContext,
    submissionId: string,
    operationId: string,
  ): Promise<TeacherSuggestionResult> {
    if (!validId(submissionId) || !validId(operationId)) return { ok: false, code: 'VALIDATION_ERROR' };
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('submission.review')) {
      await this.audit(actor, submissionId, operationId, 'rejected', 'forbidden_actor');
      return { ok: false, code: 'FORBIDDEN' };
    }
    // The existing review query checks the current teacher grant, organization, class,
    // submission ownership and frozen task snapshot on every request, including replay.
    const evidence = await this.reviewQuery.getSubmissionForReview(actor, submissionId);
    if (!evidence.ok) {
      await this.audit(actor, submissionId, operationId, 'rejected', 'evidence_unavailable');
      return { ok: false, code: evidence.error.code === 'FORBIDDEN' ? 'FORBIDDEN'
        : evidence.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE' };
    }
    const review = evidence.data;
    const assignment = await this.taskRepository.findAssignmentById(actor.organizationId, review.assignmentId);
    if (assignment === null || assignment.latestSubmissionId !== submissionId
      || assignment.version !== review.assignmentVersion) return { ok: false, code: 'CONFLICT' };
    const facts = projectFacts(review);
    const digest = evidenceDigest(review, facts);
    const existing = await this.store.find(actor.organizationId, actor.actorUserId, operationId);
    if (existing !== null) {
      if (existing.submissionId !== submissionId || existing.submissionVersion !== review.submissionVersion
        || existing.assignmentVersion !== assignment.version || existing.evidenceDigest !== digest
        || existing.modelVersion !== this.modelVersion || existing.promptVersion !== this.promptVersion) {
        await this.audit(actor, submissionId, operationId, 'rejected', 'operation_conflict');
        return { ok: false, code: 'CONFLICT' };
      }
      if (existing.status === 'trial') {
        if (existing.text === null || !safeTeacherSuggestionText(existing.text)) {
          return { ok: false, code: 'SERVICE_UNAVAILABLE' };
        }
        await this.audit(actor, submissionId, operationId, 'replayed', 'same_version');
        return { ok: true, value: view(existing) };
      }
      await this.audit(actor, submissionId, operationId, 'rejected',
        existing.status === 'processing' ? 'operation_in_progress' : 'operation_failed');
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    const reserved = await this.store.reserve({
      id: this.ids.next('suggestion'), organizationId: actor.organizationId,
      teacherId: actor.actorUserId, taskId: review.taskId, submissionId,
      submissionVersion: review.submissionVersion, assignmentVersion: assignment.version,
      operationId, evidenceDigest: digest, modelVersion: this.modelVersion,
      promptVersion: this.promptVersion, text: null, citedFactIds: [], status: 'processing',
      failureReason: null, createdAt: this.clock.nowIso(),
    });
    if (reserved.kind === 'limit') {
      await this.audit(actor, submissionId, operationId, 'rejected', 'generation_limit');
      return { ok: false, code: 'CONFLICT' };
    }
    if (reserved.kind === 'existing') {
      const record = reserved.record;
      if (record.submissionId !== submissionId || record.submissionVersion !== review.submissionVersion
        || record.assignmentVersion !== assignment.version || record.evidenceDigest !== digest
        || record.modelVersion !== this.modelVersion || record.promptVersion !== this.promptVersion) {
        await this.audit(actor, submissionId, operationId, 'rejected', 'operation_conflict');
        return { ok: false, code: 'CONFLICT' };
      }
      if (record.status === 'trial') {
        if (record.text === null || !safeTeacherSuggestionText(record.text)) {
          return { ok: false, code: 'SERVICE_UNAVAILABLE' };
        }
        await this.audit(actor, submissionId, operationId, 'replayed', 'same_version');
        return { ok: true, value: view(record) };
      }
      await this.audit(actor, submissionId, operationId, 'rejected',
        record.status === 'processing' ? 'operation_in_progress' : 'operation_failed');
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    const reservation = reserved.record;
    if (facts.length === 0) {
      await this.store.fail(reservation.id, reservation.version, 'insufficient_evidence');
      await this.audit(actor, submissionId, operationId, 'rejected', 'insufficient_evidence');
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    let output;
    try {
      output = await this.inference.generate({ operationId, facts,
        modelVersion: this.modelVersion, promptVersion: this.promptVersion });
    } catch (_error: unknown) {
      await this.store.fail(reservation.id, reservation.version, 'inference_failed');
      await this.audit(actor, submissionId, operationId, 'rejected', 'inference_failed');
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    const text = output.text;
    const citedFactIds = output.citedFactIds;
    if (!text.trim() && citedFactIds.length === 0) {
      await this.store.fail(reservation.id, reservation.version, 'insufficient_evidence');
      await this.audit(actor, submissionId, operationId, 'rejected', 'insufficient_evidence');
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    if (!validOutput(text, citedFactIds, facts, review)) {
      await this.store.fail(reservation.id, reservation.version, 'unsafe_output');
      await this.audit(actor, submissionId, operationId, 'rejected', 'unsafe_output');
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    // Recheck the grant and current submission after inference. Slow model work may
    // outlive a teacher revocation or a student's newer submission.
    const current = await this.reviewQuery.getSubmissionForReview(actor, submissionId);
    const currentAssignment = await this.taskRepository.findAssignmentById(actor.organizationId, review.assignmentId);
    if (!current.ok || currentAssignment === null || currentAssignment.latestSubmissionId !== submissionId
      || currentAssignment.version !== assignment.version
      || evidenceDigest(current.data, projectFacts(current.data)) !== digest) {
      await this.store.fail(reservation.id, reservation.version, 'authorization_or_version_changed');
      await this.audit(actor, submissionId, operationId, 'rejected', 'authorization_or_version_changed');
      return { ok: false, code: !current.ok && current.error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'CONFLICT' };
    }
    const saved = await this.store.complete(reservation.id, reservation.version,
      text.trim(), [...citedFactIds], this.clock.nowIso());
    if (saved === null) return { ok: false, code: 'CONFLICT' };
    if (saved.evidenceDigest !== digest || saved.submissionId !== submissionId
      || saved.modelVersion !== this.modelVersion || saved.promptVersion !== this.promptVersion
      || saved.assignmentVersion !== assignment.version) return { ok: false, code: 'CONFLICT' };
    await this.audit(actor, submissionId, operationId, 'generated', 'trial_only');
    return { ok: true, value: view(saved) };
  }

  public async get(actor: TrustedActorContext, submissionId: string,
    generationOperationId: string): Promise<TeacherSuggestionPollResult> {
    if (!validId(submissionId) || !validId(generationOperationId)) return { ok: false, code: 'VALIDATION_ERROR' };
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('submission.review')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    const evidence = await this.reviewQuery.getSubmissionForReview(actor, submissionId);
    if (!evidence.ok) return { ok: false, code: evidence.error.code === 'FORBIDDEN' ? 'FORBIDDEN'
      : evidence.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE' };
    const review = evidence.data;
    const assignment = await this.taskRepository.findAssignmentById(actor.organizationId, review.assignmentId);
    if (assignment === null || assignment.latestSubmissionId !== submissionId
      || assignment.version !== review.assignmentVersion) return { ok: false, code: 'CONFLICT' };
    const automaticOperationId = automaticSuggestionOperationId({ organizationId: actor.organizationId, submissionId });
    const ownerId = generationOperationId === automaticOperationId
      ? (await this.taskRepository.findTask(actor.organizationId, review.taskId))?.creatorTeacherId
      : actor.actorUserId;
    if (!ownerId) return { ok: false, code: 'NOT_FOUND' };
    let record = await this.store.find(actor.organizationId, ownerId, generationOperationId);
    if (record === null) return generationOperationId === automaticOperationId
      ? { ok: true, value: { status: 'not_started' } } : { ok: false, code: 'NOT_FOUND' };
    const digest = evidenceDigest(review, projectFacts(review));
    if (record.submissionId !== submissionId || record.submissionVersion !== review.submissionVersion
      || record.assignmentVersion !== assignment.version || record.evidenceDigest !== digest
      || record.modelVersion !== this.modelVersion || record.promptVersion !== this.promptVersion) {
      return { ok: false, code: 'CONFLICT' };
    }
    if (record.status === 'processing') {
      const ageMs = Date.parse(this.clock.nowIso()) - Date.parse(record.createdAt);
      if (Number.isFinite(ageMs) && ageMs > 240_000) {
        if (await this.store.fail(record.id, record.version, 'generation_timeout')) {
          await this.audit(actor, submissionId, generationOperationId, 'rejected', 'generation_timeout');
        }
        record = await this.store.find(actor.organizationId, ownerId, generationOperationId) ?? record;
      }
    }
    if (generationOperationId === automaticOperationId && ownerId !== actor.actorUserId
      && record.status === 'trial' && record.text !== null && safeTeacherSuggestionText(record.text)) {
      // The publishing boundary binds a suggestion to the reviewing teacher.
      // Give another currently authorized teacher an idempotent local copy.
      const copied = await this.store.reserve({ id: this.ids.next('suggestion'),
        organizationId: actor.organizationId, teacherId: actor.actorUserId,
        taskId: record.taskId, submissionId, submissionVersion: record.submissionVersion,
        assignmentVersion: record.assignmentVersion, operationId: automaticOperationId,
        evidenceDigest: digest, modelVersion: record.modelVersion,
        promptVersion: record.promptVersion, text: null, citedFactIds: [], status: 'processing',
        failureReason: null, createdAt: this.clock.nowIso() });
      if (copied.kind === 'limit') return { ok: true, value: { status: 'failed' } };
      record = copied.kind === 'reserved'
        ? await this.store.complete(copied.record.id, copied.record.version,
          record.text, record.citedFactIds, this.clock.nowIso()) ?? copied.record
        : copied.record;
    }
    return { ok: true, value: record.status === 'trial'
      ? record.text !== null && safeTeacherSuggestionText(record.text) ? view(record) : { status: 'failed' }
      : { status: record.status === 'processing' ? 'processing'
        : record.failureReason === 'insufficient_evidence' ? 'insufficient_evidence' : 'failed' } };
  }

  public async getAutomatic(actor: TrustedActorContext,
    submissionId: string): Promise<TeacherSuggestionPollResult> {
    return this.get(actor, submissionId,
      automaticSuggestionOperationId({ organizationId: actor.organizationId, submissionId }));
  }

  private audit(actor: TrustedActorContext, submissionId: string, operationId: string,
    outcome: 'generated' | 'replayed' | 'rejected', reason: string): Promise<void> {
    return this.store.appendAudit({ organizationId: actor.organizationId, teacherId: actor.actorUserId,
      submissionId, operationId, outcome, reason, occurredAt: this.clock.nowIso() });
  }
}

function projectFacts(review: ReviewSubmissionView): readonly TeacherSuggestionFact[] {
  const facts: TeacherSuggestionFact[] = [];
  const exercises = [...review.exerciseEvidence]
    .filter(item => item.recorded && item.isCorrect !== null)
    .sort((left, right) => Number(left.isCorrect) - Number(right.isCorrect));
  for (const [index, item] of exercises.slice(0, 2).entries()) {
    const stem = safeEducationalExcerpt(item.stem, 80);
    const response = safeEducationalExcerpt(educationalValue(item.studentResponse), 40);
    const correctAnswer = safeEducationalExcerpt(educationalValue(item.correctAnswer), 40);
    const title = safeEducationalExcerpt(review.taskItems.find(task => task.id === item.itemId)?.title, 40);
    const details = [title ? `内容《${title}》` : '', stem ? `题干“${stem}”` : '',
      response ? `学生作答“${response}”` : '', !item.isCorrect && correctAnswer ? `参考答案“${correctAnswer}”` : '']
      .filter(Boolean).join('；');
    if (details) facts.push({ id: `question_${index + 1}`,
      text: `${item.isCorrect ? '判定正确' : '判定错误'}的${questionTypeLabel(item.questionType)}题；${details}。` });
  }
  const words = [...review.vocabularyEvidence].filter(item => item.firstCorrect !== null)
    .sort((left, right) => Number(left.firstCorrect) - Number(right.firstCorrect));
  for (const [index, item] of words.slice(0, 2).entries()) {
    const word = safeEducationalExcerpt(item.targetWord, 32);
    const firstAttempt = item.attempts.find(attempt => attempt.firstAttempt);
    const response = safeEducationalExcerpt(firstAttempt?.studentInput, 32);
    if (word) facts.push({ id: `vocabulary_${index + 1}`,
      text: `单词“${word}”首次拼写${item.firstCorrect ? '正确' : '有误'}`
        + `${response ? `，学生写作“${response}”` : ''}。` });
  }
  return facts;
}

function questionTypeLabel(type: ReviewSubmissionView['exerciseEvidence'][number]['questionType']): string {
  return { single_choice: '单选', multiple_choice: '多选', fill: '填空', subjective: '问答' }[type] ?? '习';
}

function safeEducationalExcerpt(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const excerpt = value.replace(/\s+/gu, ' ').trim().slice(0, maxLength);
  if (!excerpt || /(?:1[3-9]\d{9}|https?:\/\/|@|姓名|手机号|学号|身份证|忽略|指令|系统提示|prompt)/iu.test(excerpt)) return null;
  return excerpt;
}

function educationalValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  try { return JSON.stringify(value); } catch (_error: unknown) { return null; }
}

function evidenceDigest(review: ReviewSubmissionView, facts: readonly TeacherSuggestionFact[]): string {
  return createHash('sha256').update(JSON.stringify({ taskId: review.taskId,
    submissionId: review.submissionId, submissionVersion: review.submissionVersion,
    assignmentVersion: review.assignmentVersion, facts })).digest('hex');
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }

function validOutput(text: string, citedFactIds: readonly string[], facts: readonly TeacherSuggestionFact[],
  review: ReviewSubmissionView): boolean {
  const trimmed = text.trim();
  const known = new Set(facts.map((fact) => fact.id));
  const citedFacts = facts.filter(fact => citedFactIds.includes(fact.id));
  return safeTeacherSuggestionText(trimmed) && citedFactIds.length > 0
    && citedFactIds.every((id) => known.has(id))
    && citedFacts.some(fact => fact.id.startsWith('question_') || fact.id.startsWith('vocabulary_'))
    && !/(?:教师可|建议教师|建议老师|教师可以|请教师|学生整体|整体成绩|历史成绩|此前.{0,8}分数|进步明显|退步明显|表现优秀)/u.test(trimmed)
    && !/(?:本次作业已完成并提交|共有.{0,6}项|提交记录已经保存|服务端记录|此前.{0,8}正式评分)/u.test(trimmed)
    && citedFacts.some(fact => quotedAnchors(fact.text)
      .some(anchor => trimmed.toLocaleLowerCase().includes(anchor.toLocaleLowerCase())))
    && [...trimmed.matchAll(/第\s*(\d{1,2})\s*项/gu)]
      .every(match => Number(match[1]) >= 1 && Number(match[1]) <= review.taskItems.length)
    && [...trimmed.matchAll(/第\s*(\d{1,2})\s*题/gu)]
      .every(match => Number(match[1]) >= 1 && Number(match[1]) <= review.exerciseEvidence.length);
}

function quotedAnchors(value: string): string[] {
  return [...value.matchAll(/[“"]([^”"]{2,40})[”"]/gu)]
    .map(match => match[1]!.trim())
    .filter(anchor => !/^(?:内容|题干|学生作答|参考答案|意思是|学生写作)$/u.test(anchor));
}

function view(record: TeacherSuggestionRecord): TeacherSuggestionView {
  if (record.status !== 'trial' || record.text === null) throw new Error('Teacher suggestion is not complete.');
  return { id: record.id, submissionId: record.submissionId, submissionVersion: record.submissionVersion,
    modelVersion: record.modelVersion, promptVersion: record.promptVersion, text: record.text,
    generationNumber: record.generationNumber, remainingRegenerations: Math.max(0, 4 - record.generationNumber),
    status: 'trial', requiresTeacherConfirmation: true };
}
