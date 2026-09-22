import type { BindingCodeDigestPort, BindingCodeGenerator } from '../org-content/relationship-service';
import type { BatchReviewPreviewCodec } from '../task-core/batch-review-preview';
import type { CursorCodec } from '../task-query/types';
import type { BusinessSessionAudience, TrustedBusinessSessionTokenCodec } from './cloudbase-runtime-adapter';
import type { Clock, IdentifierGenerator, SubjectDigestPort } from './ports';
import type { RequestIdGenerator } from '../shared/result';

interface BufferLike {
  readonly length: number;
  readonly [index: number]: number;
  toString(encoding?: 'base64url' | 'hex' | 'utf8'): string;
}

interface BufferFactory {
  from(value: string, encoding?: 'base64url' | 'utf8'): BufferLike;
  concat(values: readonly BufferLike[]): BufferLike;
  byteLength(value: string, encoding?: 'utf8'): number;
}

interface HmacLike {
  update(value: string | BufferLike): HmacLike;
  digest(): BufferLike;
}

interface CipherLike {
  setAAD(value: BufferLike): void;
  update(value: BufferLike): BufferLike;
  final(): BufferLike;
  getAuthTag(): BufferLike;
}

interface DecipherLike {
  setAAD(value: BufferLike): void;
  setAuthTag(value: BufferLike): void;
  update(value: BufferLike): BufferLike;
  final(): BufferLike;
}

interface NodeCryptoPort {
  randomBytes(size: number): BufferLike;
  randomInt(max: number): number;
  createHmac(algorithm: 'sha256', key: string | BufferLike): HmacLike;
  timingSafeEqual(left: BufferLike, right: BufferLike): boolean;
  createCipheriv(algorithm: 'aes-256-gcm', key: BufferLike, iv: BufferLike): CipherLike;
  createDecipheriv(algorithm: 'aes-256-gcm', key: BufferLike, iv: BufferLike): DecipherLike;
}

declare const Buffer: BufferFactory;
declare const require: (moduleName: 'node:crypto') => NodeCryptoPort;

const MIN_SECRET_BYTES = 32;
const MAX_SIGNED_PAYLOAD_BYTES = 64 * 1024;
const HMAC_TOKEN_VERSION = 'hm1';
const SESSION_TOKEN_VERSION = 'bs1';
const ADMIN_SESSION_TOKEN_VERSION = 'as1';
const SESSION_TOKEN_PURPOSE = 'business-session';

export interface NodeCryptoSecrets {
  readonly subjectPepper: string;
  readonly cursorSigningKey: string;
  readonly batchReviewSigningKey: string;
  readonly businessSessionEncryptionKey: string;
  readonly bindingCodeDerivationKey: string;
  readonly bindingCodePepper: string;
}

export interface NodeCryptoCapabilityOptions {
  readonly secrets: NodeCryptoSecrets;
  readonly clock: Clock;
}

export interface NodeCryptoCapabilities {
  readonly identifiers: IdentifierGenerator;
  readonly requestIds: RequestIdGenerator;
  readonly subjectDigest: SubjectDigestPort;
  readonly queryCursorCodec: CursorCodec;
  readonly batchReviewPreviewCodec: BatchReviewPreviewCodec;
  readonly businessSession: TrustedBusinessSessionTokenCodec;
  readonly bindingCodes: BindingCodeGenerator & Required<Pick<BindingCodeGenerator, 'deriveSixDigits'>>;
  readonly bindingCodeDigest: BindingCodeDigestPort;
}

export class NodeCryptoConfigurationError extends Error {
  public constructor() {
    super('Node cryptography capabilities are unavailable.');
    this.name = 'NodeCryptoConfigurationError';
  }
}

export function createNodeCryptoCapabilities(options: NodeCryptoCapabilityOptions): NodeCryptoCapabilities {
  assertCapabilityOptions(options);
  const identifiers = new NodeCryptoIdentifierGenerator();
  const binding = new NodeBindingCodeCryptography(
    options.secrets.bindingCodeDerivationKey,
    options.secrets.bindingCodePepper,
  );
  return {
    identifiers,
    requestIds: { next: () => identifiers.next('req') },
    subjectDigest: new NodePepperedSubjectDigest(options.secrets.subjectPepper),
    queryCursorCodec: new NodeHmacCodec(options.secrets.cursorSigningKey, 'query-cursor'),
    batchReviewPreviewCodec: new NodeHmacCodec(options.secrets.batchReviewSigningKey, 'batch-review-preview'),
    businessSession: new NodeOpaqueBusinessSessionTokenCodec(
      options.secrets.businessSessionEncryptionKey,
      options.clock,
    ),
    bindingCodes: binding,
    bindingCodeDigest: binding,
  };
}

export class NodeCryptoIdentifierGenerator implements IdentifierGenerator {
  public next(prefix: string): string {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(prefix)) throw new NodeCryptoConfigurationError();
    return `${prefix}_${crypto().randomBytes(24).toString('base64url')}`;
  }
}

export class NodePepperedSubjectDigest implements SubjectDigestPort {
  public constructor(private readonly pepper: string) {
    assertSecret(pepper);
  }

  public digest(platformSubject: string): string {
    if (platformSubject.length === 0 || platformSubject.length > 512) throw new NodeCryptoConfigurationError();
    return `sd1_${mac(this.pepper, 'platform-subject', platformSubject).toString('base64url')}`;
  }
}

/** Shared stateless HMAC implementation for query cursors and batch-review previews. */
export class NodeHmacCodec implements CursorCodec, BatchReviewPreviewCodec {
  private readonly key: BufferLike;

  public constructor(secret: string, purpose: string) {
    assertSecret(secret);
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(purpose)) throw new NodeCryptoConfigurationError();
    this.key = deriveKey(secret, `signed-token:${purpose}`);
  }

  public encode(payload: string): string {
    if (Buffer.byteLength(payload, 'utf8') > MAX_SIGNED_PAYLOAD_BYTES) throw new NodeCryptoConfigurationError();
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    const signed = `${HMAC_TOKEN_VERSION}.${encoded}`;
    return `${signed}.${hmac(this.key, signed).toString('base64url')}`;
  }

  public decode(token: string): string | null {
    if (token.length > MAX_SIGNED_PAYLOAD_BYTES * 2) return null;
    const match = /^hm1\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (match === null) return null;
    const payload = decodeBase64Url(match[1]);
    const signature = decodeBase64Url(match[2]);
    if (payload === null || signature === null || signature.length !== 32) return null;
    const signed = `${HMAC_TOKEN_VERSION}.${match[1]}`;
    const expected = hmac(this.key, signed);
    if (expected.length !== signature.length || !crypto().timingSafeEqual(expected, signature)) return null;
    if (payload.length > MAX_SIGNED_PAYLOAD_BYTES) return null;
    return payload.toString('utf8');
  }
}

export class NodeBindingCodeCryptography implements BindingCodeGenerator, BindingCodeDigestPort {
  private readonly derivationKey: BufferLike;
  private readonly digestKey: BufferLike;

  public constructor(derivationSecret: string, digestPepper: string) {
    assertSecret(derivationSecret);
    assertSecret(digestPepper);
    this.derivationKey = deriveKey(derivationSecret, 'binding-code-derive');
    this.digestKey = deriveKey(digestPepper, 'binding-code-digest');
  }

  public nextSixDigits(): string {
    return crypto().randomInt(1_000_000).toString().padStart(6, '0');
  }

  public deriveSixDigits(seed: string): string {
    if (seed.length === 0 || seed.length > 1024) throw new NodeCryptoConfigurationError();
    const value = hmac(this.derivationKey, seed);
    let numeric = 0;
    for (let index = 0; index < 6; index += 1) numeric = numeric * 256 + value[index];
    return (numeric % 1_000_000).toString().padStart(6, '0');
  }

  public digest(value: string): string {
    if (value.length === 0 || value.length > 2048) throw new NodeCryptoConfigurationError();
    return `bcd1_${hmac(this.digestKey, value).toString('base64url')}`;
  }
}

export class NodeOpaqueBusinessSessionTokenCodec implements TrustedBusinessSessionTokenCodec {
  private readonly key: BufferLike;
  private readonly miniProgramAdditionalData = Buffer.from('yarei:business-session:v1', 'utf8');
  private readonly adminConsoleAdditionalData = Buffer.from('yarei:admin-session:v1', 'utf8');

  public constructor(secret: string, private readonly clock: Clock) {
    assertSecret(secret);
    if (typeof clock?.nowIso !== 'function') throw new NodeCryptoConfigurationError();
    readClockNow(clock);
    this.key = deriveKey(secret, SESSION_TOKEN_PURPOSE);
  }

  public issueBusinessSessionToken(
    sessionId: string,
    expiresAt: string,
    audience: BusinessSessionAudience = 'mini-program',
  ): string {
    const now = readClockNow(this.clock);
    if (!isSafeSessionId(sessionId) || !isIso(expiresAt) || Date.parse(expiresAt) <= Date.parse(now)) {
      throw new NodeCryptoConfigurationError();
    }
    const iv = crypto().randomBytes(12);
    const cipher = crypto().createCipheriv('aes-256-gcm', this.key, iv);
    const admin = audience === 'admin-console';
    cipher.setAAD(admin ? this.adminConsoleAdditionalData : this.miniProgramAdditionalData);
    const plaintext = Buffer.from(JSON.stringify(admin
      ? { sid: sessionId, exp: expiresAt, aud: audience }
      : { sid: sessionId, exp: expiresAt }), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const token = [
      admin ? ADMIN_SESSION_TOKEN_VERSION : SESSION_TOKEN_VERSION,
      iv.toString('base64url'),
      encrypted.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
    if (token.length > 256) throw new NodeCryptoConfigurationError();
    return token;
  }

  public getBusinessSessionId(
    token: string,
    expectedAudience: BusinessSessionAudience = 'mini-program',
  ): string | null {
    if (token.length > 256) return null;
    const version = expectedAudience === 'admin-console' ? ADMIN_SESSION_TOKEN_VERSION : SESSION_TOKEN_VERSION;
    const match = new RegExp(`^${version}\\.([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)$`).exec(token);
    if (match === null) return null;
    const iv = decodeBase64Url(match[1]);
    const encrypted = decodeBase64Url(match[2]);
    const tag = decodeBase64Url(match[3]);
    if (iv === null || encrypted === null || tag === null || iv.length !== 12 || tag.length !== 16) return null;
    try {
      const decipher = crypto().createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(expectedAudience === 'admin-console'
        ? this.adminConsoleAdditionalData
        : this.miniProgramAdditionalData);
      decipher.setAuthTag(tag);
      const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      const parsed: unknown = JSON.parse(decoded);
      const now = this.clock.nowIso();
      if (!isIso(now)
        || !isSessionPayload(parsed, expectedAudience)
        || Date.parse(parsed.exp) <= Date.parse(now)) return null;
      return parsed.sid;
    } catch {
      return null;
    }
  }
}

function assertCapabilityOptions(options: NodeCryptoCapabilityOptions): void {
  if (options === null || typeof options !== 'object') throw new NodeCryptoConfigurationError();
  const unsafe = options as unknown as Partial<NodeCryptoCapabilityOptions>;
  const secrets = unsafe.secrets as Partial<NodeCryptoSecrets> | undefined;
  if (secrets === undefined || typeof unsafe.clock?.nowIso !== 'function') throw new NodeCryptoConfigurationError();
  for (const value of [
    secrets.subjectPepper,
    secrets.cursorSigningKey,
    secrets.batchReviewSigningKey,
    secrets.businessSessionEncryptionKey,
    secrets.bindingCodeDerivationKey,
    secrets.bindingCodePepper,
  ]) assertSecret(value);
}

function assertSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new NodeCryptoConfigurationError();
  }
  const decoded = decodeBase64Url(secret);
  if (decoded === null || decoded.length !== MIN_SECRET_BYTES) throw new NodeCryptoConfigurationError();
}

function crypto(): NodeCryptoPort {
  return require('node:crypto');
}

function deriveKey(secret: string, purpose: string): BufferLike {
  return mac(secret, 'key-derivation', purpose);
}

function mac(secret: string, purpose: string, value: string): BufferLike {
  return hmac(secret, `yarei:${purpose}:v1\u0000${value}`);
}

function hmac(key: string | BufferLike, value: string): BufferLike {
  return crypto().createHmac('sha256', key).update(value).digest();
}

function decodeBase64Url(value: string): BufferLike | null {
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
}

function readClockNow(clock: Clock): string {
  try {
    const value: unknown = clock.nowIso();
    if (isIso(value)) return value;
  } catch {
    // Normalize deployment clock failures to the same non-sensitive error as other invalid capabilities.
  }
  throw new NodeCryptoConfigurationError();
}

function isIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  if (month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return false;
  return Number.isFinite(Date.parse(value));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isSafeSessionId(value: string): boolean {
  return value.length >= 16 && value.length <= 96 && /^[A-Za-z0-9:_-]+$/.test(value);
}

function isSessionPayload(
  value: unknown,
  expectedAudience: BusinessSessionAudience,
): value is Readonly<{ sid: string; exp: string; aud?: BusinessSessionAudience }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expectedKeys = expectedAudience === 'admin-console' ? 3 : 2;
  return Object.keys(record).length === expectedKeys
    && typeof record.sid === 'string'
    && isSafeSessionId(record.sid)
    && typeof record.exp === 'string'
    && isIso(record.exp)
    && (expectedAudience === 'mini-program' || record.aud === 'admin-console');
}
