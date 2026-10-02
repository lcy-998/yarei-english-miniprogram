import type { ClassTextbookConfig, TextbookRecord, TeacherTextbookClass } from './types';
import type { TextbookCenterLayout } from './admin-types';

export interface TextbookTransaction {
  findPublishedCenterLayout(organizationId: string): Promise<TextbookCenterLayout | null>;
  listTeacherClassIds(organizationId: string, teacherId: string): Promise<readonly string[]>;
  listTeacherClasses(organizationId: string, teacherId: string): Promise<readonly TeacherTextbookClass[]>;
  findTeacherClass(organizationId: string, teacherId: string, classId: string): Promise<TeacherTextbookClass | null>;
  hasClassPermission(organizationId: string, teacherId: string, classId: string, permission: string): Promise<boolean>;
  listTextbookPage(organizationId: string, page: Readonly<{ limit: number; offset: number }>):
    Promise<Readonly<{ items: readonly (TextbookRecord | null)[]; nextOffset: number | null }>>;
  findTextbook(organizationId: string, textbookId: string): Promise<TextbookRecord | null>;
  findConfig(organizationId: string, classId: string): Promise<ClassTextbookConfig | null>;
  saveConfig(config: ClassTextbookConfig, expectedVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, teacherId: string, operationId: string): Promise<{ readonly fingerprint: string; readonly result: ClassTextbookConfig } | null>;
  saveReceipt(organizationId: string, teacherId: string, operationId: string, fingerprint: string, result: ClassTextbookConfig): Promise<boolean>;
}
export interface TextbookUnitOfWork { transaction<T>(work: (transaction: TextbookTransaction) => Promise<T>): Promise<T> }
