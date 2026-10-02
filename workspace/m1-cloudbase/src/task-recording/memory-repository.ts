import type { TaskRecordingTransaction, TaskRecordingUnitOfWork } from './repository';
import type { TaskRecordingRecord, TaskRecordingReceipt } from './types';
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export class InMemoryTaskRecordingRepository implements TaskRecordingUnitOfWork, TaskRecordingTransaction {
  private recordings: TaskRecordingRecord[];
  private receipts: TaskRecordingReceipt[];
  private tail: Promise<void> = Promise.resolve();
  public constructor(fixture: Readonly<{ recordings?: readonly TaskRecordingRecord[];
    receipts?: readonly TaskRecordingReceipt[] }> = {}) {
    this.recordings = copy([...(fixture.recordings ?? [])]); this.receipts = copy([...(fixture.receipts ?? [])]);
  }
  public async transaction<T>(work: (transaction: TaskRecordingTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = copy({ recordings: this.recordings, receipts: this.receipts });
    try { return await work(this); }
    catch (error: unknown) { this.recordings = before.recordings; this.receipts = before.receipts; throw error; }
    finally { release(); }
  }
  public async findRecording(organizationId: string, recordingId: string): Promise<TaskRecordingRecord | null> {
    return copy(this.recordings.find((item) => item.organizationId === organizationId && item.id === recordingId) ?? null);
  }
  public async listMyRecordings(organizationId: string, studentId: string, taskId: string,
    itemId: string, submissionVersion: number): Promise<readonly TaskRecordingRecord[]> {
    return copy(this.recordings.filter((item) => item.organizationId === organizationId && item.studentId === studentId
      && item.taskId === taskId && item.itemId === itemId && item.submissionVersion === submissionVersion));
  }
  public async saveRecording(record: TaskRecordingRecord, expectedVersion: number): Promise<boolean> {
    const index = this.recordings.findIndex((item) => item.organizationId === record.organizationId && item.id === record.id);
    if ((index < 0 && expectedVersion !== 0) || (index >= 0 && this.recordings[index]?.version !== expectedVersion)) return false;
    if (index < 0) this.recordings.push(copy(record)); else this.recordings[index] = copy(record);
    return true;
  }
  public async findReceipt(organizationId: string, actorId: string, operationId: string): Promise<TaskRecordingReceipt | null> {
    return copy(this.receipts.find((item) => item.organizationId === organizationId
      && item.actorId === actorId && item.operationId === operationId) ?? null);
  }
  public async saveReceipt(receipt: TaskRecordingReceipt): Promise<boolean> {
    if (this.receipts.some((item) => item.organizationId === receipt.organizationId
      && item.actorId === receipt.actorId && item.operationId === receipt.operationId)) return false;
    this.receipts.push(copy(receipt)); return true;
  }
}
