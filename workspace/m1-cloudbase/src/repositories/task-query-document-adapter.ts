import type { JsonValue } from '../shared/protocol';
import type {
  ReviewFeedbackRecord,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from '../task-core/types';
import type { TaskQueryRepository } from '../task-query/repository';
import type { QueryResourceOptionRecord, QueryTeacherGrantRecord } from '../task-query/types';
import type {
  DocumentDatabasePort,
  DocumentDatabaseReaderPort,
  VersionedDocument,
} from './document-database-port';
import { TaskCorePersistenceError, toTaskCorePersistenceError } from './persistence-error';
import {
  TASK_CORE_COLLECTIONS,
  assignmentByIdDocumentId,
  assignmentDocumentId,
  deterministicSubmissionId,
  feedbackDocumentId,
  submissionByIdDocumentId,
} from './task-core-document-adapter';

export function createTaskQueryDocumentRepository(
  database: DocumentDatabasePort,
): TaskQueryRepository {
  return new TaskQueryDocumentRepository(database);
}

class TaskQueryDocumentRepository implements TaskQueryRepository {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async listActiveTeacherGrants(
    organizationId: string,
    teacherId: string,
  ): Promise<readonly QueryTeacherGrantRecord[]> {
    return this.read(async (reader) => {
      const documents = await reader.find(TASK_CORE_COLLECTIONS.teacherGrants, {
        organizationId,
        teacherId,
        status: 'active',
        deletedAt: null,
      });
      const grants: QueryTeacherGrantRecord[] = [];
      for (const document of documents) {
        const classId = readString(document, 'classId');
        const classDocument = await reader.get(TASK_CORE_COLLECTIONS.classes, classId);
        if (!isVisible(classDocument, organizationId) || classDocument.status !== 'active') continue;
        grants.push({
          id: readDomainId(document),
          organizationId,
          teacherId: readString(document, 'teacherId'),
          classId,
          className: readString(classDocument, 'name'),
          permissions: readStringArray(document, 'permissions'),
          status: 'active',
        });
      }
      return grants;
    });
  }

  public async listTasks(organizationId: string): Promise<readonly TaskRecord[]> {
    return this.read(async (reader) => (await reader.find(TASK_CORE_COLLECTIONS.tasks, {
      organizationId,
      deletedAt: null,
    })).map((document) => decodeDocument<TaskRecord>(document, true)));
  }

  public async findTask(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    return this.read(async (reader) => {
      const document = await reader.get(TASK_CORE_COLLECTIONS.tasks, taskId);
      return isVisible(document, organizationId) ? decodeDocument<TaskRecord>(document, true) : null;
    });
  }

  public async listAssignments(organizationId: string): Promise<readonly TaskAssignmentRecord[]> {
    return this.read(async (reader) => (await reader.find(TASK_CORE_COLLECTIONS.assignments, {
      organizationId,
      deletedAt: null,
    })).map((document) => decodeDocument<TaskAssignmentRecord>(document, true)));
  }

  public async findAssignment(
    organizationId: string,
    taskId: string,
    studentId: string,
  ): Promise<TaskAssignmentRecord | null> {
    return this.read(async (reader) => {
      const document = await reader.get(
        TASK_CORE_COLLECTIONS.assignments,
        assignmentDocumentId(organizationId, taskId, studentId),
      );
      if (!isVisible(document, organizationId)) return null;
      const assignment = decodeDocument<TaskAssignmentRecord>(document, true);
      return assignment.taskId === taskId && assignment.studentId === studentId ? assignment : null;
    });
  }

  public async findAssignmentById(
    organizationId: string,
    assignmentId: string,
  ): Promise<TaskAssignmentRecord | null> {
    return this.read(async (reader) => {
      const document = await reader.get(
        TASK_CORE_COLLECTIONS.assignments,
        assignmentByIdDocumentId(organizationId, assignmentId),
      );
      if (!isVisible(document, organizationId)) return null;
      const assignment = decodeDocument<TaskAssignmentRecord>(document, true);
      return assignment.id === assignmentId ? assignment : null;
    });
  }

  public async listSubmissions(organizationId: string): Promise<readonly SubmissionRecord[]> {
    return this.read(async (reader) => (await reader.find(TASK_CORE_COLLECTIONS.submissions, {
      organizationId,
      deletedAt: null,
    })).map((document) => decodeDocument<SubmissionRecord>(document)));
  }

  public async findDraftSubmission(
    organizationId: string,
    assignmentId: string,
    submissionVersion: number,
  ): Promise<SubmissionRecord | null> {
    return this.read(async (reader) => {
      const submissionId = deterministicSubmissionId(assignmentId, submissionVersion);
      const document = await reader.get(
        TASK_CORE_COLLECTIONS.submissions,
        submissionByIdDocumentId(organizationId, submissionId),
      );
      if (!isVisible(document, organizationId)) return null;
      const submission = decodeDocument<SubmissionRecord>(document);
      return submission.assignmentId === assignmentId
        && submission.submissionVersion === submissionVersion
        && submission.status === 'draft'
        ? submission
        : null;
    });
  }

  public async findSubmission(
    organizationId: string,
    submissionId: string,
  ): Promise<SubmissionRecord | null> {
    return this.read(async (reader) => {
      const document = await reader.get(
        TASK_CORE_COLLECTIONS.submissions,
        submissionByIdDocumentId(organizationId, submissionId),
      );
      if (!isVisible(document, organizationId)) return null;
      const submission = decodeDocument<SubmissionRecord>(document);
      return submission.id === submissionId ? submission : null;
    });
  }

  public async findFeedback(
    organizationId: string,
    submissionId: string,
  ): Promise<ReviewFeedbackRecord | null> {
    return this.read(async (reader) => {
      const document = await reader.get(
        TASK_CORE_COLLECTIONS.feedback,
        feedbackDocumentId(organizationId, submissionId),
      );
      if (!isVisible(document, organizationId)) return null;
      const feedback = decodeDocument<ReviewFeedbackRecord>(document);
      return feedback.submissionId === submissionId ? feedback : null;
    });
  }

  public async listPublishedResourceOptions(
    organizationId: string,
  ): Promise<readonly QueryResourceOptionRecord[]> {
    return this.read(async (reader) => (await reader.find(TASK_CORE_COLLECTIONS.resources, {
      organizationId,
      status: 'published',
      deletedAt: null,
    })).map((document) => ({
      id: readDomainId(document),
      organizationId,
      title: readString(document, 'title'),
      type: readResourceType(document),
      status: 'published' as const,
      allowedClassIds: readStringArray(document, 'allowedClassIds'),
    })));
  }

  private async read<T>(work: (reader: DocumentDatabaseReaderPort) => Promise<T>): Promise<T> {
    try {
      return await work(this.database);
    } catch (error: unknown) {
      throw toTaskCorePersistenceError(error);
    }
  }
}

function decodeDocument<T>(document: VersionedDocument, includeVersion = false): T {
  const {
    _id: ignoredId,
    schemaVersion: ignoredSchemaVersion,
    version,
    deletedAt: ignoredDeletedAt,
    ...record
  } = document;
  void ignoredId;
  void ignoredSchemaVersion;
  void ignoredDeletedAt;
  return cloneJson(includeVersion ? { ...record, version } : record) as unknown as T;
}

function isVisible(
  document: VersionedDocument | null,
  organizationId: string,
): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}

function readDomainId(document: VersionedDocument): string {
  const id = document.id;
  return typeof id === 'string' && id.length > 0 ? id : document._id;
}

function readString(document: VersionedDocument, field: string): string {
  const value = document[field];
  if (typeof value !== 'string' || value.length === 0) throw new TaskCorePersistenceError('INTERNAL_ERROR');
  return value;
}

function readStringArray(document: VersionedDocument, field: string): readonly string[] {
  const value = document[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TaskCorePersistenceError('INTERNAL_ERROR');
  }
  return [...value] as string[];
}

function readResourceType(document: VersionedDocument): QueryResourceOptionRecord['type'] {
  const type = document.type;
  if (type !== 'reading' && type !== 'vocabulary' && type !== 'exercise') {
    throw new TaskCorePersistenceError('INTERNAL_ERROR');
  }
  return type;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}
