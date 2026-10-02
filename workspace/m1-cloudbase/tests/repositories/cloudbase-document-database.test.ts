import { describe, expect, it } from 'vitest';
import { createCloudBaseDocumentDatabase } from '../../src/repositories/cloudbase-document-database';
import { DocumentDatabasePlatformError, type VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { NativeDatabaseDouble } from '../support/native-database-double';

describe('CloudBase native document database bridge', () => {
  it('reads documents, exhausts paged queries and returns defensive JSON copies', async () => {
    const first = document('task_1', 1, 'active');
    const second = document('task_2', 1, 'active');
    // Seed in reverse order so paging must rely on the bridge's stable _id ordering.
    const native = new NativeDatabaseDouble({ tasks: [second, first, document('task_3', 1, 'closed')] });
    const database = createCloudBaseDocumentDatabase(native, { pageSize: 1, maxPages: 10 });

    await expect(database.get('tasks', 'task_1')).resolves.toEqual(first);
    await expect(database.get('tasks', 'missing')).resolves.toBeNull();
    await expect(database.find('tasks', { organizationId: 'organization_demo', status: 'active' }))
      .resolves.toEqual([first, second]);
  });

  it('returns the same bounded _id page in CloudBase and fake repositories', async () => {
    const seed = [document('task_3', 1, 'active'), document('task_1', 1, 'active'), document('task_2', 1, 'active')];
    const cloud = createCloudBaseDocumentDatabase(new NativeDatabaseDouble({ tasks: seed }));
    const fake = new FakeDocumentDatabase({ tasks: seed });
    const criteria = { organizationId: 'organization_demo', status: 'active' };
    const first = { limit: 2, offset: 0 };
    const second = { limit: 2, offset: 2 };
    expect(await cloud.findPage('tasks', criteria, first)).toEqual(await fake.findPage('tasks', criteria, first));
    expect(await cloud.findPage('tasks', criteria, second)).toEqual(await fake.findPage('tasks', criteria, second));
    expect(await cloud.findPage('tasks', criteria, first)).toMatchObject({
      items: [{ _id: 'task_1' }, { _id: 'task_2' }], hasMore: true,
    });
    await expect(cloud.findPage('tasks', criteria, { limit: 51, offset: 0 })).rejects.toMatchObject({ kind: 'invalid-data' });
  });

  it('binds create, CAS replace, append and delete to one native transaction', async () => {
    const native = new NativeDatabaseDouble({ tasks: [document('task_1', 1, 'active')] });
    const database = createCloudBaseDocumentDatabase(native);

    const result = await database.runTransaction(async (transaction) => {
      expect(await transaction.find('tasks', { organizationId: 'organization_demo', status: 'active' }))
        .toEqual([document('task_1', 1, 'active')]);
      expect(await transaction.create('tasks', document('task_1', 1, 'active'))).toBe(false);
      expect(await transaction.create('tasks', document('task_2', 1, 'active'))).toBe(true);
      expect(await transaction.replace('tasks', 'task_1', 0, document('task_1', 2, 'closed'))).toBe(false);
      expect(await transaction.replace('tasks', 'task_1', 1, document('task_1', 2, 'closed'))).toBe(true);
      expect(await transaction.append('operation_logs', document('log_1', 1, 'succeeded'))).toBe(true);
      expect(await transaction.delete('tasks', 'task_2', 1)).toBe(true);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(native.snapshot('tasks')).toEqual([document('task_1', 2, 'closed')]);
    expect(native.snapshot('operation_logs')).toEqual([document('log_1', 1, 'succeeded')]);
    expect(native.setPayloads).not.toHaveLength(0);
    expect(native.setPayloads.every((payload) => !('_id' in payload) && !('data' in payload))).toBe(true);
  });

  it('accepts CloudBase transaction get/query payloads serialized as list objects', async () => {
    const native = new NativeDatabaseDouble({ tasks: [document('task_1', 1, 'active')] });
    native.serializeReadsAsListObject = true;
    native.serializeNumbersAsExtendedJson = true;
    const database = createCloudBaseDocumentDatabase(native);

    await expect(database.get('tasks', 'task_1')).resolves.toEqual(document('task_1', 1, 'active'));
    await expect(database.get('tasks', 'missing')).resolves.toBeNull();
    await expect(database.find('tasks', { organizationId: 'organization_demo', status: 'active' }))
      .resolves.toEqual([document('task_1', 1, 'active')]);
    await expect(database.runTransaction(async (transaction) => {
      expect(await transaction.get('tasks', 'task_1')).toEqual(document('task_1', 1, 'active'));
      expect(await transaction.get('tasks', 'missing')).toBeNull();
      return transaction.create('tasks', document('task_2', 1, 'active'));
    })).resolves.toBe(true);
  });

  it('rejects a mismatched document id before invoking the native SDK', async () => {
    const native = new NativeDatabaseDouble();
    const database = createCloudBaseDocumentDatabase(native);

    await expect(database.runTransaction(async (transaction) => transaction.replace(
      'tasks',
      'task_reference',
      1,
      document('task_payload', 2, 'closed'),
    ))).resolves.toBe(false);
    expect(native.setPayloads).toHaveLength(0);
  });

  it('rolls back callback failures, maps native commit failures and does not expose SDK messages', async () => {
    const native = new NativeDatabaseDouble();
    const database = createCloudBaseDocumentDatabase(native);
    const domainFailure = new Error('domain failure');

    await expect(database.runTransaction(async (transaction) => {
      await transaction.create('tasks', document('task_1', 1, 'active'));
      throw domainFailure;
    })).rejects.toBe(domainFailure);
    expect(native.snapshot('tasks')).toHaveLength(0);

    native.nextCommitFailure = { errCode: 'DATABASE_TRANSACTION_CONFLICT', message: 'secret shard detail' };
    let caught: unknown;
    try {
      await database.runTransaction(async (transaction) => transaction.create('tasks', document('task_2', 1, 'active')));
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DocumentDatabasePlatformError);
    expect(caught).toMatchObject({ kind: 'conflict' });
    expect((caught as Error).message).not.toContain('secret shard detail');
    expect(native.snapshot('tasks')).toHaveLength(0);
  });

  it('maps missing-document SDK errors to null and other SDK errors to safe platform failures', async () => {
    const native = new NativeDatabaseDouble();
    const database = createCloudBaseDocumentDatabase(native);
    native.nextGetFailure = { errCode: 'DATABASE_DOCUMENT_NOT_EXIST', message: 'raw missing detail' };
    await expect(database.get('tasks', 'missing')).resolves.toBeNull();

    native.nextGetFailure = { errCode: 'DOCUMENT_NOT_FOUND', message: 'raw missing detail' };
    await expect(database.get('tasks', 'missing')).resolves.toBeNull();

    native.nextGetFailure = { errCode: 'DATABASE_TIMEOUT', message: 'credential=do-not-expose' };
    let caught: unknown;
    try {
      await database.get('tasks', 'task_1');
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DocumentDatabasePlatformError);
    expect(caught).toMatchObject({ kind: 'unavailable' });
    expect((caught as Error).message).not.toContain('credential');

    const classFailure = new Error('sensitive transaction detail') as Error & { code: string };
    classFailure.code = 'DATABASE_TRANSACTION_CONFLICT';
    native.nextCommitFailure = classFailure;
    await expect(database.runTransaction(async () => null)).rejects.toMatchObject({
      kind: 'conflict',
      message: 'CloudBase transaction failed (DATABASE_TRANSACTION_CONFLICT).',
    });
  });
});

function document(id: string, version: number, status: string): VersionedDocument {
  return {
    _id: id,
    organizationId: 'organization_demo',
    schemaVersion: 1,
    version,
    deletedAt: null,
    status,
  };
}
