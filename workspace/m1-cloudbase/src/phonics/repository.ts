import type { PhonicsAnswerRecord, PhonicsCourse, PhonicsReceipt } from './types';

export interface PhonicsTransaction {
  listActiveClassIds(organizationId: string, studentId: string): Promise<readonly string[]>;
  listCourses(organizationId: string): Promise<readonly PhonicsCourse[]>;
  findCourse(organizationId: string, courseId: string): Promise<PhonicsCourse | null>;
  listAnswers(organizationId: string, studentId: string, courseId: string,
    contentVersion: string): Promise<readonly PhonicsAnswerRecord[]>;
  appendAnswer(answer: PhonicsAnswerRecord): Promise<boolean>;
  findReceipt(organizationId: string, studentId: string, operationId: string): Promise<PhonicsReceipt | null>;
  saveReceipt(receipt: PhonicsReceipt): Promise<boolean>;
}

export interface PhonicsUnitOfWork {
  transaction<T>(work: (transaction: PhonicsTransaction) => Promise<T>): Promise<T>;
}

export interface PhonicsAudioPort {
  temporaryUrl(fileId: string): Promise<string>;
}
