import type { BindingCodeDigestPort, BindingCodeGenerator } from '../../src/org-content/relationship-service';
import {
  createCloudBaseDocumentDatabase,
  type CloudBaseDocumentDatabaseOptions,
  type CloudBaseNativeDatabasePort,
} from '../../src/repositories/cloudbase-document-database';
import type { Clock, IdentifierGenerator, SubjectDigestPort } from '../../src/runtime/ports';
import type { RequestIdGenerator, ResultClock } from '../../src/shared/result';
import type { BatchReviewPreviewCodec } from '../../src/task-core/batch-review-preview';
import type { CursorCodec } from '../../src/task-query/types';
import type { TrustedBusinessSessionTokenCodec } from '../../src/runtime/cloudbase-runtime-adapter';
import type { CloudBaseServerSdkPort } from './cloudbase-composition';
import type { CloudBaseWorkStoragePort } from '../../src/student-work/cloudbase-recording-seal';
import type { CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';
import type { CloudBaseDeletePort } from '../../src/media-retention/cloudbase-storage';
import type { CloudBaseStagingMetadataPort } from '../../src/media-retention/cloudbase-storage';
import { createLearningProgressDocumentRepository } from '../../src/repositories/learning-progress-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import type { CloudBaseVoiceInvokePort } from '../../src/pronunciation/cloudbase-adapters';
import { CloudBasePronunciationInferenceMedia } from '../../src/pronunciation/cloudbase-adapters';
import { PronunciationAsyncJobService } from '../../src/pronunciation/async-job-service';
import { LongPronunciationInference } from '../../src/pronunciation/long-inference-adapter';
import { HmacPronunciationJobDispatcher } from '../../src/pronunciation/job-wire';
import { DirectScfPronunciationTransport } from '../../src/pronunciation/scf-direct-transport';
import { DocumentPronunciationRepository } from '../../src/pronunciation/document-repository';
import { DocumentPronunciationSource } from '../../src/pronunciation/source-adapter';
import { FreshPronunciationWorkerIdentity } from '../../src/pronunciation/worker-identity-adapter';
import { PronunciationError } from '../../src/pronunciation/types';
import { CloudBaseTeacherSuggestionInference } from '../../src/teacher-ai/cloudbase-inference';
import { DocumentTeacherSuggestionStore } from '../../src/teacher-ai/document-store';
import { AutomaticSuggestionDispatcher, AutomaticSuggestionWorker } from '../../src/teacher-ai/automatic-worker';
import { TeacherSuggestionService } from '../../src/teacher-ai/service';
import { TeacherPrivateVideoService } from '../../src/teacher-media/private-video';
import { CloudBasePrivateVideoProcessor } from '../../src/teacher-media/private-video-processor';
import { ReviewQueryService } from '../../src/task-query/service';
import { currentScfInvocationContext } from './scf-invocation-context';
import { createPronunciationWorkerFunction } from '../pronunciation-worker/function-entry';
import { createM2BusinessReadIsolation } from '../../src/seed/m2-business-read-isolation';
import {
  type CloudBaseFunctionRuntimeCapabilities,
  type CloudBaseRuntimeProvider,
  type NativeAccountProviderFactory,
  installCloudBaseRuntimeProvider,
} from './default-cloudbase-function';
import { createIdentitySessionRuntimeCapabilities } from './identity-session-capabilities';

/** Current official CloudBase server package used by deployed Node functions. */
export const CLOUDBASE_JS_SDK_PACKAGE = '@cloudbase/node-sdk';
export const CLOUDBASE_JS_SDK_VERSION = '3.18.3';

export interface CloudBaseNodeCurrentUserInfo {
  readonly uid?: unknown;
  readonly customUserId?: unknown;
}

export interface CloudBaseNodeAuthPort {
  getUserInfo(): CloudBaseNodeCurrentUserInfo;
}

export interface CloudBaseNodeApplicationPort {
  auth(): CloudBaseNodeAuthPort;
  database(): CloudBaseNativeDatabasePort;
  downloadFile?: CloudBaseWorkStoragePort['downloadFile'];
  uploadFile?: CloudBaseWorkStoragePort['uploadFile'];
  deleteFile?: CloudBaseDeletePort['deleteFile'];
  getUploadMetadata?: CloudBaseStagingMetadataPort['getUploadMetadata'];
  getTempFileURL?: CloudBasePlaybackSdkPort['getTempFileURL'];
  callFunction?: CloudBaseVoiceInvokePort['callFunction'];
}

/**
 * Structural surface of the Node entry exposed by `@cloudbase/js-sdk` v3. The deployment package owns the
 * actual import, so this source compiles and remains testable before that runtime
 * dependency is approved and installed.
 */
export interface CloudBaseNodeSdkModulePort {
  getCloudbaseContext(context?: unknown): Readonly<Record<string, unknown>>;
  init(options: Readonly<{ env: string }>): CloudBaseNodeApplicationPort;
}

export interface CloudBaseDeploymentCryptographyPorts {
  readonly subjectDigest: SubjectDigestPort;
  readonly identifiers: IdentifierGenerator;
  readonly businessSession: TrustedBusinessSessionTokenCodec;
  readonly queryCursorCodec: CursorCodec;
  readonly batchReviewPreviewCodec: BatchReviewPreviewCodec;
  readonly bindingCodes: BindingCodeGenerator & Required<Pick<BindingCodeGenerator, 'deriveSixDigits'>>;
  readonly bindingCodeDigest: BindingCodeDigestPort;
}

export interface CloudBaseNodeDeploymentOptions {
  /** Production passes `() => require('@cloudbase/js-sdk')`; tests inject a fake module. */
  readonly loadSdk: () => unknown;
  readonly environmentId?: string;
  readonly clock: Clock & ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly cryptography: CloudBaseDeploymentCryptographyPorts;
  readonly database?: CloudBaseDocumentDatabaseOptions;
  /** Supplied only by a separately reviewed M3 voice deployment composition. */
  readonly pronunciationJobs?: CloudBaseFunctionRuntimeCapabilities['pronunciationJobs'];
  readonly pronunciationWorker?: CloudBaseFunctionRuntimeCapabilities['pronunciationWorker'];
  readonly pronunciationRuntime?: Readonly<{
    internalSecret: string;
    allowedMediaHost: string;
    leaseMs: number;
  }>;
  readonly teacherSuggestionRuntime?: Readonly<{
    internalSecret: string;
    modelVersion: string;
    promptVersion: string;
  }>;
  readonly nativeAccountProviderFactory?: NativeAccountProviderFactory;
}

/**
 * Initializes the official server SDK for the current event-function environment
 * without reading or accepting an envId. Caller identity is read on every request
 * from `app.auth().getUserInfo().uid`; some CloudBase account types expose the
 * same stable caller identifier as `customUserId`, so it is used only as a
 * fallback. OPENID is deliberately not projected into the runtime port. All
 * secret-bearing capabilities remain explicit injections.
 */
export function createCloudBaseNodeDeploymentProvider(
  options: CloudBaseNodeDeploymentOptions,
): CloudBaseRuntimeProvider {
  assertOptions(options);
  const sdkModule = requireSdkModule(options.loadSdk());
  const currentEnvironment = readCurrentEnvironment(sdkModule.getCloudbaseContext(), options.environmentId);
  const app = requireApplication(sdkModule.init({ env: currentEnvironment }));
  const nativeDatabase = requireDatabase(app.database());
  const sdk: CloudBaseServerSdkPort = {
    // Resolve auth for every invocation. A warm function instance must never
    // retain a caller-bound auth object from a previous request.
    getWXContext: () => ({ UID: readUid(requireAuth(app.auth()).getUserInfo()) }),
    database: () => nativeDatabase,
  };
  const documents = createM2BusinessReadIsolation(createCloudBaseDocumentDatabase(nativeDatabase, options.database));
  const teacherSuggestionStore = new DocumentTeacherSuggestionStore(documents);
  const base = createIdentitySessionRuntimeCapabilities({
    sdk,
    documents,
    clock: options.clock,
    requestIds: options.requestIds,
    cryptography: {
      subjectDigest: options.cryptography.subjectDigest,
      identifiers: options.cryptography.identifiers,
      businessSession: options.cryptography.businessSession,
    },
  });
  const pronunciationRuntime = options.pronunciationRuntime
    ? createPronunciationRuntime(options.pronunciationRuntime, base, documents, app, sdkModule)
    : null;
  const teacherSuggestionRuntime = options.teacherSuggestionRuntime
    ? createTeacherSuggestionRuntime(options.teacherSuggestionRuntime, sdkModule)
    : null;
  const teacherSuggestionWorker = teacherSuggestionRuntime && base.clock && base.requestIds
    ? new AutomaticSuggestionWorker(base.identities,
      createTaskQueryDocumentRepository(documents),
      new TeacherSuggestionService(new ReviewQueryService({
        repository: createTaskQueryDocumentRepository(documents),
        clock: base.clock, requestIds: base.requestIds,
      }), createTaskQueryDocumentRepository(documents), teacherSuggestionRuntime.inference,
      teacherSuggestionStore, base.clock, base.identifiers,
      teacherSuggestionRuntime.modelVersion, teacherSuggestionRuntime.promptVersion),
      options.teacherSuggestionRuntime!.internalSecret,
      { nowUnix: () => Math.floor(Date.now() / 1000) }) : null;
  const videoEnabled = process.env.TEACHER_VIDEO_ENABLED === '1';
  const videoBinaries = { clamScan: process.env.TEACHER_VIDEO_CLAMSCAN_BIN ?? '',
    ffmpeg: process.env.TEACHER_VIDEO_FFMPEG_BIN ?? '',
    ffprobe: process.env.TEACHER_VIDEO_FFPROBE_BIN ?? '' };
  const videoStorage = typeof app.downloadFile === 'function' && typeof app.uploadFile === 'function'
    ? { downloadFile: (input: Parameters<CloudBaseWorkStoragePort['downloadFile']>[0]) => app.downloadFile!(input),
      uploadFile: (input: Parameters<CloudBaseWorkStoragePort['uploadFile']>[0]) => app.uploadFile!(input) }
    : null;
  const videoProcessor = videoEnabled && videoStorage && videoBinaries.clamScan
    && videoBinaries.ffmpeg && videoBinaries.ffprobe
    ? new CloudBasePrivateVideoProcessor(videoStorage, currentEnvironment, videoBinaries) : null;
  const videoTransport = videoEnabled ? createPrivateVideoTransport(sdkModule) : null;
  const videoDispatcher = videoTransport
    ? { dispatch: (job: Readonly<{ organizationId: string; videoId: string;
      processingToken: string }>) => videoTransport.invokePrivateVideoEvent(job) } : null;
  const videoService = videoProcessor === null ? null
    : new TeacherPrivateVideoService(documents, videoProcessor,
      options.clock, createOrgContentDocumentRepository(documents),
      typeof app.getTempFileURL === 'function'
        ? { getTempFileURL: (input: Parameters<CloudBasePlaybackSdkPort['getTempFileURL']>[0]) =>
          app.getTempFileURL!(input) } : undefined, videoDispatcher ?? undefined);
  const capabilities: CloudBaseFunctionRuntimeCapabilities = Object.freeze({
    ...base,
    ...(options.nativeAccountProviderFactory ? { nativeAccountProvider:
      options.nativeAccountProviderFactory({ environmentId: currentEnvironment,
        subjectDigest: base.subjectDigest,
        getRuntimeContext: () => sdkModule.getCloudbaseContext(currentScfInvocationContext()) ?? {} }) } : {}),
    ...(typeof app.downloadFile === 'function' && typeof app.uploadFile === 'function'
      ? { recordingStorage: { downloadFile: (input: Parameters<CloudBaseWorkStoragePort['downloadFile']>[0]) => app.downloadFile!(input),
        uploadFile: (input: Parameters<CloudBaseWorkStoragePort['uploadFile']>[0]) => app.uploadFile!(input) }, environmentId: currentEnvironment } : {}),
    ...(typeof app.getTempFileURL === 'function'
      ? { playbackStorage: { getTempFileURL: (input: Parameters<CloudBasePlaybackSdkPort['getTempFileURL']>[0]) => app.getTempFileURL!(input) } } : {}),
    ...(typeof app.callFunction === 'function'
      ? { voiceInvoker: { callFunction: (input: Parameters<CloudBaseVoiceInvokePort['callFunction']>[0]) => app.callFunction!(input) } } : {}),
    ...(options.pronunciationJobs ? { pronunciationJobs: options.pronunciationJobs }
      : pronunciationRuntime ? { pronunciationJobs: pronunciationRuntime.jobs } : {}),
    ...(options.pronunciationWorker ? { pronunciationWorker: options.pronunciationWorker }
      : pronunciationRuntime ? { pronunciationWorker: pronunciationRuntime.worker } : {}),
    teacherSuggestionStore,
    ...(teacherSuggestionRuntime === null ? {} : { teacherSuggestion: teacherSuggestionRuntime }),
    ...(teacherSuggestionWorker === null ? {} : { teacherSuggestionWorker: (event: unknown) =>
      teacherSuggestionWorker.run(event) }),
    ...(videoDispatcher === null ? {} : { privateVideoDispatcher: videoDispatcher }),
    ...(videoService === null ? {} : { privateVideoWorker: (event: unknown) => {
      if (typeof event !== 'object' || event === null || Array.isArray(event)) {
        return Promise.resolve({ ok: false, status: 'stale' });
      }
      return videoService.processAccepted(event as Readonly<{ organizationId: string;
        videoId: string; processingToken: string }>).then(status => ({ ok: status === 'ready', status }));
    } }),
    queryCursorCodec: options.cryptography.queryCursorCodec,
    batchReviewPreviewCodec: options.cryptography.batchReviewPreviewCodec,
    bindingCodes: options.cryptography.bindingCodes,
    bindingCodeDigest: options.cryptography.bindingCodeDigest,
  });
  return () => capabilities;
}

function createPrivateVideoTransport(sdkModule: CloudBaseNodeSdkModulePort): DirectScfPronunciationTransport | null {
  const getPlatformContext = (): Readonly<Record<string, unknown>> =>
    sdkModule.getCloudbaseContext(currentScfInvocationContext()) ?? {};
  const context = getPlatformContext();
  const region = typeof context.TENCENTCLOUD_REGION === 'string'
    ? context.TENCENTCLOUD_REGION : process.env.TENCENTCLOUD_REGION ?? '';
  const namespace = typeof context.SCF_NAMESPACE === 'string'
    ? context.SCF_NAMESPACE : process.env.SCF_NAMESPACE ?? '';
  if (!/^ap-[a-z-]+$/.test(region) || !namespace) return null;
  return new DirectScfPronunciationTransport(() => {
    const current = getPlatformContext();
    const secretId = current.TENCENTCLOUD_SECRETID;
    const secretKey = current.TENCENTCLOUD_SECRETKEY;
    const sessionToken = current.TENCENTCLOUD_SESSIONTOKEN;
    if (typeof secretId !== 'string' || typeof secretKey !== 'string'
      || typeof sessionToken !== 'string') {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'private_video_runtime_credentials_missing');
    }
    return { secretId, secretKey, sessionToken };
  }, region, namespace);
}

function createTeacherSuggestionRuntime(config: NonNullable<CloudBaseNodeDeploymentOptions['teacherSuggestionRuntime']>,
  sdkModule: CloudBaseNodeSdkModulePort) {
  const getPlatformContext = (): Readonly<Record<string, unknown>> =>
    sdkModule.getCloudbaseContext(currentScfInvocationContext()) ?? {};
  const context = getPlatformContext();
  const region = typeof context.TENCENTCLOUD_REGION === 'string'
    ? context.TENCENTCLOUD_REGION : typeof process.env.TENCENTCLOUD_REGION === 'string'
      ? process.env.TENCENTCLOUD_REGION : '';
  const namespace = typeof context.SCF_NAMESPACE === 'string'
    ? context.SCF_NAMESPACE : typeof process.env.SCF_NAMESPACE === 'string'
      ? process.env.SCF_NAMESPACE : '';
  if (config.internalSecret.length < 32 || !config.modelVersion || !config.promptVersion
    || !/^ap-[a-z-]+$/.test(region) || !namespace) throw new CloudBaseDeploymentConfigurationError();
  const credentials = () => {
    const runtime = getPlatformContext();
    const secretId = runtime.TENCENTCLOUD_SECRETID;
    const secretKey = runtime.TENCENTCLOUD_SECRETKEY;
    const sessionToken = runtime.TENCENTCLOUD_SESSIONTOKEN;
    if (typeof secretId !== 'string' || typeof secretKey !== 'string'
      || typeof sessionToken !== 'string') {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'teacher_ai_runtime_credentials_missing');
    }
    return { secretId, secretKey, sessionToken };
  };
  const transport = new DirectScfPronunciationTransport(credentials, region, namespace);
  return { inference: new CloudBaseTeacherSuggestionInference(
    transport, config.internalSecret,
    config.modelVersion, config.promptVersion, { nowUnix: () => Math.floor(Date.now() / 1000) }),
    dispatcher: new AutomaticSuggestionDispatcher(transport, config.internalSecret,
      { nowUnix: () => Math.floor(Date.now() / 1000) }),
    modelVersion: config.modelVersion,
    promptVersion: config.promptVersion };
}

function createPronunciationRuntime(config: NonNullable<CloudBaseNodeDeploymentOptions['pronunciationRuntime']>,
  base: CloudBaseFunctionRuntimeCapabilities, documents: ReturnType<typeof createCloudBaseDocumentDatabase>,
  app: CloudBaseNodeApplicationPort, sdkModule: CloudBaseNodeSdkModulePort) {
  const getPlatformContext = (): Readonly<Record<string, unknown>> =>
    sdkModule.getCloudbaseContext(currentScfInvocationContext()) ?? {};
  const platformContext = getPlatformContext();
  const region = typeof platformContext.TENCENTCLOUD_REGION === 'string'
    ? platformContext.TENCENTCLOUD_REGION
    : typeof process.env.TENCENTCLOUD_REGION === 'string' ? process.env.TENCENTCLOUD_REGION : '';
  const namespace = typeof platformContext.SCF_NAMESPACE === 'string'
    ? platformContext.SCF_NAMESPACE
    : typeof process.env.SCF_NAMESPACE === 'string' ? process.env.SCF_NAMESPACE : '';
  if (config.internalSecret.length < 32 || !config.allowedMediaHost || !region || !namespace
    || !Number.isSafeInteger(config.leaseMs)
    || config.leaseMs < 310000 || config.leaseMs > 900000 || !base.clock
    || !base.identities || typeof app.getTempFileURL !== 'function'
    || typeof sdkModule.getCloudbaseContext !== 'function') {
    throw new CloudBaseDeploymentConfigurationError();
  }
  const credentials = () => {
    const context = getPlatformContext();
    const secretId = context.TENCENTCLOUD_SECRETID;
    const secretKey = context.TENCENTCLOUD_SECRETKEY;
    const sessionToken = context.TENCENTCLOUD_SESSIONTOKEN;
    if (typeof secretId !== 'string' || typeof secretKey !== 'string'
      || typeof sessionToken !== 'string') {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_runtime_credentials_missing');
    }
    return { secretId, secretKey, sessionToken };
  };
  const transport = new DirectScfPronunciationTransport(credentials,
  region, namespace, globalThis.fetch,
  { nowUnix: () => Math.floor(Date.now() / 1000) });
  const repository = new DocumentPronunciationRepository(documents);
  const source = new DocumentPronunciationSource(
    createTaskQueryDocumentRepository(documents), createLearningProgressDocumentRepository(documents),
    documents, base.identities, base.clock);
  const inference = new LongPronunciationInference(
    new CloudBasePronunciationInferenceMedia({ getTempFileURL: input => app.getTempFileURL!(input) }),
    transport, config.internalSecret, config.allowedMediaHost,
    { nowUnix: () => Math.floor(Date.now() / 1000) });
  const jobs = new PronunciationAsyncJobService(repository, source,
    new HmacPronunciationJobDispatcher(transport, config.internalSecret,
      { nowUnix: () => Math.floor(Date.now() / 1000) }),
    inference, new FreshPronunciationWorkerIdentity(base.identities), base.clock, config.leaseMs);
  const worker = createPronunciationWorkerFunction({ jobs, secret: config.internalSecret,
    clock: { nowUnix: () => Math.floor(Date.now() / 1000) } });
  return { jobs, worker };
}

/** Installs the reviewed provider once during a cloud-function cold start. */
export function bootstrapCloudBaseNodeDeployment(
  options: CloudBaseNodeDeploymentOptions,
): CloudBaseRuntimeProvider {
  const provider = createCloudBaseNodeDeploymentProvider(options);
  installCloudBaseRuntimeProvider(provider);
  return provider;
}

class CloudBaseDeploymentConfigurationError extends Error {
  public constructor() {
    super('CloudBase deployment capabilities are unavailable.');
    this.name = 'CloudBaseDeploymentConfigurationError';
  }
}

function assertOptions(options: CloudBaseNodeDeploymentOptions): void {
  const unsafe = options as unknown as Partial<CloudBaseNodeDeploymentOptions>;
  const cryptography = unsafe.cryptography as Partial<CloudBaseDeploymentCryptographyPorts> | undefined;
  if (typeof unsafe.loadSdk !== 'function'
    || typeof unsafe.clock?.nowIso !== 'function'
    || typeof unsafe.requestIds?.next !== 'function'
    || cryptography === undefined
    || typeof cryptography.subjectDigest?.digest !== 'function'
    || typeof cryptography.identifiers?.next !== 'function'
    || typeof cryptography.businessSession?.getBusinessSessionId !== 'function'
    || typeof cryptography.businessSession?.issueBusinessSessionToken !== 'function'
    || typeof cryptography.queryCursorCodec?.encode !== 'function'
    || typeof cryptography.queryCursorCodec?.decode !== 'function'
    || typeof cryptography.batchReviewPreviewCodec?.encode !== 'function'
    || typeof cryptography.batchReviewPreviewCodec?.decode !== 'function'
    || typeof cryptography.bindingCodes?.nextSixDigits !== 'function'
    || typeof cryptography.bindingCodes?.deriveSixDigits !== 'function'
    || typeof cryptography.bindingCodeDigest?.digest !== 'function') {
    throw new CloudBaseDeploymentConfigurationError();
  }
}

function requireSdkModule(candidate: unknown): CloudBaseNodeSdkModulePort {
  if (!isObject(candidate) || typeof candidate.init !== 'function' || typeof candidate.getCloudbaseContext !== 'function') {
    throw new CloudBaseDeploymentConfigurationError();
  }
  return candidate as unknown as CloudBaseNodeSdkModulePort;
}

function readCurrentEnvironment(context: Readonly<{ TCB_ENV?: unknown }>, fallback?: string): string {
  const candidate = isObject(context) && typeof context.TCB_ENV === 'string'
    ? context.TCB_ENV
    : fallback;
  if (typeof candidate !== 'string') throw new CloudBaseDeploymentConfigurationError();
  const normalized = candidate.trim();
  if (normalized.length === 0 || normalized.length > 128 || /\s/.test(normalized)) {
    throw new CloudBaseDeploymentConfigurationError();
  }
  return normalized;
}

function requireApplication(candidate: unknown): CloudBaseNodeApplicationPort {
  if (!isObject(candidate) || typeof candidate.auth !== 'function' || typeof candidate.database !== 'function') {
    throw new CloudBaseDeploymentConfigurationError();
  }
  return candidate as unknown as CloudBaseNodeApplicationPort;
}

function requireAuth(candidate: unknown): CloudBaseNodeAuthPort {
  if (!isObject(candidate) || typeof candidate.getUserInfo !== 'function') {
    throw new CloudBaseDeploymentConfigurationError();
  }
  return candidate as unknown as CloudBaseNodeAuthPort;
}

function requireDatabase(candidate: unknown): CloudBaseNativeDatabasePort {
  if (!isObject(candidate) || typeof candidate.collection !== 'function' || typeof candidate.runTransaction !== 'function') {
    throw new CloudBaseDeploymentConfigurationError();
  }
  return candidate as unknown as CloudBaseNativeDatabasePort;
}

function readUid(info: CloudBaseNodeCurrentUserInfo): string | undefined {
  const candidate = typeof info.uid === 'string'
    ? info.uid
    : typeof info.customUserId === 'string'
      ? info.customUserId
      : undefined;
  if (candidate === undefined) return undefined;
  const normalized = candidate.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
