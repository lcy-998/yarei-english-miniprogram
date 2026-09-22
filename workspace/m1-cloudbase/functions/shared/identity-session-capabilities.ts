import type { DocumentDatabasePort } from '../../src/repositories/document-database-port';
import {
  createBusinessSessionDocumentRepository,
  createIdentityDocumentRepository,
} from '../../src/repositories/identity-session-document-adapter';
import type { TrustedBusinessSessionTokenCodec } from '../../src/runtime/cloudbase-runtime-adapter';
import type { Clock, IdentifierGenerator, SubjectDigestPort } from '../../src/runtime/ports';
import type { RequestIdGenerator, ResultClock } from '../../src/shared/result';
import type { CloudBaseServerSdkPort } from './cloudbase-composition';
import type { CloudBaseFunctionRuntimeCapabilities } from './default-cloudbase-function';

export interface IdentitySessionCryptographyPorts {
  readonly subjectDigest: SubjectDigestPort;
  readonly identifiers: IdentifierGenerator;
  readonly businessSession: TrustedBusinessSessionTokenCodec;
}

export interface IdentitySessionCapabilityOptions {
  readonly sdk: CloudBaseServerSdkPort;
  readonly documents: DocumentDatabasePort;
  readonly clock: Clock & ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly cryptography: IdentitySessionCryptographyPorts;
}

/**
 * Pure deployment seam for the persistent identity/session foundation. The
 * caller must inject the initialized platform SDK, document database and every
 * secret-bearing/hash/id capability. This module never imports an SDK, reads an
 * environment id, or falls back to a development key/generator.
 */
export function createIdentitySessionRuntimeCapabilities(
  options: IdentitySessionCapabilityOptions,
): CloudBaseFunctionRuntimeCapabilities {
  assertOptions(options);
  return {
    sdk: options.sdk,
    documents: options.documents,
    identities: createIdentityDocumentRepository(options.documents),
    sessions: createBusinessSessionDocumentRepository(options.documents),
    subjectDigest: options.cryptography.subjectDigest,
    identifiers: options.cryptography.identifiers,
    clock: options.clock,
    requestIds: options.requestIds,
    businessSession: options.cryptography.businessSession,
  };
}

class IdentitySessionCapabilityConfigurationError extends Error {
  public constructor() {
    super('Identity/session runtime capabilities are unavailable.');
    this.name = 'IdentitySessionCapabilityConfigurationError';
  }
}

function assertOptions(options: IdentitySessionCapabilityOptions): void {
  const unsafe = options as unknown as Partial<IdentitySessionCapabilityOptions>;
  const sdk = unsafe.sdk as Partial<CloudBaseServerSdkPort> | undefined;
  const documents = unsafe.documents as Partial<DocumentDatabasePort> | undefined;
  const clock = unsafe.clock as Partial<Clock & ResultClock> | undefined;
  const requestIds = unsafe.requestIds as Partial<RequestIdGenerator> | undefined;
  const cryptography = unsafe.cryptography as Partial<IdentitySessionCryptographyPorts> | undefined;
  if (sdk === undefined || typeof sdk.getWXContext !== 'function' || typeof sdk.database !== 'function'
    || documents === undefined || typeof documents.get !== 'function'
    || typeof documents.find !== 'function' || typeof documents.runTransaction !== 'function'
    || clock === undefined || typeof clock.nowIso !== 'function'
    || requestIds === undefined || typeof requestIds.next !== 'function'
    || cryptography === undefined || typeof cryptography.subjectDigest?.digest !== 'function'
    || typeof cryptography.identifiers?.next !== 'function'
    || typeof cryptography.businessSession?.getBusinessSessionId !== 'function'
    || typeof cryptography.businessSession?.issueBusinessSessionToken !== 'function') {
    throw new IdentitySessionCapabilityConfigurationError();
  }
}
