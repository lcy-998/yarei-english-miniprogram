import type { PhonicsTransaction, PhonicsUnitOfWork } from './repository';
import type { PhonicsAnswerRecord, PhonicsCourse, PhonicsReceipt } from './types';

export interface PhonicsFixture {
  readonly memberships?: readonly Readonly<{ organizationId: string; studentId: string; classId: string; status: 'active' | 'inactive' }>[];
  readonly courses?: readonly PhonicsCourse[];
  readonly answers?: readonly PhonicsAnswerRecord[];
  readonly receipts?: readonly PhonicsReceipt[];
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class InMemoryPhonicsRepository implements PhonicsUnitOfWork, PhonicsTransaction {
  private state: { memberships: NonNullable<PhonicsFixture['memberships']>; courses: PhonicsCourse[];
    answers: PhonicsAnswerRecord[]; receipts: PhonicsReceipt[] };
  private tail: Promise<void> = Promise.resolve();
  public constructor(fixture: PhonicsFixture = {}) {
    this.state = copy({ memberships: fixture.memberships ?? [], courses: [...(fixture.courses ?? [])],
      answers: [...(fixture.answers ?? [])], receipts: [...(fixture.receipts ?? [])] });
  }
  public async transaction<T>(work: (transaction: PhonicsTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = copy(this.state);
    try { return await work(this); }
    catch (error: unknown) { this.state = before; throw error; }
    finally { release(); }
  }
  public async listActiveClassIds(organizationId: string, studentId: string): Promise<readonly string[]> {
    return copy(this.state.memberships.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.status === 'active').map(item => item.classId));
  }
  public async listCourses(organizationId: string): Promise<readonly PhonicsCourse[]> {
    return copy(this.state.courses.filter(item => item.organizationId === organizationId));
  }
  public async findCourse(organizationId: string, courseId: string): Promise<PhonicsCourse | null> {
    return copy(this.state.courses.find(item => item.organizationId === organizationId && item.id === courseId) ?? null);
  }
  public async listAnswers(organizationId: string, studentId: string, courseId: string,
    contentVersion: string): Promise<readonly PhonicsAnswerRecord[]> {
    return copy(this.state.answers.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.courseId === courseId && item.contentVersion === contentVersion));
  }
  public async appendAnswer(answer: PhonicsAnswerRecord): Promise<boolean> {
    if (this.state.answers.some(item => item.id === answer.id)) return false;
    this.state.answers.push(copy(answer)); return true;
  }
  public async findReceipt(organizationId: string, studentId: string, operationId: string): Promise<PhonicsReceipt | null> {
    return copy(this.state.receipts.find(item => item.organizationId === organizationId && item.studentId === studentId
      && item.operationId === operationId) ?? null);
  }
  public async saveReceipt(receipt: PhonicsReceipt): Promise<boolean> {
    if (this.state.receipts.some(item => item.organizationId === receipt.organizationId
      && item.studentId === receipt.studentId && item.operationId === receipt.operationId)) return false;
    this.state.receipts.push(copy(receipt)); return true;
  }
  public snapshot() { return copy(this.state); }
}
