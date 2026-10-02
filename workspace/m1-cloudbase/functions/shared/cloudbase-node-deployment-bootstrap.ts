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
import { createM2BusinessReadIsolation } from '../../src/seed/m2-business-read-isolation';
import {
  type CloudBaseFunctionRuntimeCapabilities,
  type CloudBaseRuntimeProvider,
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
  getTempFileURL?: CloudBasePlaybackSdkPort['getTempFileURL'];
}

/**
 * Structural surface of the Node entry exposed by `@cloudbase/js-sdk` v3. The deployment package owns the
 * actual import, so this source compiles and remains testable before that runtime
 * dependency is approved and installed.
 */
export interface CloudBaseNodeSdkModulePort {
  getCloudbaseContext(): Readonly<{ TCB_ENV?: unknown }>;
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
  const capabilities: CloudBaseFunctionRuntimeCapabilities = Object.freeze({
    ...base,
    ...(typeof app.downloadFile === 'function' && typeof app.uploadFile === 'function'
      ? { recordingStorage: { downloadFile: (input: Parameters<CloudBaseWorkStoragePort['downloadFile']>[0]) => app.downloadFile!(input),
        uploadFile: (input: Parameters<CloudBaseWorkStoragePort['uploadFile']>[0]) => app.uploadFile!(input) }, environmentId: currentEnvironment } : {}),
    ...(typeof app.getTempFileURL === 'function'
      ? { playbackStorage: { getTempFileURL: (input: Parameters<CloudBasePlaybackSdkPort['getTempFileURL']>[0]) => app.getTempFileURL!(input) } } : {}),
    queryCursorCodec: options.cryptography.queryCursorCodec,
    batchReviewPreviewCodec: options.cryptography.batchReviewPreviewCodec,
    bindingCodes: options.cryptography.bindingCodes,
    bindingCodeDigest: options.cryptography.bindingCodeDigest,
  });
  return () => capabilities;
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
