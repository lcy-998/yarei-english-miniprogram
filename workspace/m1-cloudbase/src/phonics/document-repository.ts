import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { PhonicsTransaction, PhonicsUnitOfWork } from './repository';
import { PhonicsError, type PhonicsAnswerRecord, type PhonicsCourse, type PhonicsQuestion,
  type PhonicsReceipt } from './types';

export const PHONICS_COLLECTIONS = { users: 'users', classes: 'classes', memberships: 'class_memberships',
  courses: 'phonics_courses', answers: 'phonics_answers', receipts: 'phonics_answer_operations' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function visible(document: VersionedDocument | null, organizationId: string): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}
function receiptId(organizationId: string, studentId: string, operationId: string): string {
  return `phonics_operation_${hashHex(JSON.stringify([organizationId, studentId, operationId]))}`;
}
function projectCourse(document: VersionedDocument, organizationId: string): PhonicsCourse | null {
  if (!visible(document, organizationId) || typeof document.id !== 'string'
    || typeof document.title !== 'string' || typeof document.grade !== 'string'
    || typeof document.unit !== 'string' || typeof document.contentVersion !== 'string'
    || (document.status !== 'draft' && document.status !== 'published' && document.status !== 'offline')
    || !isRecord(document.visibility) || !Array.isArray(document.phonemes)
    || !Array.isArray(document.questions)) return null;
  const visibility = document.visibility.type === 'organization' ? { type: 'organization' as const }
    : document.visibility.type === 'classes' && Array.isArray(document.visibility.classIds)
      && document.visibility.classIds.every(item => typeof item === 'string')
      ? { type: 'classes' as const, classIds: document.visibility.classIds as string[] } : null;
  if (!visibility) return null;
  const phonemes: PhonicsCourse['phonemes'][number][] = [];
  for (const value of document.phonemes) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string'
      || !Array.isArray(value.examples) || !value.examples.every(item => typeof item === 'string')
      || (value.audioFileId !== null && typeof value.audioFileId !== 'string')) return null;
    phonemes.push({ id: value.id, label: value.label, examples: value.examples as string[],
      audioFileId: value.audioFileId });
  }
  const questions: PhonicsQuestion[] = [];
  for (const value of document.questions) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.stem !== 'string'
      || !Array.isArray(value.options) || typeof value.correctOptionId !== 'string'
      || typeof value.explanation !== 'string') return null;
    const options: Array<{ id: string; text: string }> = [];
    for (const option of value.options) {
      if (!isRecord(option) || typeof option.id !== 'string' || typeof option.text !== 'string') return null;
      options.push({ id: option.id, text: option.text });
    }
    questions.push({ id: value.id, stem: value.stem, options,
      correctOptionId: value.correctOptionId, explanation: value.explanation });
  }
  return { id: document.id, organizationId, title: document.title, grade: document.grade,
    unit: document.unit, contentVersion: document.contentVersion, status: document.status,
    visibility, phonemes, questions };
}
function projectAnswer(value: unknown): PhonicsAnswerRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.organizationId !== 'string'
    || typeof value.studentId !== 'string' || typeof value.courseId !== 'string'
    || typeof value.contentVersion !== 'string' || !Number.isSafeInteger(value.round)
    || Number(value.round) < 1 || typeof value.questionId !== 'string'
    || typeof value.selectedOptionId !== 'string' || typeof value.isCorrect !== 'boolean'
    || typeof value.firstAttempt !== 'boolean' || !Number.isSafeInteger(value.attemptNumber)
    || Number(value.attemptNumber) < 1 || typeof value.attemptedAt !== 'string'
    || !Number.isFinite(Date.parse(value.attemptedAt))) return null;
  return { id: value.id, organizationId: value.organizationId, studentId: value.studentId,
    courseId: value.courseId, contentVersion: value.contentVersion, round: Number(value.round), questionId: value.questionId,
    selectedOptionId: value.selectedOptionId, isCorrect: value.isCorrect,
    firstAttempt: value.firstAttempt, attemptNumber: Number(value.attemptNumber), attemptedAt: value.attemptedAt };
}

class DocumentPhonicsTransaction implements PhonicsTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort) {}
  public async listActiveClassIds(organizationId: string, studentId: string): Promise<readonly string[]> {
    const user = await this.documents.get(PHONICS_COLLECTIONS.users, studentId);
    if (!visible(user, organizationId) || user.status !== 'active') return [];
    const memberships = await this.documents.find(PHONICS_COLLECTIONS.memberships, { organizationId,
      studentId, status: 'active', deletedAt: null });
    const classes: string[] = [];
    for (const membership of memberships) {
      if (typeof membership.classId !== 'string') throw new PhonicsError('SERVICE_UNAVAILABLE');
      const classRecord = await this.documents.get(PHONICS_COLLECTIONS.classes, membership.classId);
      if (visible(classRecord, organizationId) && classRecord.status === 'active') classes.push(membership.classId);
    }
    return [...new Set(classes)];
  }
  public async listCourses(organizationId: string): Promise<readonly PhonicsCourse[]> {
    const documents = await this.documents.find(PHONICS_COLLECTIONS.courses, { organizationId, deletedAt: null });
    return documents.map(document => {
      const course = projectCourse(document, organizationId);
      if (!course) throw new PhonicsError('SERVICE_UNAVAILABLE');
      return course;
    });
  }
  public async findCourse(organizationId: string, courseId: string): Promise<PhonicsCourse | null> {
    const document = await this.documents.get(PHONICS_COLLECTIONS.courses, courseId);
    if (!visible(document, organizationId)) return null;
    const course = projectCourse(document, organizationId);
    if (!course || course.id !== courseId) throw new PhonicsError('SERVICE_UNAVAILABLE');
    return course;
  }
  public async listAnswers(organizationId: string, studentId: string, courseId: string,
    contentVersion: string): Promise<readonly PhonicsAnswerRecord[]> {
    const documents = await this.documents.find(PHONICS_COLLECTIONS.answers, { organizationId,
      studentId, courseId, contentVersion, deletedAt: null });
    return documents.map(document => {
      const answer = projectAnswer(document);
      if (!answer || answer.organizationId !== organizationId || answer.studentId !== studentId
        || answer.courseId !== courseId || answer.contentVersion !== contentVersion) {
        throw new PhonicsError('SERVICE_UNAVAILABLE');
      }
      return answer;
    });
  }
  public async appendAnswer(answer: PhonicsAnswerRecord): Promise<boolean> {
    return this.documents.create(PHONICS_COLLECTIONS.answers, { _id: answer.id,
      organizationId: answer.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      ...JSON.parse(JSON.stringify(answer)) as Record<string, JsonValue> });
  }
  public async findReceipt(organizationId: string, studentId: string, operationId: string): Promise<PhonicsReceipt | null> {
    const document = await this.documents.get(PHONICS_COLLECTIONS.receipts,
      receiptId(organizationId, studentId, operationId));
    if (!visible(document, organizationId) || document.studentId !== studentId
      || document.operationId !== operationId || typeof document.fingerprint !== 'string') return null;
    const result = projectAnswer(document.result);
    if (!result || result.organizationId !== organizationId || result.studentId !== studentId) {
      throw new PhonicsError('SERVICE_UNAVAILABLE');
    }
    return { organizationId, studentId, operationId, fingerprint: document.fingerprint, result };
  }
  public async saveReceipt(receipt: PhonicsReceipt): Promise<boolean> {
    return this.documents.create(PHONICS_COLLECTIONS.receipts, { _id: receiptId(receipt.organizationId,
      receipt.studentId, receipt.operationId), organizationId: receipt.organizationId,
    schemaVersion: 1, version: 1, deletedAt: null, studentId: receipt.studentId,
    operationId: receipt.operationId, fingerprint: receipt.fingerprint,
    result: JSON.parse(JSON.stringify(receipt.result)) as JsonValue });
  }
}

export class DocumentPhonicsRepository implements PhonicsUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}
  public async transaction<T>(work: (transaction: PhonicsTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(async documents => work(new DocumentPhonicsTransaction(documents)));
  }
}
