import type { BatchReviewPreviewCodec } from '../../src/task-core/batch-review-preview';
import type { CursorCodec } from '../../src/task-query/types';
import type { BindingCodeDigestPort, BindingCodeGenerator } from '../../src/org-content/relationship-service';
import type {
  BusinessSessionRepository,
  Clock,
  IdentifierGenerator,
  IdentityRepository,
  SubjectDigestPort,
} from '../../src/runtime/ports';
import type { FunctionName, ServiceResult } from '../../src/shared/protocol';
import type { AuthSessionFunctionDependencies } from '../auth-session/function-entry';
import type { AdminSessionFunctionDependencies } from '../admin-session/function-entry';
import type { ContentQueryHandler } from '../content-query/function-entry';
import type { LearningProgressCommandHandler } from '../learning-progress-command/function-entry';
import type { LearningProgressQueryHandler } from '../learning-progress-query/function-entry';
import type { OrganizationAdminHandler } from '../organization-admin/function-entry';
import type { ParentQueryHandler } from '../parent-query/function-entry';
import type { RelationshipCommandHandler } from '../relationship-command/function-entry';
import type { ReviewQueryHandler } from '../review-query/function-entry';
import type { StudentTaskQueryHandler } from '../student-task-query/function-entry';
import type { TaskQueryHandler } from '../task-query/function-entry';
import type { TeacherStudentQueryHandler } from '../teacher-student-query/function-entry';
import {
  createCloudBaseAuthFunctionInfrastructure,
  createCloudBaseAdminSessionFunctionInfrastructure,
  createCloudBaseContentQueryFunctionInfrastructure,
  createCloudBaseLearningProgressFunctionInfrastructure,
  createCloudBaseTaskQueryFunctionInfrastructure,
  createCloudBaseTaskCoreFunctionInfrastructure,
  createCloudBaseTeacherStudentQueryFunctionInfrastructure,
  createCloudBaseTrustedFunctionInfrastructure,
  type CloudBaseServerSdkPort,
  type CloudBaseTrustedFunctionInfrastructure,
} from './cloudbase-composition';
import type { TrustedBusinessSessionSource } from '../../src/runtime/cloudbase-runtime-adapter';
import type { DocumentDatabasePort } from '../../src/repositories/document-database-port';
import type { CloudBaseWorkStoragePort } from '../../src/student-work/cloudbase-recording-seal';
import type { CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';
import type { RequestIdGenerator, ResultClock } from '../../src/shared/result';

export interface CloudBaseApplicationHandlers {
  readonly 'content-query'?: ContentQueryHandler;
  readonly 'learning-progress-command'?: LearningProgressCommandHandler;
  readonly 'learning-progress-query'?: LearningProgressQueryHandler;
  readonly 'organization-admin'?: OrganizationAdminHandler;
  readonly 'parent-query'?: ParentQueryHandler;
  readonly 'relationship-command'?: RelationshipCommandHandler;
  readonly 'review-query'?: ReviewQueryHandler;
  readonly 'student-task-query'?: StudentTaskQueryHandler;
  readonly 'task-query'?: TaskQueryHandler;
  readonly 'teacher-student-query'?: TeacherStudentQueryHandler;
}

/**
 * Server-only capabilities installed by the deployment package. Nothing here is
 * populated from a function event. The event may carry only an opaque business
 * session token; this trusted source resolves it to an internal session id, and
 * callers still cannot inject actor, role, organization, or authorization data.
 */
export interface CloudBaseFunctionRuntimeCapabilities {
  readonly sdk: CloudBaseServerSdkPort;
  readonly identities: IdentityRepository;
  readonly sessions: BusinessSessionRepository;
  readonly subjectDigest: SubjectDigestPort;
  readonly identifiers: IdentifierGenerator;
  readonly documents?: DocumentDatabasePort;
  readonly recordingStorage?: CloudBaseWorkStoragePort;
  readonly playbackStorage?: CloudBasePlaybackSdkPort;
  readonly environmentId?: string;
  readonly clock?: Clock & ResultClock;
  readonly requestIds?: RequestIdGenerator;
  readonly businessSession?: TrustedBusinessSessionSource;
  readonly batchReviewPreviewCodec?: BatchReviewPreviewCodec;
  readonly queryCursorCodec?: CursorCodec;
  readonly bindingCodes?: BindingCodeGenerator & Required<Pick<BindingCodeGenerator, 'deriveSixDigits'>>;
  readonly bindingCodeDigest?: BindingCodeDigestPort;
  readonly handlers?: CloudBaseApplicationHandlers;
}

export type CloudBaseRuntimeProvider = (
  functionName: FunctionName,
) => CloudBaseFunctionRuntimeCapabilities | null | Promise<CloudBaseFunctionRuntimeCapabilities | null>;

export type CloudBaseFunctionMain<T> = (event: unknown) => Promise<ServiceResult<T>>;

type CommonInfrastructure = CloudBaseTrustedFunctionInfrastructure;

const PROVIDER_KEY = '__YAREI_CLOUDBASE_RUNTIME_PROVIDER__';

let installedProvider: CloudBaseRuntimeProvider | null = null;

/**
 * Deployment bootstrap may install one reviewed provider before invoking main.
 * Tests use the same seam; callers still cannot supply capabilities in event.
 */
export function installCloudBaseRuntimeProvider(provider: CloudBaseRuntimeProvider | null): void {
  installedProvider = provider;
}

export function createDefaultCloudBaseFunction<T>(
  functionName: FunctionName,
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: CommonInfrastructure,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configure(functionName, compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseAuthFunction<T>(
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    dependencies: AuthSessionFunctionDependencies,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureAuth(compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseAdminSessionFunction<T>(
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    dependencies: AdminSessionFunctionDependencies,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureAdminSession(compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseTaskCoreFunction<T>(
  functionName: 'task-command' | 'submission-command' | 'review-command',
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseTaskCoreFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureTaskCore(functionName, compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseLearningProgressFunction<T>(
  functionName: 'learning-progress-query' | 'learning-progress-command',
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseLearningProgressFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureLearningProgress(functionName, compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseTaskQueryFunction<T>(
  functionName: 'task-query' | 'student-task-query' | 'review-query' | 'parent-query',
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseTaskQueryFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureTaskQuery(functionName, compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseContentQueryFunction<T>(
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseContentQueryFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureContentQuery(compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function createDefaultCloudBaseTeacherStudentQueryFunction<T>(
  unavailable: CloudBaseFunctionMain<T>,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseTeacherStudentQueryFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): CloudBaseFunctionMain<T> {
  let configured: CloudBaseFunctionMain<T> | null = null;
  let pending: Promise<CloudBaseFunctionMain<T> | null> | null = null;

  return async (event: unknown): Promise<ServiceResult<T>> => {
    const request = normalizeCloudBaseEvent(event);
    if (configured === null) {
      const rejected = await rejectInvalidRequest(unavailable, request);
      if (rejected !== null) return rejected;
      pending ??= configureTeacherStudentQuery(compose);
      configured = await pending;
      pending = null;
    }
    if (configured === null) return unavailable(request);
    return configured(request);
  };
}

export function requireCloudBaseHandler<K extends keyof CloudBaseApplicationHandlers>(
  capabilities: CloudBaseFunctionRuntimeCapabilities,
  functionName: K,
): NonNullable<CloudBaseApplicationHandlers[K]> {
  const handler = capabilities.handlers?.[functionName];
  if (handler === undefined) throw new CloudBaseRuntimeUnavailableError();
  return handler as NonNullable<CloudBaseApplicationHandlers[K]>;
}

class CloudBaseRuntimeUnavailableError extends Error {
  public constructor() {
    super('CloudBase runtime capability is unavailable.');
    this.name = 'CloudBaseRuntimeUnavailableError';
  }
}

async function configure<T>(
  functionName: FunctionName,
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: CommonInfrastructure,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities(functionName);
    if (capabilities === null) return null;
    const infrastructure = createCloudBaseTrustedFunctionInfrastructure({
      functionName,
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureAuth<T>(
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    dependencies: AuthSessionFunctionDependencies,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities('auth-session');
    if (capabilities === null
      || capabilities.businessSession === undefined
      || typeof capabilities.businessSession.issueBusinessSessionToken !== 'function') return null;
    const infrastructure = createCloudBaseAuthFunctionInfrastructure({
      functionName: 'auth-session',
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      identifiers: capabilities.identifiers,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureAdminSession<T>(
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    dependencies: AdminSessionFunctionDependencies,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities('admin-session');
    if (capabilities === null
      || capabilities.businessSession === undefined
      || typeof capabilities.businessSession.issueBusinessSessionToken !== 'function') return null;
    const businessSession = capabilities.businessSession as Required<Pick<
      TrustedBusinessSessionSource,
      'getBusinessSessionId' | 'issueBusinessSessionToken'
    >>;
    const infrastructure = createCloudBaseAdminSessionFunctionInfrastructure({
      functionName: 'admin-session',
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      identifiers: capabilities.identifiers,
      businessSession,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureTaskCore<T>(
  functionName: 'task-command' | 'submission-command' | 'review-command',
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseTaskCoreFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities(functionName);
    if (capabilities === null) return null;
    if (functionName === 'review-command' && capabilities.batchReviewPreviewCodec === undefined) return null;
    const infrastructure = createCloudBaseTaskCoreFunctionInfrastructure({
      functionName,
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      identifiers: capabilities.identifiers,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
      ...(capabilities.batchReviewPreviewCodec === undefined
        ? {}
        : { batchReviewPreviewCodec: capabilities.batchReviewPreviewCodec }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureLearningProgress<T>(
  functionName: 'learning-progress-query' | 'learning-progress-command',
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseLearningProgressFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities(functionName);
    if (capabilities === null) return null;
    const infrastructure = createCloudBaseLearningProgressFunctionInfrastructure({
      functionName,
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      identifiers: capabilities.identifiers,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureTaskQuery<T>(
  functionName: 'task-query' | 'student-task-query' | 'review-query' | 'parent-query',
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseTaskQueryFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities(functionName);
    if (capabilities === null || capabilities.queryCursorCodec === undefined) return null;
    if (functionName === 'review-query' && capabilities.batchReviewPreviewCodec === undefined) return null;
    const infrastructure = createCloudBaseTaskQueryFunctionInfrastructure({
      functionName,
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      cursorCodec: capabilities.queryCursorCodec,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.batchReviewPreviewCodec === undefined
        ? {}
        : { batchReviewPreviewCodec: capabilities.batchReviewPreviewCodec }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureContentQuery<T>(
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseContentQueryFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities('content-query');
    if (capabilities === null) return null;
    const infrastructure = createCloudBaseContentQueryFunctionInfrastructure({
      functionName: 'content-query',
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function configureTeacherStudentQuery<T>(
  compose: (
    capabilities: CloudBaseFunctionRuntimeCapabilities,
    infrastructure: ReturnType<typeof createCloudBaseTeacherStudentQueryFunctionInfrastructure>,
  ) => CloudBaseFunctionMain<T>,
): Promise<CloudBaseFunctionMain<T> | null> {
  try {
    const capabilities = await resolveCapabilities('teacher-student-query');
    if (capabilities === null || capabilities.queryCursorCodec === undefined) return null;
    const infrastructure = createCloudBaseTeacherStudentQueryFunctionInfrastructure({
      functionName: 'teacher-student-query',
      sdk: capabilities.sdk,
      identities: capabilities.identities,
      sessions: capabilities.sessions,
      subjectDigest: capabilities.subjectDigest,
      cursorCodec: capabilities.queryCursorCodec,
      ...(capabilities.documents === undefined ? {} : { documents: capabilities.documents }),
      ...(capabilities.clock === undefined ? {} : { clock: capabilities.clock }),
      ...(capabilities.requestIds === undefined ? {} : { requestIds: capabilities.requestIds }),
      ...(capabilities.businessSession === undefined ? {} : { businessSession: capabilities.businessSession }),
    });
    return compose(capabilities, infrastructure);
  } catch {
    return null;
  }
}

async function resolveCapabilities(functionName: FunctionName): Promise<CloudBaseFunctionRuntimeCapabilities | null> {
  const provider = installedProvider ?? readGlobalProvider();
  if (provider === null) return null;
  return provider(functionName);
}

function readGlobalProvider(): CloudBaseRuntimeProvider | null {
  const root = globalThis as unknown as Record<string, unknown>;
  const candidate = root[PROVIDER_KEY];
  return typeof candidate === 'function' ? candidate as CloudBaseRuntimeProvider : null;
}

async function rejectInvalidRequest<T>(
  unavailable: CloudBaseFunctionMain<T>,
  event: unknown,
): Promise<ServiceResult<T> | null> {
  const result = await unavailable(event);
  return !result.ok && result.error.code === 'VALIDATION_ERROR' ? result : null;
}

function normalizeCloudBaseEvent(event: unknown): unknown {
  if (!isPlainRecord(event) || !('tcbContext' in event)) return event;
  const { tcbContext: _tcbContext, ...request } = event;
  return request;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
