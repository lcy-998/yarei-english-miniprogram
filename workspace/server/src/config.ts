import { readFileSync } from 'node:fs';
import type { NodeCryptoSecrets } from '../../m1-cloudbase/src/runtime/node-crypto-capabilities';
export function readSecrets(path: string): NodeCryptoSecrets {
  const value: unknown = JSON.parse(readFileSync(path,'utf8'));
  const keys = ['subjectPepper','cursorSigningKey','batchReviewSigningKey','businessSessionEncryptionKey','bindingCodeDerivationKey','bindingCodePepper'] as const;
  if (!value || typeof value !== 'object' || !keys.every(k=>typeof (value as Record<string,unknown>)[k]==='string')) throw new Error('Invalid server secret configuration');
  return value as NodeCryptoSecrets;
}
