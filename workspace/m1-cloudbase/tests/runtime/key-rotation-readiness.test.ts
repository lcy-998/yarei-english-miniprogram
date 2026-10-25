import { describe, expect, it } from 'vitest';
import { NodeBindingCodeCryptography, NodeHmacCodec,
  NodeOpaqueBusinessSessionTokenCodec, NodePepperedSubjectDigest } from '../../src/runtime/node-crypto-capabilities';

const oldTestKey = Buffer.alloc(32, 1).toString('base64url');
const nextTestKey = Buffer.alloc(32, 2).toString('base64url');
const clock = { nowIso: () => '2026-10-02T00:00:00.000Z' };

describe('nonproduction key rotation impact, using fictional local-only keys', () => {
  it('requires identity digest re-binding before retiring the old subject pepper', () => {
    const platformSubject = 'virtual-platform-subject-01';
    const oldDigest = new NodePepperedSubjectDigest(oldTestKey).digest(platformSubject);
    const nextDigest = new NodePepperedSubjectDigest(nextTestKey).digest(platformSubject);
    const identities = new Map([[oldDigest, 'student_virtual_01']]);
    expect(oldDigest).not.toBe(nextDigest);
    expect(identities.get(nextDigest)).toBeUndefined();
    identities.set(nextDigest, identities.get(oldDigest)!);
    expect(identities.get(nextDigest)).toBe('student_virtual_01');
  });

  it('invalidates old session, cursor, preview and unused binding code checks', () => {
    const sessionId = 'session_virtual_0123456789abcdef0123456789';
    const expiresAt = '2026-10-03T00:00:00.000Z';
    const oldSession = new NodeOpaqueBusinessSessionTokenCodec(oldTestKey, clock)
      .issueBusinessSessionToken(sessionId, expiresAt);
    expect(new NodeOpaqueBusinessSessionTokenCodec(nextTestKey, clock)
      .getBusinessSessionId(oldSession)).toBeNull();
    const oldCursor = new NodeHmacCodec(oldTestKey, 'query-cursor').encode('virtual-page-2');
    expect(new NodeHmacCodec(nextTestKey, 'query-cursor').decode(oldCursor)).toBeNull();
    const oldPreview = new NodeHmacCodec(oldTestKey, 'batch-review-preview').encode('virtual-review');
    expect(new NodeHmacCodec(nextTestKey, 'batch-review-preview').decode(oldPreview)).toBeNull();
    const oldCodeDigest = new NodeBindingCodeCryptography(oldTestKey, oldTestKey)
      .digest('org_virtual:student_virtual:123456');
    expect(new NodeBindingCodeCryptography(nextTestKey, nextTestKey)
      .digest('org_virtual:student_virtual:123456')).not.toBe(oldCodeDigest);
  });
});
