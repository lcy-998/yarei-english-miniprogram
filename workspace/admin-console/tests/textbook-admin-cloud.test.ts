import { describe, expect, it } from 'vitest';
import { createAdminTextbookClient } from '../src/cloud/admin-textbook-client';
import type { AdminSessionClient } from '../src/cloud/admin-session-client';
import type { CloudBaseBrowserApp } from '../src/cloud/cloudbase-admin-runtime';

const session: AdminSessionClient = {
  bootstrap: async () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: '未登录', retryable: false } }),
  refresh: async () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: '未登录', retryable: false } }),
  getCurrentSession: async () => ({ ok: true, data: { audience: 'admin-console', token: 'admin-session-token-demo',
    expiresAt: '2099-01-01T00:00:00Z' } }),
  logout: async () => ({ ok: true, data: null }),
};

describe('M2 admin textbook CloudBase transport', () => {
  it('uses the current admin token and omits client supplied actor identity', async () => {
    const calls: Array<{ name: string; data: object }> = [];
    const app: CloudBaseBrowserApp = {
      auth: () => ({ signInWithPassword: async () => ({ data: {} }) }),
      callFunction: async request => {
        calls.push({ name: request.name, data: request.data });
        return { result: { ok: true, data: { classes: [], books: [], settings: null },
          meta: { requestId: 'request_demo', serverTime: '2026-09-27T00:00:00Z', apiVersion: 'm1.v1' } } };
      },
    };
    const result = await createAdminTextbookClient(app, session).getOverview();
    expect(result).toMatchObject({ ok: true, data: { books: [] } });
    expect(calls).toMatchObject([{ name: 'textbook-admin-query', data: {
      action: 'getOverview', businessSessionToken: 'admin-session-token-demo', payload: {},
    } }]);
    expect(JSON.stringify(calls)).not.toMatch(/actorUserId|organizationId|permissions|scopeIds/);
  });

  it('rejects malformed server payloads and maps server failures to safe messages', async () => {
    const app: CloudBaseBrowserApp = {
      auth: () => ({ signInWithPassword: async () => ({ data: {} }) }),
      callFunction: async () => ({ result: { ok: true, data: { books: [{ id: 'broken' }] } } }),
    };
    expect(await createAdminTextbookClient(app, session).getOverview())
      .toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
