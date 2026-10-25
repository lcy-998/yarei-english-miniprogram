import { describe, expect, it } from 'vitest';
import { DirectScfPronunciationTransport } from '../../src/pronunciation/scf-direct-transport';

const timestamp = 1551113065;
const credentials = { secretId: 'AKID_FAKE_TEST_ONLY', secretKey: 'FAKE_TEST_KEY_NO_REAL_CREDENTIAL' };

describe('M3 direct SCF transport offline contract', () => {
  it('matches an independent TC3 signature vector and uses one 290-second sync request', async () => {
    let calls = 0;
    const client = new DirectScfPronunciationTransport(credentials, 'ap-guangzhou', 'default',
      async (url, init) => {
        calls += 1;
        expect(url).toBe('https://scf.tencentcloudapi.com/');
        expect(init.method).toBe('POST');
        expect(init.redirect).toBe('error');
        expect(JSON.parse(String(init.body))).toMatchObject({ FunctionName: 'pronunciation-inference',
          InvocationType: 'RequestResponse', ClientContext: '{}' });
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe('TC3-HMAC-SHA256 '
          + 'Credential=AKID_FAKE_TEST_ONLY/2019-02-25/scf/tc3_request, '
          + 'SignedHeaders=content-type;host;x-tc-action, '
          + 'Signature=1d6ac27073ad2c18fad24a8e4b2bc1eee9b9aa58889cabdbadecd6fed31814d9');
        expect(headers['x-tc-action']).toBe('Invoke');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return new Response(JSON.stringify({ Response: { Result: { InvokeResult: 0, ErrMsg: '',
          RetMsg: JSON.stringify({ ok: true, benchmark: { event: 'voice_benchmark' } }),
          Log: 'fictional-private-token' } } }), { status: 200 });
      }, { nowUnix: () => timestamp });
    expect(await client.invoke({ functionName: 'pronunciation-inference', event: {}, timeoutMs: 290000 }))
      .toMatchObject({ ok: true });
    expect(calls).toBe(1);
  });

  it('sends one 10-second Event request and does not echo secret payloads', async () => {
    let calls = 0;
    const client = new DirectScfPronunciationTransport(credentials, 'ap-guangzhou', 'default',
      async (_url, init) => {
        calls += 1;
        expect(JSON.parse(String(init.body))).toMatchObject({ InvocationType: 'Event', Qualifier: '$LATEST' });
        return new Response(JSON.stringify({ Response: { Result: { FunctionRequestId: 'virtual-id' } } }),
          { status: 200 });
      }, { nowUnix: () => timestamp });
    await client.invokeEvent('pronunciation-worker', { job: { organizationId: 'org_virtual_01',
      studentId: 'student_virtual_01', recordingId: 'recording_virtual_01',
      operationId: 'operation_virtual_01' }, timestamp, signature: 'a'.repeat(64) });
    expect(calls).toBe(1);
  });

  it('passes a temporary credential token only in the SCF request header', async () => {
    const token = 'FAKE_SHORT_LIVED_TOKEN_TEST_ONLY';
    const client = new DirectScfPronunciationTransport({ ...credentials, sessionToken: token },
      'ap-guangzhou', 'default', async (_url, init) => {
        const headers = init.headers as Record<string, string>;
        expect(headers['x-tc-token']).toBe(token);
        expect(headers.authorization).not.toContain(token);
        expect(String(init.body)).not.toContain(token);
        return new Response(JSON.stringify({ Response: { Result: { InvokeResult: 0, ErrMsg: '',
          RetMsg: JSON.stringify({ ok: true }) } } }), { status: 200 });
      }, { nowUnix: () => timestamp });
    const result = await client.invoke({ functionName: 'pronunciation-inference',
      event: {}, timeoutMs: 290000 });
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('does not retry an HTTP failure or return raw error content', async () => {
    let calls = 0;
    const client = new DirectScfPronunciationTransport(credentials, 'ap-guangzhou', 'default',
      async () => { calls += 1; return new Response('fictional-private-token', { status: 500 }); },
      { nowUnix: () => timestamp });
    await expect(client.invoke({ functionName: 'pronunciation-inference', event: {}, timeoutMs: 290000 }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toBe(1);
  });
});
