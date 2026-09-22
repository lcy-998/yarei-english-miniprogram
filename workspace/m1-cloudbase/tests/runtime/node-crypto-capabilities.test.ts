import { describe, expect, it } from 'vitest';
import {
  NodeCryptoConfigurationError,
  NodeHmacCodec,
  createNodeCryptoCapabilities,
  type NodeCryptoCapabilityOptions,
  type NodeCryptoSecrets,
} from '../../src/runtime/node-crypto-capabilities';
import { AuthSessionHandler } from '../../src/auth/auth-session-handler';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository } from '../../src/runtime/memory-ports';

const SECRETS: NodeCryptoSecrets = {
  subjectPepper: 'xLZ7Jfj7ZK7LnJboPz9Dxmx_eZoFluu0GP41XIlNexg',
  cursorSigningKey: 'OT8k4PnWA7uAhuYjuwKZ-YRTScyXBqT-TrY8lajrQFo',
  batchReviewSigningKey: 'sUoMvbbbt15vCssMUucx__5Mxiw6KJ4VW9DPsu556zw',
  businessSessionEncryptionKey: 'ZiNCgxJRwwC2qvCFDR6Qi8FRp_tfvTHJMtHTw6qf5OM',
  bindingCodeDerivationKey: '8UNshhTqqghCVaTK-eguMzHeliVfP4NFd7DpqgxZJ_s',
  bindingCodePepper: 'KE_5Tyfgmss5dUoMVvyTeRMCy3cic32iyaEA9yXdVcw',
};

describe('Node crypto deployment capabilities', () => {
  it('produces stable digest, cursor and binding-code vectors with secure random identifiers', () => {
    const { capabilities } = harness();

    expect(capabilities.subjectDigest.digest('cloudbase:username:uid_demo'))
      .toBe('sd1_LRLxbfmONsTQacGFpaKxgOKiiYonJMxw8T4ktf5gHko');
    expect(capabilities.queryCursorCodec.encode('q1|scope-hash|20'))
      .toBe('hm1.cTF8c2NvcGUtaGFzaHwyMA.SH5666NhvYn0RXy7j-34O6KVuQSRTb3ZYuqerwNqH5o');
    expect(capabilities.bindingCodes.deriveSixDigits('org_demo:student_demo:operation_demo')).toBe('188809');
    expect(capabilities.bindingCodeDigest.digest('org_demo:student_demo:482731'))
      .toBe('bcd1_sBQB6OkRoPDLPsJA4DKVKXPG0KgsbHA-zjASWMFCO78');

    const first = capabilities.identifiers.next('ses');
    const second = capabilities.identifiers.next('ses');
    expect(first).toMatch(/^ses_[A-Za-z0-9_-]{32}$/);
    expect(second).toMatch(/^ses_[A-Za-z0-9_-]{32}$/);
    expect(second).not.toBe(first);
    expect(capabilities.requestIds.next()).toMatch(/^req_[A-Za-z0-9_-]{32}$/);
    expect(capabilities.bindingCodes.nextSixDigits()).toMatch(/^\d{6}$/);
  });

  it('rejects tampering and isolates cursor, batch-preview and unrelated signing purposes', () => {
    const { capabilities } = harness();
    const cursorToken = capabilities.queryCursorCodec.encode('q1|scope|1');
    const batchToken = capabilities.batchReviewPreviewCodec.encode('batch-preview|{"expiresAt":"2099-01-01T00:00:00.000Z"}');

    expect(capabilities.queryCursorCodec.decode(cursorToken)).toBe('q1|scope|1');
    expect(capabilities.batchReviewPreviewCodec.decode(batchToken)).toContain('batch-preview|');
    expect(capabilities.batchReviewPreviewCodec.decode(cursorToken)).toBeNull();
    expect(capabilities.queryCursorCodec.decode(batchToken)).toBeNull();
    expect(capabilities.queryCursorCodec.decode(tamper(cursorToken))).toBeNull();
    expect(new NodeHmacCodec(SECRETS.cursorSigningKey, 'different-purpose').decode(cursorToken)).toBeNull();
  });

  it('issues confidential stateless business-session tokens and rejects tampered or expired values', () => {
    const state = harness();
    const sessionId = 'ses_0123456789abcdef0123456789abcdef';
    const token = state.capabilities.businessSession.issueBusinessSessionToken(
      sessionId,
      '2026-09-17T00:00:00.000Z',
    );

    expect(token).toMatch(/^bs1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(sessionId);
    expect(state.capabilities.businessSession.getBusinessSessionId(token)).toBe(sessionId);
    expect(state.capabilities.businessSession.getBusinessSessionId(tamper(token))).toBeNull();

    state.setNow('2026-09-17T00:00:00.000Z');
    expect(state.capabilities.businessSession.getBusinessSessionId(token)).toBeNull();
  });

  it('cryptographically separates admin-console and mini-program session audiences with the same key', () => {
    const state = harness();
    const sessionId = 'admin_ses_0123456789abcdef0123456789abcdef';
    const expiresAt = '2026-09-17T00:00:00.000Z';
    const adminToken = state.capabilities.businessSession.issueBusinessSessionToken(
      sessionId,
      expiresAt,
      'admin-console',
    );
    const miniToken = state.capabilities.businessSession.issueBusinessSessionToken(
      sessionId,
      expiresAt,
      'mini-program',
    );

    expect(adminToken).toMatch(/^as1\./);
    expect(miniToken).toMatch(/^bs1\./);
    expect(state.capabilities.businessSession.getBusinessSessionId(adminToken, 'admin-console')).toBe(sessionId);
    expect(state.capabilities.businessSession.getBusinessSessionId(adminToken, 'mini-program')).toBeNull();
    expect(state.capabilities.businessSession.getBusinessSessionId(miniToken, 'admin-console')).toBeNull();
    expect(state.capabilities.businessSession.getBusinessSessionId(miniToken, 'mini-program')).toBe(sessionId);
  });

  it('fails closed when session dates or the deployment clock are malformed', () => {
    const state = harness();
    const sessionId = 'ses_0123456789abcdef0123456789abcdef';

    expect(() => state.capabilities.businessSession.issueBusinessSessionToken(
      sessionId,
      '2027-02-30T00:00:00.000Z',
    )).toThrow(NodeCryptoConfigurationError);

    const token = state.capabilities.businessSession.issueBusinessSessionToken(
      sessionId,
      '2026-09-17T00:00:00.000Z',
    );
    state.setNow('2026-02-30T00:00:00.000Z');
    expect(() => state.capabilities.businessSession.issueBusinessSessionToken(
      sessionId,
      '2026-09-17T00:00:00.000Z',
    )).toThrow(NodeCryptoConfigurationError);
    expect(state.capabilities.businessSession.getBusinessSessionId(token)).toBeNull();

    const clockFailure = {
      ...state.options,
      clock: { nowIso: (): string => { throw new Error('sensitive clock detail'); } },
    };
    expect(() => createNodeCryptoCapabilities(clockFailure)).toThrow(NodeCryptoConfigurationError);
    try {
      createNodeCryptoCapabilities(clockFailure);
    } catch (error: unknown) {
      expect(String(error)).not.toContain('sensitive clock detail');
    }
  });

  it('returns an opaque bearer token from auth bootstrap while storing only the internal session id', async () => {
    const state = harness();
    const subject = 'cloudbase:username:uid_crypto_demo';
    const identities = new InMemoryIdentityRepository({
      organizations: [{
        _id: 'org_demo', organizationId: 'org_demo', name: '启航实验学校', status: 'active',
        timeZone: 'Asia/Shanghai', version: 1, deletedAt: null,
      }],
      users: [{
        _id: 'student_demo', organizationId: 'org_demo', authorizationVersion: 1,
        displayName: '小宇', displayNameMasked: '小*', status: 'active', version: 1, deletedAt: null,
      }],
      identities: [{
        _id: 'identity_demo', organizationId: 'org_demo', userId: 'student_demo', provider: 'cloudbase_uid',
        providerSubjectDigest: state.capabilities.subjectDigest.digest(subject), status: 'active', version: 1, deletedAt: null,
      }],
      roles: [{
        _id: 'role_student', organizationId: 'org_demo', userId: 'student_demo', role: 'student', status: 'active',
        permissions: ['content.read'], scopeIds: ['student_demo'], version: 1, deletedAt: null,
      }],
      teacherGrants: [],
      parentLinks: [],
    });
    const sessions = new InMemoryBusinessSessionRepository();
    const handler = new AuthSessionHandler(
      identities,
      sessions,
      state.capabilities.subjectDigest,
      state.options.clock,
      state.capabilities.identifiers,
      state.capabilities.businessSession,
    );

    const result = await handler.handle(
      { action: 'bootstrap', payload: {} },
      { subject, loginType: 'USERNAME', isAuthenticated: true },
      null,
      { requestId: 'request_crypto_bootstrap', serverTime: state.options.clock.nowIso(), apiVersion: 'm1.v1' },
    );
    expect(result).toMatchObject({ ok: true, data: { sessionId: expect.stringMatching(/^bs1\./) } });
    if (!result.ok) throw new Error('bootstrap result expected');
    const internalSessionId = state.capabilities.businessSession.getBusinessSessionId(result.data.sessionId);
    expect(internalSessionId).toMatch(/^ses_[A-Za-z0-9_-]{32}$/);
    await expect(sessions.find(internalSessionId as string)).resolves.toMatchObject({ id: internalSessionId });
    expect(result.data.sessionId).not.toContain(internalSessionId as string);
  });

  it('fails closed for every absent or short secret without echoing secret material', () => {
    const { options } = harness();
    for (const key of Object.keys(SECRETS) as Array<keyof NodeCryptoSecrets>) {
      const invalid = {
        ...options,
        secrets: { ...SECRETS, [key]: 'short-secret-value' },
      };
      expect(() => createNodeCryptoCapabilities(invalid)).toThrow(NodeCryptoConfigurationError);
      try {
        createNodeCryptoCapabilities(invalid);
      } catch (error: unknown) {
        expect(String(error)).not.toContain('short-secret-value');
      }
    }
    expect(() => createNodeCryptoCapabilities({ ...options, secrets: undefined } as unknown as NodeCryptoCapabilityOptions))
      .toThrow('Node cryptography capabilities are unavailable.');
  });
});

function harness() {
  let now = '2026-09-16T00:00:00.000Z';
  const options: NodeCryptoCapabilityOptions = {
    secrets: SECRETS,
    clock: { nowIso: () => now },
  };
  return {
    options,
    capabilities: createNodeCryptoCapabilities(options),
    setNow: (value: string): void => { now = value; },
  };
}

function tamper(token: string): string {
  const replacement = token.endsWith('A') ? 'B' : 'A';
  return `${token.slice(0, -1)}${replacement}`;
}
