import type { StudentWorkTransaction, StudentWorkUnitOfWork } from './repository';
import type { StudentWork, WorkMaterial, WorkReceipt } from './types';

export interface StudentWorkFixture {
  readonly memberships?: readonly Readonly<{ organizationId: string; studentId: string; classId: string; status: 'active' | 'inactive' }>[];
  readonly materials?: readonly WorkMaterial[];
  readonly works?: readonly StudentWork[];
  readonly receipts?: readonly WorkReceipt[];
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class InMemoryStudentWorkRepository implements StudentWorkUnitOfWork, StudentWorkTransaction {
  private state: { memberships: NonNullable<StudentWorkFixture['memberships']>; materials: WorkMaterial[];
    works: StudentWork[]; receipts: WorkReceipt[] };
  private tail: Promise<void> = Promise.resolve();

  public constructor(fixture: StudentWorkFixture = {}) {
    this.state = copy({ memberships: fixture.memberships ?? [], materials: [...(fixture.materials ?? [])],
      works: [...(fixture.works ?? [])], receipts: [...(fixture.receipts ?? [])] });
  }
  public async transaction<T>(work: (transaction: StudentWorkTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = copy(this.state);
    try { return await work(this); }
    catch (error: unknown) { this.state = before; throw error; }
    finally { release(); }
  }
  public async findActiveClassId(organizationId: string, studentId: string): Promise<string | null> {
    const active = this.state.memberships.filter(item => item.organizationId === organizationId
      && item.studentId === studentId && item.status === 'active');
    return active.length === 1 ? active[0]!.classId : null;
  }
  public async findMaterial(organizationId: string, materialId: string): Promise<WorkMaterial | null> {
    return copy(this.state.materials.find(item => item.organizationId === organizationId && item.id === materialId) ?? null);
  }
  public async listMaterials(organizationId: string): Promise<readonly WorkMaterial[]> {
    return copy(this.state.materials.filter(item => item.organizationId === organizationId));
  }
  public async findWork(organizationId: string, workId: string): Promise<StudentWork | null> {
    return copy(this.state.works.find(item => item.organizationId === organizationId && item.id === workId
      && !item.deletedAt) ?? null);
  }
  public async listStudentWorks(organizationId: string, studentId: string): Promise<readonly StudentWork[]> {
    return copy(this.state.works.filter(item => item.organizationId === organizationId && item.studentId === studentId
      && !item.deletedAt));
  }
  public async saveWork(work: StudentWork, expectedVersion: number): Promise<boolean> {
    const index = this.state.works.findIndex(item => item.organizationId === work.organizationId && item.id === work.id);
    if ((index < 0 && expectedVersion !== 0) || (index >= 0 && this.state.works[index]?.version !== expectedVersion)) return false;
    if (index < 0) this.state.works.push(copy(work)); else this.state.works[index] = copy(work);
    return true;
  }
  public async findReceipt(organizationId: string, studentId: string, operationId: string): Promise<WorkReceipt | null> {
    return copy(this.state.receipts.find(item => item.organizationId === organizationId && item.studentId === studentId
      && item.operationId === operationId) ?? null);
  }
  public async saveReceipt(receipt: WorkReceipt): Promise<boolean> {
    if (this.state.receipts.some(item => item.organizationId === receipt.organizationId
      && item.studentId === receipt.studentId && item.operationId === receipt.operationId)) return false;
    this.state.receipts.push(copy(receipt)); return true;
  }
  public snapshot() { return copy(this.state); }
}
