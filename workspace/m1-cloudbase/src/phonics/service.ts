import type { TrustedActorContext } from '../auth/trusted-actor';
import type { PhonicsAudioPort, PhonicsTransaction, PhonicsUnitOfWork } from './repository';
import { PhonicsError, type PhonicsAnswerRecord, type PhonicsAnswerView, type PhonicsCourse,
  type PhonicsCourseListItem, type PhonicsCourseState, type PhonicsCourseView } from './types';

export interface PhonicsClock { nowIso(): string }
export interface PhonicsIds { next(prefix: string): string }

function accessible(course: PhonicsCourse, classIds: readonly string[]): boolean {
  return course.status === 'published' && (course.visibility.type === 'organization'
    || course.visibility.classIds.some(classId => classIds.includes(classId)));
}

function validCourse(course: PhonicsCourse): boolean {
  if (!course.title.trim() || !course.grade.trim() || !course.unit.trim() || !course.contentVersion.trim()
    || !course.phonemes.length || !course.questions.length
    || new Set(course.phonemes.map(item => item.id)).size !== course.phonemes.length
    || new Set(course.questions.map(item => item.id)).size !== course.questions.length) return false;
  if (course.phonemes.some(item => !item.id.trim() || !item.label.trim() || !item.examples.length
    || item.examples.some(example => !example.trim())
    || (item.audioFileId !== null && !item.audioFileId.trim()))) return false;
  return course.questions.every(question => question.id.trim() && question.stem.trim()
    && question.options.length >= 2 && question.explanation.trim()
    && new Set(question.options.map(option => option.id)).size === question.options.length
    && question.options.every(option => option.id.trim() && option.text.trim())
    && question.options.some(option => option.id === question.correctOptionId));
}

function courseView(course: PhonicsCourse): PhonicsCourseView {
  return { id: course.id, title: course.title, grade: course.grade, unit: course.unit,
    contentVersion: course.contentVersion,
    phonemes: course.phonemes.map(item => ({ id: item.id, label: item.label,
      examples: [...item.examples], audioAvailable: item.audioFileId !== null })),
    questions: course.questions.map(item => ({ id: item.id, stem: item.stem,
      options: item.options.map(option => ({ ...option })) })) };
}

export class PhonicsService {
  public constructor(private readonly repository: PhonicsUnitOfWork,
    private readonly clock: PhonicsClock, private readonly ids: PhonicsIds,
    private readonly audio: PhonicsAudioPort | null = null) {}

  public async listCourses(actor: TrustedActorContext): Promise<readonly PhonicsCourseListItem[]> {
    this.studentOnly(actor);
    return this.repository.transaction(async transaction => {
      const classes = await this.classes(transaction, actor);
      return (await transaction.listCourses(actor.organizationId))
        .filter(course => accessible(course, classes) && validCourse(course))
        .map(course => ({ id: course.id, title: course.title, grade: course.grade, unit: course.unit,
          contentVersion: course.contentVersion, phonemeCount: course.phonemes.length,
          questionCount: course.questions.length }));
    });
  }

  public async getCourse(actor: TrustedActorContext, courseId: string): Promise<PhonicsCourseView> {
    this.studentOnly(actor);
    if (!courseId?.trim()) throw new PhonicsError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => courseView(await this.course(transaction, actor, courseId)));
  }

  public async getState(actor: TrustedActorContext, courseId: string): Promise<PhonicsCourseState> {
    this.studentOnly(actor);
    if (!courseId?.trim()) throw new PhonicsError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      const course = await this.course(transaction, actor, courseId);
      const answers = await transaction.listAnswers(actor.organizationId, actor.actorUserId,
        course.id, course.contentVersion);
      const rounds = [...new Set(answers.map(answer => answer.round))].sort((a, b) => a - b);
      if (rounds.some((round, index) => round !== index + 1)) throw new PhonicsError('SERVICE_UNAVAILABLE');
      const currentRound = rounds[rounds.length - 1] ?? 1;
      const states = course.questions.map(question => {
        const attempts = answers.filter(answer => answer.round === currentRound && answer.questionId === question.id)
          .sort((left, right) => left.attemptNumber - right.attemptNumber);
        if (attempts.some((attempt, index) => attempt.attemptNumber !== index + 1
          || attempt.firstAttempt !== (index === 0))) throw new PhonicsError('SERVICE_UNAVAILABLE');
        return { questionId: question.id, firstCorrect: attempts[0]?.isCorrect ?? null,
          lastCorrect: attempts[attempts.length - 1]?.isCorrect ?? null, version: attempts.length };
      });
      if (answers.some(answer => !course.questions.some(question => question.id === answer.questionId))) {
        throw new PhonicsError('SERVICE_UNAVAILABLE');
      }
      const completedCount = states.filter(state => state.firstCorrect !== null).length;
      const firstCorrectCount = states.filter(state => state.firstCorrect === true).length;
      const history = rounds.flatMap(round => {
        const first = course.questions.map(question => answers.find(answer => answer.round === round
          && answer.questionId === question.id && answer.attemptNumber === 1));
        if (first.some(item => item === undefined)) return [];
        const correct = first.filter(item => item?.isCorrect).length;
        const completedAt = first.reduce((latest, item) => item && item.attemptedAt > latest ? item.attemptedAt : latest, '');
        return [{ round, score: Math.round(correct * 100 / course.questions.length), completedAt }];
      });
      const wrongQuestionIds = course.questions.filter(question => {
        const latest = answers.filter(answer => answer.questionId === question.id)
          .sort((left, right) => right.round - left.round || right.attemptNumber - left.attemptNumber)[0];
        return latest?.isCorrect === false;
      }).map(question => question.id);
      return { courseId: course.id, contentVersion: course.contentVersion, currentRound,
        completedCount, firstCorrectCount, score: history.find(item => item.round === currentRound)?.score ?? null,
        history, wrongQuestionIds, questions: states };
    });
  }

  public async submitAnswer(actor: TrustedActorContext, input: Readonly<{ courseId: string;
    questionId: string; selectedOptionId: string; round: number }>, expectedVersion: number,
  operationId: string): Promise<PhonicsAnswerView> {
    this.studentOnly(actor);
    if (!input.courseId?.trim() || !input.questionId?.trim() || !input.selectedOptionId?.trim()
      || !Number.isSafeInteger(input.round) || input.round < 1
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(operationId)) throw new PhonicsError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ ...input, expectedVersion });
    return this.repository.transaction(async transaction => {
      const course = await this.course(transaction, actor, input.courseId);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new PhonicsError('CONFLICT');
        const question = course.questions.find(item => item.id === prior.result.questionId);
        if (!question) throw new PhonicsError('SERVICE_UNAVAILABLE');
        return this.answerView(prior.result, question.correctOptionId, question.explanation);
      }
      const question = course.questions.find(item => item.id === input.questionId);
      if (!question || !question.options.some(option => option.id === input.selectedOptionId)) {
        throw new PhonicsError('VALIDATION_ERROR');
      }
      const allAnswers = await transaction.listAnswers(actor.organizationId, actor.actorUserId,
        course.id, course.contentVersion);
      const maxRound = Math.max(0, ...allAnswers.map(answer => answer.round));
      if (input.round !== (maxRound || 1) && input.round !== maxRound + 1) throw new PhonicsError('CONFLICT');
      if (input.round === maxRound + 1 && maxRound > 0
        && course.questions.some(item => !allAnswers.some(answer => answer.round === maxRound
          && answer.questionId === item.id && answer.attemptNumber === 1))) throw new PhonicsError('CONFLICT');
      const attempts = allAnswers.filter(item => item.round === input.round && item.questionId === question.id)
        .sort((left, right) => left.attemptNumber - right.attemptNumber);
      if (attempts.length !== expectedVersion || attempts.some((attempt, index) => attempt.attemptNumber !== index + 1)) {
        throw new PhonicsError('CONFLICT');
      }
      const record: PhonicsAnswerRecord = { id: this.ids.next('phonics_answer'),
        organizationId: actor.organizationId, studentId: actor.actorUserId, courseId: course.id,
        contentVersion: course.contentVersion, round: input.round, questionId: question.id,
        selectedOptionId: input.selectedOptionId, isCorrect: input.selectedOptionId === question.correctOptionId,
        firstAttempt: attempts.length === 0, attemptNumber: attempts.length + 1,
        attemptedAt: this.clock.nowIso() };
      if (!await transaction.appendAnswer(record)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId,
          studentId: actor.actorUserId, operationId, fingerprint, result: record })) {
        throw new PhonicsError('CONFLICT');
      }
      return this.answerView(record, question.correctOptionId, question.explanation);
    });
  }

  public async getAudio(actor: TrustedActorContext, courseId: string, phonemeId: string): Promise<Readonly<{
    courseId: string; phonemeId: string; temporaryUrl: string; expiresAt: string }>> {
    this.studentOnly(actor);
    if (!courseId?.trim() || !phonemeId?.trim()) throw new PhonicsError('VALIDATION_ERROR');
    const fileId = await this.repository.transaction(async transaction => {
      const course = await this.course(transaction, actor, courseId);
      const phoneme = course.phonemes.find(item => item.id === phonemeId);
      if (!phoneme?.audioFileId) throw new PhonicsError('RESOURCE_OFFLINE');
      return phoneme.audioFileId;
    });
    if (!this.audio) throw new PhonicsError('SERVICE_UNAVAILABLE');
    const temporaryUrl = await this.audio.temporaryUrl(fileId);
    if (!/^https:\/\//.test(temporaryUrl)) throw new PhonicsError('SERVICE_UNAVAILABLE');
    return { courseId, phonemeId, temporaryUrl,
      expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() };
  }

  private answerView(record: PhonicsAnswerRecord, correctOptionId: string,
    explanation: string): PhonicsAnswerView {
    return { round: record.round, questionId: record.questionId, selectedOptionId: record.selectedOptionId,
      correctOptionId, explanation, isCorrect: record.isCorrect,
      firstAttempt: record.firstAttempt, attemptNumber: record.attemptNumber,
      attemptedAt: record.attemptedAt };
  }
  private studentOnly(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'student') throw new PhonicsError('FORBIDDEN');
  }
  private async classes(transaction: PhonicsTransaction, actor: TrustedActorContext): Promise<readonly string[]> {
    const classes = await transaction.listActiveClassIds(actor.organizationId, actor.actorUserId);
    if (!classes.length) throw new PhonicsError('FORBIDDEN');
    return classes;
  }
  private async course(transaction: PhonicsTransaction, actor: TrustedActorContext,
    courseId: string): Promise<PhonicsCourse> {
    const classes = await this.classes(transaction, actor);
    const course = await transaction.findCourse(actor.organizationId, courseId);
    if (!course || !accessible(course, classes)) throw new PhonicsError('NOT_FOUND');
    if (!validCourse(course)) throw new PhonicsError('RESOURCE_OFFLINE');
    return course;
  }
}
