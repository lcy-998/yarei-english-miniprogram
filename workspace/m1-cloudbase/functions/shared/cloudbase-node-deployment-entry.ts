import { createNodeCryptoCapabilities, type NodeCryptoSecrets } from '../../src/runtime/node-crypto-capabilities';
import { bootstrapCloudBaseNodeDeployment } from './cloudbase-node-deployment-bootstrap';
import { installCloudBaseRuntimeProvider } from './default-cloudbase-function';

interface DeploymentProcessPort {
  readonly env: Readonly<Record<string, string | undefined>>;
}

declare const process: DeploymentProcessPort;
declare const require: (moduleName: string) => unknown;

const SECRET_ENVIRONMENT_KEYS = Object.freeze({
  subjectPepper: 'YAREI_SUBJECT_PEPPER',
  cursorSigningKey: 'YAREI_QUERY_CURSOR_SIGNING_KEY',
  batchReviewSigningKey: 'YAREI_BATCH_REVIEW_SIGNING_KEY',
  businessSessionEncryptionKey: 'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  bindingCodeDerivationKey: 'YAREI_BINDING_CODE_DERIVATION_KEY',
  bindingCodePepper: 'YAREI_BINDING_CODE_PEPPER',
} satisfies Readonly<Record<keyof NodeCryptoSecrets, string>>);

/**
 * Installs the reviewed CloudBase provider during a deployed function cold start.
 * No environment identifier or cloud credential is read here. Missing SDK or
 * secret capabilities leave the default function entry safely unconfigured.
 */
export function installCloudBaseNodeDeploymentFromEnvironment(): void {
  try {
    const clock = { nowIso: () => new Date().toISOString() };
    const cryptography = createNodeCryptoCapabilities({
      clock,
      secrets: readSecrets(),
    });
    bootstrapCloudBaseNodeDeployment({
      loadSdk: () => require('@cloudbase/node-sdk'),
      environmentId: readCurrentEnvironmentFromProcess(),
      clock,
      requestIds: cryptography.requestIds,
      cryptography,
    });
  } catch {
    installCloudBaseRuntimeProvider(null);
  }
}

function readSecrets(): NodeCryptoSecrets {
  return {
    subjectPepper: readSecret(SECRET_ENVIRONMENT_KEYS.subjectPepper),
    cursorSigningKey: readSecret(SECRET_ENVIRONMENT_KEYS.cursorSigningKey),
    batchReviewSigningKey: readSecret(SECRET_ENVIRONMENT_KEYS.batchReviewSigningKey),
    businessSessionEncryptionKey: readSecret(SECRET_ENVIRONMENT_KEYS.businessSessionEncryptionKey),
    bindingCodeDerivationKey: readSecret(SECRET_ENVIRONMENT_KEYS.bindingCodeDerivationKey),
    bindingCodePepper: readSecret(SECRET_ENVIRONMENT_KEYS.bindingCodePepper),
  };
}

function readSecret(name: string): string {
  return process.env[name] ?? '';
}

function readCurrentEnvironmentFromProcess(): string | undefined {
  return [
    process.env.TCB_ENV,
    process.env.SCF_NAMESPACE,
  ].find(isNonBlankEnvironmentId);
}

function isNonBlankEnvironmentId(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
