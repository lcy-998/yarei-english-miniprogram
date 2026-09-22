import type { CursorCodec } from './types';
import { NodeHmacCodec } from '../runtime/node-crypto-capabilities';

interface HashLike {
  update(value: string): HashLike;
  digest(encoding: 'hex'): string;
}

interface NodeCryptoPort {
  createHash(algorithm: 'sha256'): HashLike;
}

declare const require: (moduleName: 'node:crypto') => NodeCryptoPort;

export function sha256Hex(value: string): string {
  return require('node:crypto').createHash('sha256').update(value).digest('hex');
}

/**
 * A stateless cursor codec for serverless query handlers. The payload can be
 * recovered after a cold start, while the HMAC prevents a client from changing
 * offsets or authorization bindings. Production composition should supply a
 * explicitly injected server-side secret. The implementation reuses the same
 * constant-time HMAC codec as the deployment capability factory.
 */
export class SelfContainedOpaqueCursorCodec implements CursorCodec {
  private readonly codec: NodeHmacCodec;

  public constructor(signingKey: string) {
    this.codec = new NodeHmacCodec(signingKey, 'self-contained-cursor');
  }

  public encode(payload: string): string {
    return this.codec.encode(payload);
  }

  public decode(token: string): string | null {
    return this.codec.decode(token);
  }
}
