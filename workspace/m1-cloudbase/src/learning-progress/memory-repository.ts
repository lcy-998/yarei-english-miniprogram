import type { LearningProgressRepository, LearningProgressTransaction } from './repository';
import type {
  LearningProgressAuditRecord,
  LearningProgressOperationRecord,
  LearningResourceAccessRecord,
  ReadingProgressRecord,
  VocabularyProgressRecord,
} from './types';

export interface LearningProgressFixture {
  readonly resources: readonly LearningResourceAccessRecord[];
  readonly readingProgress?: readonly ReadingProgressRecord[];
  readonly vocabularyProgress?: readonly VocabularyProgressRecord[];
  readonly operations?: readonly LearningProgressOperationRecord[];
  readonly audits?: readonly LearningProgressAuditRecord[];
}

const cloneResource = (value: LearningResourceAccessRecord): LearningResourceAccessRecord => ({
  ...value,
  allowedStudentIds: [...value.allowedStudentIds],
  pages: value.pages.map((page) => ({ ...page })),
  wordIds: [...value.wordIds],
});
const cloneReading = (value: ReadingProgressRecord): ReadingProgressRecord => ({ ...value });
const cloneVocabulary = (value: VocabularyProgressRecord): VocabularyProgressRecord => ({ ...value, wrongWordIds: [...value.wrongWordIds] });
const cloneOperation = (value: LearningProgressOperationRecord): LearningProgressOperationRecord => ({
  ...value,
  result: 'wrongWordIds' in value.result ? { ...value.result, wrongWordIds: [...value.result.wrongWordIds] } : { ...value.result },
});

export class InMemoryLearningProgressRepository implements LearningProgressRepository, LearningProgressTransaction {
  private resources: LearningResourceAccessRecord[];
  private reading: ReadingProgressRecord[];
  private vocabulary: VocabularyProgressRecord[];
  private operations: LearningProgressOperationRecord[];
  private audits: LearningProgressAuditRecord[];
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(fixture: LearningProgressFixture) {
    this.resources = fixture.resources.map(cloneResource);
    this.reading = (fixture.readingProgress ?? []).map(cloneReading);
    this.vocabulary = (fixture.vocabularyProgress ?? []).map(cloneVocabulary);
    this.operations = (fixture.operations ?? []).map(cloneOperation);
    this.audits = (fixture.audits ?? []).map((item) => ({ ...item }));
  }

  public async runTransaction<T>(work: (transaction: LearningProgressTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = this.debugSnapshot();
    try {
      return await work(this);
    } catch (error: unknown) {
      this.reading = snapshot.readingProgress.map(cloneReading);
      this.vocabulary = snapshot.vocabularyProgress.map(cloneVocabulary);
      this.operations = snapshot.operations.map(cloneOperation);
      this.audits = snapshot.audits.map((item) => ({ ...item }));
      throw error;
    } finally {
      release();
    }
  }

  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceAccessRecord | null> {
    const value = this.resources.find((item) => item.organizationId === organizationId && item.id === resourceId);
    return value === undefined ? null : cloneResource(value);
  }

  public async findReadingProgress(organizationId: string, studentId: string, resourceId: string): Promise<ReadingProgressRecord | null> {
    const value = this.reading.find((item) => item.organizationId === organizationId && item.studentId === studentId && item.resourceId === resourceId);
    return value === undefined ? null : cloneReading(value);
  }

  public async findVocabularyProgress(organizationId: string, studentId: string, packId: string): Promise<VocabularyProgressRecord | null> {
    const value = this.vocabulary.find((item) => item.organizationId === organizationId && item.studentId === studentId && item.packId === packId);
    return value === undefined ? null : cloneVocabulary(value);
  }

  public async findOperation(recordId: string): Promise<LearningProgressOperationRecord | null> {
    const value = this.operations.find((item) => item.id === recordId);
    return value === undefined ? null : cloneOperation(value);
  }

  public async saveReadingProgress(record: ReadingProgressRecord): Promise<void> {
    this.reading = replace(this.reading, cloneReading(record));
  }

  public async saveVocabularyProgress(record: VocabularyProgressRecord): Promise<void> {
    this.vocabulary = replace(this.vocabulary, cloneVocabulary(record));
  }

  public async saveOperation(record: LearningProgressOperationRecord): Promise<void> {
    if (this.operations.some((item) => item.id === record.id)) throw new Error('operation already exists');
    this.operations.push(cloneOperation(record));
  }

  public async appendAudit(record: LearningProgressAuditRecord): Promise<void> {
    this.audits.push({ ...record });
  }

  public debugSnapshot(): Readonly<{
    readingProgress: readonly ReadingProgressRecord[];
    vocabularyProgress: readonly VocabularyProgressRecord[];
    operations: readonly LearningProgressOperationRecord[];
    audits: readonly LearningProgressAuditRecord[];
  }> {
    return {
      readingProgress: this.reading.map(cloneReading),
      vocabularyProgress: this.vocabulary.map(cloneVocabulary),
      operations: this.operations.map(cloneOperation),
      audits: this.audits.map((item) => ({ ...item })),
    };
  }
}

function replace<T extends { readonly id: string }>(items: readonly T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  return index < 0 ? [...items, next] : items.map((item, itemIndex) => itemIndex === index ? next : item);
}
