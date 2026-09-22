import { RepositoryTrustedActorResolver } from '../../src/auth/actor-resolver';
import { AdminSessionHandler } from '../../src/auth/admin-session-handler';
import { AuthSessionHandler } from '../../src/auth/auth-session-handler';
import { ContentQueryService } from '../../src/org-content/content-service';
import { OrganizationService } from '../../src/org-content/organization-service';
import {
  RelationshipService,
  type BindingCodeDigestPort,
  type BindingCodeGenerator,
} from '../../src/org-content/relationship-service';
import {
  createCloudBaseDocumentDatabase,
  type CloudBaseDocumentDatabaseOptions,
  type CloudBaseNativeDatabasePort,
} from '../../src/repositories/cloudbase-document-database';
import { LearningProgressService } from '../../src/learning-progress/service';
import { createLearningProgressDocumentRepository } from '../../src/repositories/learning-progress-document-adapter';
import {
  createOrgContentDocumentPersistence,
  createOrgContentDocumentRepository,
} from '../../src/repositories/org-content-document-adapter';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import type { DocumentDatabasePort } from '../../src/repositories/document-database-port';
import {
  createCloudBaseRuntimeAdapter,
  type CloudBasePlatformSdkPort,
  type TrustedBusinessSessionTokenCodec,
  type TrustedBusinessSessionSource,
} from '../../src/runtime/cloudbase-runtime-adapter';
import type {
  BusinessSessionRepository,
  Clock,
  IdentifierGenerator,
  IdentityRepository,
  SubjectDigestPort,
} from '../../src/runtime/ports';
import type { FunctionName } from '../../src/shared/protocol';
import type { RequestIdGenerator, ResultClock } from '../../src/shared/result';
import type { BatchReviewPreviewCodec } from '../../src/task-core/batch-review-preview';
import { TaskCoreService } from '../../src/task-core/task-core-service';
import { ParentTaskQueryService } from '../../src/task-query/parent-service';
import { ReviewQueryService, StudentTaskQueryService, TeacherTaskQueryService } from '../../src/task-query/service';
import type { CursorCodec } from '../../src/task-query/types';
import { TeacherStudentQueryService } from '../../src/teacher-students/service';
import type { AuthSessionFunctionDependencies } from '../auth-session/function-entry';
import type { AdminSessionFunctionDependencies } from '../admin-session/function-entry';
import type { TrustedFunctionDependencies } from './trusted-function';

export interface CloudBaseServerSdkPort extends CloudBasePlatformSdkPort {
  database(): CloudBaseNativeDatabasePort;
}

interface CommonCompositionOptions {
  readonly functionName: FunctionName;
  readonly sdk: CloudBaseServerSdkPort;
  readonly identities: IdentityRepository;
  readonly sessions: BusinessSessionRepository;
  readonly subjectDigest: SubjectDigestPort;
  readonly businessSession?: TrustedBusinessSessionSource;
  readonly clock?: Clock & ResultClock;
  readonly requestIds?: RequestIdGenerator;
  readonly documents?: DocumentDatabasePort;
  readonly database?: CloudBaseDocumentDatabaseOptions;
}

export interface CloudBaseTrustedCompositionOptions extends CommonCompositionOptions {}

export interface CloudBaseAuthCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'auth-session';
  readonly identifiers: IdentifierGenerator;
}

export interface CloudBaseAdminSessionCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'admin-session';
  readonly identifiers: IdentifierGenerator;
  readonly businessSession: TrustedBusinessSessionTokenCodec;
}

export interface CloudBaseTaskCoreCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'task-command' | 'submission-command' | 'review-command';
  readonly identifiers: IdentifierGenerator;
  readonly batchReviewPreviewCodec?: BatchReviewPreviewCodec;
}

export interface CloudBaseLearningProgressCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'learning-progress-query' | 'learning-progress-command';
  readonly identifiers: IdentifierGenerator;
}

export interface CloudBaseTaskQueryCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'task-query' | 'student-task-query' | 'review-query' | 'parent-query';
  readonly cursorCodec: CursorCodec;
  readonly batchReviewPreviewCodec?: BatchReviewPreviewCodec;
}

export interface CloudBaseContentQueryCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'content-query';
}

export interface CloudBaseTeacherStudentQueryCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'teacher-student-query';
  readonly cursorCodec: CursorCodec;
}

export interface CloudBaseOrganizationAdminCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'organization-admin';
  readonly identifiers: IdentifierGenerator;
}

export interface CloudBaseRelationshipCommandCompositionOptions extends CommonCompositionOptions {
  readonly functionName: 'relationship-command';
  readonly identifiers: IdentifierGenerator;
  readonly bindingCodes: BindingCodeGenerator & Required<Pick<BindingCodeGenerator, 'deriveSixDigits'>>;
  readonly bindingCodeDigest: BindingCodeDigestPort;
}

export interface CloudBaseTrustedFunctionInfrastructure extends TrustedFunctionDependencies {
  readonly documents: DocumentDatabasePort;
}

export interface CloudBaseAuthFunctionInfrastructure extends AuthSessionFunctionDependencies {
  readonly documents: DocumentDatabasePort;
}

export interface CloudBaseAdminSessionFunctionInfrastructure extends AdminSessionFunctionDependencies {
  readonly documents: DocumentDatabasePort;
}

export interface CloudBaseTaskCoreFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly handler: TaskCoreService;
}

export interface CloudBaseLearningProgressFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly handler: LearningProgressService;
}

export interface CloudBaseTaskQueryFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly teacherTaskHandler: TeacherTaskQueryService;
  readonly studentTaskHandler: StudentTaskQueryService;
  readonly reviewHandler: ReviewQueryService;
  readonly parentHandler: ParentTaskQueryService;
}

export interface CloudBaseContentQueryFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly handler: ContentQueryService;
}

export interface CloudBaseTeacherStudentQueryFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly handler: TeacherStudentQueryService;
}

export interface CloudBaseOrganizationAdminFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly handler: OrganizationService;
}

export interface CloudBaseRelationshipCommandFunctionInfrastructure extends CloudBaseTrustedFunctionInfrastructure {
  readonly handler: RelationshipService;
}

export function createCloudBaseTrustedFunctionInfrastructure(
  options: CloudBaseTrustedCompositionOptions,
): CloudBaseTrustedFunctionInfrastructure {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const requestIds = options.requestIds ?? new RuntimeRequestIdGenerator(options.functionName, clock);
  return {
    runtime: createCloudBaseRuntimeAdapter({
      functionName: options.functionName,
      sdk: options.sdk,
      ...(options.businessSession === undefined ? {} : { businessSession: options.businessSession }),
    }),
    actorResolver: new RepositoryTrustedActorResolver(
      options.identities,
      options.sessions,
      options.subjectDigest,
      clock,
      requestIds,
    ),
    clock,
    requestIds,
    documents: resolveDocuments(options),
  };
}

export function createCloudBaseAuthFunctionInfrastructure(
  options: CloudBaseAuthCompositionOptions,
): CloudBaseAuthFunctionInfrastructure {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const requestIds = options.requestIds ?? new RuntimeRequestIdGenerator(options.functionName, clock);
  return {
    runtime: createCloudBaseRuntimeAdapter({
      functionName: options.functionName,
      sdk: options.sdk,
      ...(options.businessSession === undefined ? {} : { businessSession: options.businessSession }),
    }),
    handler: new AuthSessionHandler(
      options.identities,
      options.sessions,
      options.subjectDigest,
      clock,
      options.identifiers,
      options.businessSession,
    ),
    clock,
    requestIds,
    documents: resolveDocuments(options),
  };
}

export function createCloudBaseAdminSessionFunctionInfrastructure(
  options: CloudBaseAdminSessionCompositionOptions,
): CloudBaseAdminSessionFunctionInfrastructure {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const requestIds = options.requestIds ?? new RuntimeRequestIdGenerator(options.functionName, clock);
  return {
    runtime: createCloudBaseRuntimeAdapter({
      functionName: options.functionName,
      sdk: options.sdk,
      businessSession: options.businessSession,
      businessSessionAudience: 'admin-console',
    }),
    handler: new AdminSessionHandler(
      options.identities,
      options.sessions,
      options.subjectDigest,
      clock,
      options.identifiers,
      options.businessSession,
    ),
    clock,
    requestIds,
    documents: resolveDocuments(options),
  };
}

/**
 * Produces dependencies that can be passed directly to task-command,
 * submission-command, or review-command entry factories. The native database
 * is resolved exactly once and every command uses the transactional repository.
 */
export function createCloudBaseTaskCoreFunctionInfrastructure(
  options: CloudBaseTaskCoreCompositionOptions,
): CloudBaseTaskCoreFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  return {
    ...infrastructure,
    handler: new TaskCoreService(
      createTaskCoreDocumentRepository(infrastructure.documents),
      options.identities,
      infrastructure.clock,
      options.identifiers,
      infrastructure.requestIds,
      options.batchReviewPreviewCodec,
    ),
  };
}

/**
 * Produces the shared persistent handler used by both learning-progress query
 * and command functions. Progress, idempotency and audit writes share one
 * native database transaction, so separate serverless instances observe the
 * same committed state.
 */
export function createCloudBaseLearningProgressFunctionInfrastructure(
  options: CloudBaseLearningProgressCompositionOptions,
): CloudBaseLearningProgressFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  return {
    ...infrastructure,
    handler: new LearningProgressService(
      createLearningProgressDocumentRepository(infrastructure.documents),
      infrastructure.clock,
      options.identifiers,
    ),
  };
}

/**
 * Builds all four read handlers over the same persistent repository. Cursor and
 * batch-preview codecs are supplied by server capabilities; this composition
 * never creates a process-local cursor store or embeds a signing key.
 */
export function createCloudBaseTaskQueryFunctionInfrastructure(
  options: CloudBaseTaskQueryCompositionOptions,
): CloudBaseTaskQueryFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  const repository = createTaskQueryDocumentRepository(infrastructure.documents);
  const shared = {
    repository,
    clock: infrastructure.clock,
    requestIds: infrastructure.requestIds,
    cursorCodec: options.cursorCodec,
  };
  return {
    ...infrastructure,
    teacherTaskHandler: new TeacherTaskQueryService(shared),
    studentTaskHandler: new StudentTaskQueryService(shared),
    reviewHandler: new ReviewQueryService({
      ...shared,
      ...(options.batchReviewPreviewCodec === undefined
        ? {}
        : { batchReviewPreviewCodec: options.batchReviewPreviewCodec }),
    }),
    parentHandler: new ParentTaskQueryService({ ...shared, identities: options.identities }),
  };
}

/** Builds content-query from the tenant-safe document repository. */
export function createCloudBaseContentQueryFunctionInfrastructure(
  options: CloudBaseContentQueryCompositionOptions,
): CloudBaseContentQueryFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  return {
    ...infrastructure,
    handler: new ContentQueryService(createOrgContentDocumentRepository(infrastructure.documents)),
  };
}

/**
 * Builds teacher-student-query over the shared organization and task read models.
 * The cursor codec is server-provided; no process-local cursor state or fallback
 * signing secret is created by this composition.
 */
export function createCloudBaseTeacherStudentQueryFunctionInfrastructure(
  options: CloudBaseTeacherStudentQueryCompositionOptions,
): CloudBaseTeacherStudentQueryFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  return {
    ...infrastructure,
    handler: new TeacherStudentQueryService({
      organizationRepository: createOrgContentDocumentRepository(infrastructure.documents),
      taskRepository: createTaskQueryDocumentRepository(infrastructure.documents),
      clock: infrastructure.clock,
      requestIds: infrastructure.requestIds,
      cursorCodec: options.cursorCodec,
    }),
  };
}

export function createCloudBaseOrganizationAdminFunctionInfrastructure(
  options: CloudBaseOrganizationAdminCompositionOptions,
): CloudBaseOrganizationAdminFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
  return {
    ...infrastructure,
    handler: new OrganizationService(
      persistence.repository,
      infrastructure.clock,
      options.identifiers,
      persistence.idempotency,
      createTaskQueryDocumentRepository(infrastructure.documents),
    ),
  };
}

export function createCloudBaseRelationshipCommandFunctionInfrastructure(
  options: CloudBaseRelationshipCommandCompositionOptions,
): CloudBaseRelationshipCommandFunctionInfrastructure {
  const infrastructure = createCloudBaseTrustedFunctionInfrastructure(options);
  const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
  return {
    ...infrastructure,
    handler: new RelationshipService(
      persistence.repository,
      infrastructure.clock,
      options.identifiers,
      options.bindingCodes,
      options.bindingCodeDigest,
      persistence.idempotency,
    ),
  };
}

function resolveDocuments(options: CommonCompositionOptions): DocumentDatabasePort {
  return options.documents ?? createCloudBaseDocumentDatabase(options.sdk.database(), options.database);
}

const SYSTEM_CLOCK: Clock & ResultClock = {
  nowIso: () => new Date().toISOString(),
};

class RuntimeRequestIdGenerator implements RequestIdGenerator {
  private sequence = 0;
  private readonly instanceNonce = Math.random().toString(36).slice(2, 10);

  public constructor(
    private readonly functionName: FunctionName,
    private readonly clock: ResultClock,
  ) {}

  public next(): string {
    this.sequence += 1;
    const timestamp = this.clock.nowIso().replace(/[^0-9]/g, '').slice(0, 17);
    return `req_${this.functionName.replace(/-/g, '_')}_${timestamp}_${this.instanceNonce}_${this.sequence}`;
  }
}
