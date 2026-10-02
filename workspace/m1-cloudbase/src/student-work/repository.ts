import type { StudentWork, WorkMaterial, WorkReceipt } from './types';

export interface StudentWorkTransaction {
  findActiveClassId(organizationId: string, studentId: string): Promise<string | null>;
  findMaterial(organizationId: string, materialId: string): Promise<WorkMaterial | null>;
  listMaterials(organizationId: string): Promise<readonly WorkMaterial[]>;
  findWork(organizationId: string, workId: string): Promise<StudentWork | null>;
  listStudentWorks(organizationId: string, studentId: string): Promise<readonly StudentWork[]>;
  saveWork(work: StudentWork, expectedVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, studentId: string, operationId: string): Promise<WorkReceipt | null>;
  saveReceipt(receipt: WorkReceipt): Promise<boolean>;
}

export interface StudentWorkUnitOfWork {
  transaction<T>(work: (transaction: StudentWorkTransaction) => Promise<T>): Promise<T>;
}

export interface RecordingSealPort {
  inspectAndSeal(input: Readonly<{ stagingFileId: string; stagingPath: string;
    organizationId: string; studentId: string; workId: string }>): Promise<import('./types').SealedRecording>;
}

export interface WorkPlaybackPort {
  temporaryUrl(fileId: string): Promise<string>;
}
